import { and, eq, isNotNull, notLike, or } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { withKeyedMutex } from "@/lib/keyed-mutex";
import type { BusySpan } from "./slots";

/**
 * Calendar sync via Google Calendar and Microsoft Graph. OAuth connections are
 * real and credential-gated; an unconfigured provider is refused rather than
 * recording a fake connected state. Apple remains a reserved schema value only.
 */

export type Provider = "google" | "outlook" | "apple";

export class CalendarUnavailableError extends Error {
  constructor() {
    super("Connected calendar availability is temporarily unavailable");
    this.name = "CalendarUnavailableError";
  }
}

/** httpOnly cookie holding the per-request OAuth `state` nonce (CSRF guard). */
export const OAUTH_STATE_COOKIE = "btw_oauth_state";

export const PROVIDER_LABELS: Record<Provider, string> = {
  google: "Google Calendar",
  outlook: "Outlook",
  apple: "Apple Calendar",
};

const CREDS: Record<Provider, { id?: string; secret?: string }> = {
  google: {
    id: process.env.GOOGLE_CLIENT_ID?.trim(),
    secret: process.env.GOOGLE_CLIENT_SECRET?.trim(),
  },
  outlook: {
    id: process.env.MICROSOFT_CLIENT_ID?.trim(),
    secret: process.env.MICROSOFT_CLIENT_SECRET?.trim(),
  },
  apple: {}, // Reserved for a future CalDAV integration; not exposed in v1.
};

export const providerConfigured = (p: Provider) =>
  Boolean(CREDS[p].id?.trim() && CREDS[p].secret?.trim());

const redirectUri = (baseUrl: string) => `${baseUrl}/api/calendar/callback`;

const tokenSecret = () => {
  const value =
    process.env.CALENDAR_TOKEN_SECRET?.trim() ||
    process.env.AUTH_TOKEN_SECRET?.trim();
  if (value && value.length >= (process.env.NODE_ENV === "production" ? 32 : 16)) {
    return value;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CALENDAR_TOKEN_SECRET or AUTH_TOKEN_SECRET must contain at least 32 characters for calendar OAuth.",
    );
  }
  return "dev-only-calendar-token-secret";
};

const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64 = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

async function calendarKey() {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(tokenSecret()),
  );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function protectToken(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await calendarKey(),
    new TextEncoder().encode(value),
  );
  return `enc:v1:${b64(iv)}:${b64(new Uint8Array(encrypted))}`;
}

async function revealToken(value: string): Promise<string> {
  if (!value.startsWith("enc:v1:")) return value; // migration compatibility
  const [, , ivValue, encryptedValue] = value.split(":");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(ivValue) },
    await calendarKey(),
    unb64(encryptedValue),
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * The consent URL, or null when this environment has no credentials. `state`
 * is an unguessable per-request value (provider + session-bound nonce) the
 * callback checks to defeat OAuth CSRF — the caller mints and stores it.
 */
export function oauthUrl(
  provider: Provider,
  baseUrl: string,
  state: string,
): string | null {
  if (!providerConfigured(provider)) return null;
  if (provider === "google") {
    const q = new URLSearchParams({
      client_id: CREDS.google.id!,
      redirect_uri: redirectUri(baseUrl),
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  if (provider === "outlook") {
    const q = new URLSearchParams({
      client_id: CREDS.outlook.id!,
      redirect_uri: redirectUri(baseUrl),
      response_type: "code",
      scope: "offline_access Calendars.ReadWrite",
      state,
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${q}`;
  }
  return null;
}

const tokenEndpoint = (provider: Provider) =>
  provider === "google"
    ? "https://oauth2.googleapis.com/token"
    : "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/** Trade a stored refresh token for a fresh access token, or null on failure. */
async function refreshAccessToken(
  provider: Provider,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string } | null> {
  if (!providerConfigured(provider)) return null;
  const res = await fetch(tokenEndpoint(provider), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CREDS[provider].id!,
      client_secret: CREDS[provider].secret!,
      refresh_token: await revealToken(refreshToken),
      grant_type: "refresh_token",
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  return res.ok && data.access_token
    ? { accessToken: data.access_token, refreshToken: data.refresh_token }
    : null;
}

/**
 * Fetch a provider API with the connection's access token, transparently
 * refreshing (and persisting) it once on a 401 — access tokens expire ~1h
 * after connect, so without this, sync silently dies the same day.
 */
async function authedFetch(
  conn: Connection,
  url: string,
  init: RequestInit,
  db?: Db,
): Promise<Response> {
  return withCalendarConnectionMutex(conn, async () => {
    // Public availability reads do not hold the owner mutex. Re-read the live
    // credential row under a separate connection lock so concurrent reads
    // cannot rotate/overwrite the same refresh token, and so a request queued
    // behind disconnect/reconnect stops before touching the old provider grant.
    if (db && conn.id) {
      const live = await db.query.calendarConnections.findFirst({
        where: eq(schema.calendarConnections.id, conn.id),
      });
      if (!live || live.provider !== conn.provider) {
        throw new Error("Calendar connection changed during provider request");
      }
      conn.accessToken = live.accessToken;
      conn.refreshToken = live.refreshToken;
    }

    const withAuth = (token: string): RequestInit => ({
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        Authorization: `Bearer ${token}`,
      },
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
    let res = await fetch(url, withAuth(await revealToken(conn.accessToken)));
    if (res.status === 401 && db && conn.id && conn.refreshToken) {
      const fresh = await refreshAccessToken(
        conn.provider as Provider,
        conn.refreshToken,
      );
      if (fresh) {
        const protectedFresh = await protectToken(fresh.accessToken);
        const protectedRefresh = await protectToken(
          fresh.refreshToken ?? (await revealToken(conn.refreshToken)),
        );
        await db
          .update(schema.calendarConnections)
          .set({
            accessToken: protectedFresh,
            refreshToken: protectedRefresh,
          })
          .where(eq(schema.calendarConnections.id, conn.id));
        conn.accessToken = protectedFresh;
        conn.refreshToken = protectedRefresh;
        res = await fetch(url, withAuth(fresh.accessToken));
      }
    }
    return res;
  });
}

export async function exchangeCode(
  provider: Provider,
  code: string,
  baseUrl: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const tokenUrl =
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CREDS[provider].id!,
      client_secret: CREDS[provider].secret!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(baseUrl),
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description ?? "token exchange failed");
  }
  return {
    accessToken: await protectToken(data.access_token),
    refreshToken: data.refresh_token ? await protectToken(data.refresh_token) : undefined,
  };
}

export interface Connection {
  id?: string;
  provider: Provider | string;
  accessToken: string;
  refreshToken?: string | null;
}

/** Calendar credential I/O never takes the owner mutex, avoiding re-entrancy. */
export function withCalendarConnectionMutex<T>(
  conn: Pick<Connection, "id" | "provider">,
  work: () => Promise<T>,
) {
  return withKeyedMutex(
    "calendar-connection",
    conn.id ?? `ephemeral:${conn.provider}`,
    work,
  );
}

/**
 * Full startup migration for credentials written before AES-GCM protection was
 * introduced. Readiness awaits this function, so production cannot become
 * healthy while a legacy plaintext token remains in the database.
 */
export async function hardenCalendarTokens(
  db: Db,
  batchSize = 100,
): Promise<number> {
  const safeBatchSize = Math.max(1, Math.min(500, Math.floor(batchSize)));
  let hardened = 0;
  for (;;) {
    const legacy = await db.query.calendarConnections.findMany({
      where: or(
        notLike(schema.calendarConnections.accessToken, "enc:v1:%"),
        and(
          isNotNull(schema.calendarConnections.refreshToken),
          notLike(schema.calendarConnections.refreshToken, "enc:v1:%"),
        ),
      ),
      orderBy: (connection, { asc }) => [asc(connection.id)],
      limit: safeBatchSize,
    });
    if (legacy.length === 0) return hardened;

    for (const connection of legacy) {
      await withCalendarConnectionMutex(connection, async () => {
        const current = await db.query.calendarConnections.findFirst({
          where: eq(schema.calendarConnections.id, connection.id),
        });
        if (!current) return;
        const accessToken = current.accessToken.startsWith("enc:v1:")
          ? current.accessToken
          : await protectToken(current.accessToken);
        const refreshToken =
          !current.refreshToken || current.refreshToken.startsWith("enc:v1:")
            ? current.refreshToken
            : await protectToken(current.refreshToken);
        if (
          accessToken === current.accessToken &&
          refreshToken === current.refreshToken
        ) {
          return;
        }
        await db
          .update(schema.calendarConnections)
          .set({ accessToken, refreshToken })
          .where(eq(schema.calendarConnections.id, current.id));
        hardened += 1;
      });
    }
  }
}

function providerSpan(
  startValue: unknown,
  endValue: unknown,
  options: { assumeUtc?: boolean } = {},
): BusySpan {
  if (typeof startValue !== "string" || typeof endValue !== "string") {
    throw new Error("Calendar provider returned an invalid busy interval");
  }
  const instant = (value: string) => {
    // Graph's calendarView returns UTC when no `Prefer: outlook.timezone`
    // header is supplied, but its dateTimeTimeZone value normally omits the Z.
    const normalized =
      options.assumeUtc && !/(?:z|[+-]\d{2}:\d{2})$/i.test(value)
        ? `${value}Z`
        : value;
    const parsed = new Date(normalized);
    if (!Number.isFinite(parsed.getTime())) {
      throw new Error("Calendar provider returned an invalid busy instant");
    }
    return parsed;
  };
  const start = instant(startValue);
  const end = instant(endValue);
  if (end <= start) {
    throw new Error("Calendar provider returned a non-positive busy interval");
  }
  return { start, end };
}

interface GoogleEventPayload {
  id?: string;
  hangoutLink?: string;
  conferenceData?: {
    createRequest?: { status?: { statusCode?: string } };
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
}

const googleMeetLink = (event: GoogleEventPayload) =>
  event.hangoutLink ??
  event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video" && entry.uri,
  )?.uri;

const GOOGLE_CONFERENCE_POLL_DELAYS_MS = [0, 150, 350] as const;

/**
 * Google creates conference data asynchronously. Retain the provider event id
 * and poll briefly; if it is still pending, the caller records a failed booking
 * sync so the durable cron retry comes back for the eventual Meet URL.
 */
async function reconcileGoogleConference(
  conn: Connection,
  eventId: string,
  initial: GoogleEventPayload,
  db?: Db,
): Promise<{ meetingLink?: string; error?: string }> {
  let event = initial;
  let meetingLink = googleMeetLink(event);
  if (meetingLink) return { meetingLink };

  let requestedFreshConference = false;
  const requestFreshConference = async () => {
    // A failed Google createRequest is immutable. A genuinely fresh requestId is
    // required to make the same event try conference creation again.
    const requestId = `${eventId}-${crypto.randomUUID().replace(/-/g, "")}`;
    const response = await authedFetch(
      conn,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conferenceData: {
            createRequest: {
              requestId,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
      },
      db,
    );
    await requireOk(response);
    requestedFreshConference = true;
    event = (await response.json()) as GoogleEventPayload;
    meetingLink = googleMeetLink(event);
  };

  const recoverFailedConference = async () => {
    if (event.conferenceData?.createRequest?.status?.statusCode !== "failure") {
      return true;
    }
    if (requestedFreshConference) return false;
    await requestFreshConference();
    return true;
  };

  // Migration/recovery path for an app-created event that predates conference
  // requests, or a provider response that omitted conferenceData entirely.
  if (!event.conferenceData?.createRequest) {
    await requestFreshConference();
    if (meetingLink) return { meetingLink };
  }
  if (!(await recoverFailedConference())) {
    return { error: "Google Calendar could not create a Meet conference" };
  }
  if (meetingLink) return { meetingLink };

  for (const delay of GOOGLE_CONFERENCE_POLL_DELAYS_MS) {
    if (!(await recoverFailedConference())) {
      return { error: "Google Calendar could not create a Meet conference" };
    }
    if (meetingLink) return { meetingLink };
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const response = await authedFetch(
      conn,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      {},
      db,
    );
    await requireOk(response);
    event = (await response.json()) as GoogleEventPayload;
    meetingLink = googleMeetLink(event);
    if (meetingLink) return { meetingLink };
    if (!(await recoverFailedConference())) {
      return { error: "Google Calendar could not create a Meet conference" };
    }
    if (meetingLink) return { meetingLink };
  }

  return {
    error:
      event.conferenceData?.createRequest?.status?.statusCode === "failure"
        ? "Google Calendar could not create a Meet conference"
        : "Google Meet conference creation is still pending",
  };
}

async function recordSync(
  db: Db | undefined,
  conn: Connection,
  ok: boolean,
  error?: unknown,
) {
  if (!db || !conn.id) return;
  await db
    .update(schema.calendarConnections)
    .set({
      syncStatus: ok ? "connected" : "degraded",
      lastSyncedAt: ok ? new Date() : undefined,
      lastError: ok
        ? null
        : error instanceof Error
          ? error.message.slice(0, 500)
          : "Calendar provider request failed",
    })
    .where(eq(schema.calendarConnections.id, conn.id));
}

async function requireOk(response: Response) {
  if (response.ok) return;
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  throw new Error(
    `Calendar provider returned ${response.status}${detail ? `: ${detail}` : ""}`,
  );
}

/**
 * Synced-calendar busy time for the slot engine. Provider errors fail closed:
 * temporarily hiding availability is safer than double-booking an owner whose
 * busy events could not be read. Pass `db` so expired tokens refresh in place.
 */
export async function calendarBusy(
  conn: Connection,
  from: Date,
  to: Date,
  db?: Db,
): Promise<BusySpan[]> {
  try {
    if (conn.provider === "google") {
      const res = await authedFetch(
        conn,
        "https://www.googleapis.com/calendar/v3/freeBusy",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timeMin: from.toISOString(),
            timeMax: to.toISOString(),
            items: [{ id: "primary" }],
          }),
        },
        db,
      );
      await requireOk(res);
      const data = (await res.json()) as {
        calendars?: {
          primary?: {
            errors?: { domain?: string; reason?: string }[];
            busy?: { start: string; end: string }[];
          };
        };
      };
      const primary = data.calendars?.primary;
      if (!primary) {
        throw new Error("Google Calendar omitted primary-calendar availability");
      }
      if (primary.errors?.length) {
        const reason = primary.errors
          .map((error) => error.reason ?? error.domain ?? "unknown")
          .join(", ");
        throw new Error(`Google Calendar could not read primary availability: ${reason}`);
      }
      const busy = (primary.busy ?? []).map((span) =>
        providerSpan(span.start, span.end),
      );
      await recordSync(db, conn, true);
      return busy;
    }
    if (conn.provider === "outlook") {
      const busy: BusySpan[] = [];
      const seen = new Set<string>();
      let nextUrl: string | undefined =
        `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$select=start,end,showAs&$top=500`;
      const maxPages = 20;
      for (let page = 0; nextUrl; page += 1) {
        if (page >= maxPages) {
          throw new Error("Microsoft Graph calendarView exceeded the pagination limit");
        }
        const parsedUrl = new URL(nextUrl);
        if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "graph.microsoft.com") {
          throw new Error("Microsoft Graph returned an invalid pagination URL");
        }
        if (seen.has(parsedUrl.href)) {
          throw new Error("Microsoft Graph returned a repeated pagination URL");
        }
        seen.add(parsedUrl.href);

        const res = await authedFetch(conn, parsedUrl.href, {}, db);
        await requireOk(res);
        const data = (await res.json()) as {
          value?: {
            start?: { dateTime?: string };
            end?: { dateTime?: string };
            showAs?: string;
          }[];
          "@odata.nextLink"?: unknown;
        };
        if (!Array.isArray(data.value)) {
          throw new Error("Microsoft Graph omitted calendarView events");
        }
        for (const event of data.value) {
          // Only an explicit `free` is safe to expose. Tentative meeting requests
          // are common and must block; unknown future statuses fail closed too.
          if (event.showAs === "free") continue;
          busy.push(
            providerSpan(event.start?.dateTime, event.end?.dateTime, {
              assumeUtc: true,
            }),
          );
        }
        if (
          data["@odata.nextLink"] !== undefined &&
          typeof data["@odata.nextLink"] !== "string"
        ) {
          throw new Error("Microsoft Graph returned an invalid pagination URL");
        }
        nextUrl = data["@odata.nextLink"] as string | undefined;
      }
      await recordSync(db, conn, true);
      return busy;
    }
  } catch (error) {
    await recordSync(db, conn, false, error);
    throw new CalendarUnavailableError();
  }
  return [];
}

export interface CalendarWriteResult {
  ok: boolean;
  eventId?: string;
  meetingLink?: string;
  error?: string;
  missing?: boolean;
}

interface CalendarBookingEvent {
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  idempotencyKey?: string;
}

/** Create the provider event and retain its id for later lifecycle updates. */
export async function createBookingCalendarEvent(
  conn: Connection,
  o: CalendarBookingEvent,
  db?: Db,
): Promise<CalendarWriteResult> {
  let retainedEventId: string | undefined;
  try {
    if (conn.provider === "google") {
      const eventId = o.idempotencyKey
        ?.toLowerCase()
        .replace(/[^a-v0-9]/g, "")
        .slice(0, 1024);
      const eventBody = {
        summary: o.title,
        description: o.description,
        location: o.location,
        start: { dateTime: o.start.toISOString() },
        end: { dateTime: o.end.toISOString() },
      };
      let res = await authedFetch(
        conn,
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(eventId && eventId.length >= 5 ? { id: eventId } : {}),
            ...eventBody,
            conferenceData: {
              createRequest: {
                requestId: eventId ?? `${o.start.getTime()}`,
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            },
          }),
        },
        db,
      );
      // A timed-out first POST may have committed at Google before our client
      // saw the response. The stable id turns the retry's 409 into a PATCH of
      // that same event, both avoiding a duplicate and reconciling a later move.
      if (res.status === 409 && eventId) {
        res = await authedFetch(
          conn,
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?conferenceDataVersion=1`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(eventBody),
          },
          db,
        );
      }
      await requireOk(res);
      const data = (await res.json()) as GoogleEventPayload;
      if (!data.id) throw new Error("Google Calendar did not return an event id");
      retainedEventId = data.id;
      const conference = await reconcileGoogleConference(conn, data.id, data, db);
      if (!conference.meetingLink) {
        const error = conference.error ?? "Google Meet conference creation is pending";
        await recordSync(db, conn, false, new Error(error));
        return { ok: false, eventId: data.id, error };
      }
      await recordSync(db, conn, true);
      return { ok: true, eventId: data.id, meetingLink: conference.meetingLink };
    }
    if (conn.provider === "outlook") {
      const eventBody = {
        subject: o.title,
        body: { contentType: "text", content: o.description ?? "" },
        location: o.location ? { displayName: o.location } : undefined,
        start: { dateTime: o.start.toISOString(), timeZone: "UTC" },
        end: { dateTime: o.end.toISOString(), timeZone: "UTC" },
      };
      const res = await authedFetch(
        conn,
        "https://graph.microsoft.com/v1.0/me/events",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...eventBody,
            ...(o.idempotencyKey ? { transactionId: o.idempotencyKey } : {}),
          }),
        },
        db,
      );
      await requireOk(res);
      const data = (await res.json()) as { id?: string; onlineMeeting?: { joinUrl?: string } };
      if (!data.id) throw new Error("Outlook did not return an event id");
      retainedEventId = data.id;
      // Graph may dedupe this POST by transactionId after a timed-out earlier
      // create. Reconcile the returned event to the booking's latest interval.
      const reconciled = await authedFetch(
        conn,
        `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(data.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(eventBody),
        },
        db,
      );
      await requireOk(reconciled);
      await recordSync(db, conn, true);
      return { ok: true, eventId: data.id, meetingLink: data.onlineMeeting?.joinUrl };
    }
    throw new Error(`Unsupported calendar provider: ${conn.provider}`);
  } catch (error) {
    await recordSync(db, conn, false, error);
    return {
      ok: false,
      eventId: retainedEventId,
      error: error instanceof Error ? error.message : "Calendar event creation failed",
    };
  }
}

/** Backward-compatible helper for callers that only need a Meet link. */
export async function pushBookingToCalendar(
  conn: Connection,
  o: CalendarBookingEvent,
  db?: Db,
): Promise<string | null> {
  const result = await createBookingCalendarEvent(conn, o, db);
  return result.meetingLink ?? null;
}

/** Move/restore an existing provider event to the booking's current interval. */
export async function updateBookingCalendarEvent(
  conn: Connection,
  eventId: string,
  o: CalendarBookingEvent,
  db?: Db,
): Promise<CalendarWriteResult> {
  try {
    const endpoint =
      conn.provider === "google"
        ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`
        : conn.provider === "outlook"
          ? `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`
          : null;
    if (!endpoint) throw new Error(`Unsupported calendar provider: ${conn.provider}`);
    const body =
      conn.provider === "google"
        ? {
            summary: o.title,
            description: o.description,
            location: o.location,
            start: { dateTime: o.start.toISOString() },
            end: { dateTime: o.end.toISOString() },
          }
        : {
            subject: o.title,
            body: { contentType: "text", content: o.description ?? "" },
            location: o.location ? { displayName: o.location } : undefined,
            start: { dateTime: o.start.toISOString(), timeZone: "UTC" },
            end: { dateTime: o.end.toISOString(), timeZone: "UTC" },
          };
    const response = await authedFetch(
      conn,
      endpoint,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      db,
    );
    if (response.status === 404 || response.status === 410) {
      await recordSync(db, conn, true);
      return {
        ok: false,
        eventId,
        missing: true,
        error: "The provider event no longer exists",
      };
    }
    await requireOk(response);
    if (conn.provider === "google") {
      const data = (await response.json()) as GoogleEventPayload;
      const conference = await reconcileGoogleConference(conn, eventId, data, db);
      if (!conference.meetingLink) {
        const error = conference.error ?? "Google Meet conference creation is pending";
        await recordSync(db, conn, false, new Error(error));
        return { ok: false, eventId, error };
      }
      await recordSync(db, conn, true);
      return { ok: true, eventId, meetingLink: conference.meetingLink };
    }
    await recordSync(db, conn, true);
    return { ok: true, eventId };
  } catch (error) {
    await recordSync(db, conn, false, error);
    return {
      ok: false,
      eventId,
      error: error instanceof Error ? error.message : "Calendar event update failed",
    };
  }
}

/** Remove a cancelled booking from the connected calendar. */
export async function deleteBookingCalendarEvent(
  conn: Connection,
  eventId: string,
  db?: Db,
): Promise<CalendarWriteResult> {
  try {
    const endpoint =
      conn.provider === "google"
        ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
        : conn.provider === "outlook"
          ? `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`
          : null;
    if (!endpoint) throw new Error(`Unsupported calendar provider: ${conn.provider}`);
    const response = await authedFetch(conn, endpoint, { method: "DELETE" }, db);
    if (response.status === 404 || response.status === 410) {
      await recordSync(db, conn, true);
      return { ok: true, eventId };
    }
    await requireOk(response);
    await recordSync(db, conn, true);
    return { ok: true, eventId };
  } catch (error) {
    await recordSync(db, conn, false, error);
    return {
      ok: false,
      eventId,
      error: error instanceof Error ? error.message : "Calendar event deletion failed",
    };
  }
}

/** Best-effort provider revocation before disconnecting or deleting an account. */
export async function revokeCalendarConnection(conn: Connection): Promise<boolean> {
  if (conn.provider !== "google") return true;
  try {
    const token = await revealToken(conn.refreshToken ?? conn.accessToken);
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return true;
    if (response.status === 400) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      // Retrying after a successful provider revoke whose response was lost is
      // idempotent: Google reports the now-invalid token rather than 200.
      if (body.error === "invalid_token") return true;
    }
    return false;
  } catch {
    return false;
  }
}
