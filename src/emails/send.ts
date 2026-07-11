import { render } from "react-email";
import type { ReactElement } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { and, asc, eq, gte, inArray, lt, lte, or } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import {
  generateIdentityToken,
  hashToken,
} from "@/lib/auth-tokens";
import { buildIcs, googleCalendarUrl } from "@/lib/ics";
import { withBookingMutex, withOwnerMutex } from "@/lib/keyed-mutex";
import {
  OWNER_SUMMARY_BATCH_SIZE,
  ownerLocalDayRange,
} from "@/lib/scheduled-work";
import {
  ClientConfirmation,
  ClientOwnerChanged,
  OwnerClientChanged,
  OwnerNewBooking,
  OwnerVerifyEmail,
  Welcome,
} from "./templates";

/**
 * The outbound-email pipeline. Locally there are no SMTP credentials, so the
 * "transport" is the email_outbox table (browse it at /emails) — in production
 * this function hands the same rendered HTML to the Cloudflare Email Worker.
 * email_log enforces idempotency for anything cron-ish via dedupe keys.
 */

type Owner = typeof schema.owners.$inferSelect;
type Booking = typeof schema.bookings.$inferSelect;
export type MailSendOptions = { deferDelivery?: boolean };

export const clientConfirmationDedupeKey = (
  bookingId: string,
  startsAt: Date,
  actionKey?: string,
) => `confirm:${bookingId}:${actionKey ?? `initial:${startsAt.toISOString()}`}`;

export const ownerNewBookingDedupeKey = (bookingId: string, startsAt: Date) =>
  `owner-new:${bookingId}:${startsAt.toISOString()}`;
export const clientOwnerChangedDedupeKey = (
  bookingId: string,
  kind: "moved" | "cancelled",
  actionKey: string,
) => `client-owner:${kind}:${bookingId}:${actionKey}`;
export const ownerClientChangedDedupeKey = (
  bookingId: string,
  kind: "moved" | "cancelled",
  actionKey: string,
) => `owner-client:${kind}:${bookingId}:${actionKey}`;
export const bookingMailStateKey = (
  booking: Pick<Booking, "lastActionKey" | "startsAt" | "meetingLink">,
) =>
  `${
    booking.lastActionKey
      ? `action:${booking.lastActionKey}`
      : `initial:${booking.startsAt.toISOString()}`
  }:meeting:${booking.meetingLink ?? "-"}`;

export const ownerBillingMailStateKey = (
  owner: Pick<
    Owner,
    | "planStatus"
    | "stripeSubscriptionId"
    | "stripeHasManageableSubscription"
    | "trialEndsAt"
    | "accessEndsAt"
    | "graceUntil"
  >,
) =>
  [
    "billing",
    owner.planStatus,
    owner.stripeSubscriptionId ?? "-",
    owner.stripeHasManageableSubscription ? "1" : "0",
    owner.trialEndsAt?.toISOString() ?? "-",
    owner.accessEndsAt?.toISOString() ?? "-",
    owner.graceUntil?.toISOString() ?? "-",
  ].join(":");

export const ownerMorningSummaryStateKey = (
  owner: Pick<Owner, "configVersion">,
  dayKey: string,
  bookings: Array<
    Pick<Booking, "id" | "startsAt" | "endsAt" | "lastActionKey">
  >,
) =>
  `summary:${dayKey}:${owner.configVersion}:${bookings
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (booking) =>
        `${booking.id}@${booking.startsAt.toISOString()}@${booking.endsAt.toISOString()}@${booking.lastActionKey ?? "-"}`,
    )
    .join(",")}`;

/** Undelivered rows must not retain rendered PII indefinitely. */
export const STALE_OUTBOX_DELIVERY_STATES = [
  "failed",
  "skipped",
  "expired",
  "pending",
  "processing",
] as const;

export interface Attachment {
  filename: string;
  contentType: string;
  content: string; // text (the .ics); base64 in production for binaries
}

interface Envelope {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  template: string;
  element: ReactElement;
  attachments?: Attachment[];
  dedupeKey?: string;
  ownerId?: string;
  ownerRecipientVersion?: number;
  ownerStateKey?: string;
  authTokenId?: string;
  bookingId?: string;
  bookingStateKey?: string;
}

interface DeliveryPayload {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  attachments?: Attachment[];
  idempotencyKey?: string;
}

const SYSTEM_FROM = "booktimewith.com";
const ownerFrom = (owner: Owner) => `${owner.name.split(",")[0]} via booktimewith.com`;

/**
 * Hand off to the real transport when configured (EMAIL_WEBHOOK_URL — a
 * Cloudflare Email Worker / MailChannels-shaped endpoint). Returns the
 * delivery status recorded on the outbox row — an unconfigured transport is
 * "skipped", loudly, not silently fine. A transport failure never breaks the
 * booking that triggered it.
 */
async function deliver(
  env: DeliveryPayload,
  html: string,
): Promise<{ status: "delivered" | "failed" | "skipped"; error?: string }> {
  const url = process.env.EMAIL_WEBHOOK_URL?.trim();
  if (!url) return { status: "skipped", error: "EMAIL_WEBHOOK_URL is not configured" };
  if (
    process.env.NODE_ENV === "production" &&
    (!/^https:\/\//i.test(url) || !URL.canParse(url))
  ) {
    return {
      status: "failed",
      error: "EMAIL_WEBHOOK_URL must use https in production",
    };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.CLOUDFLARE_EMAIL_TOKEN?.trim()
          ? { Authorization: `Bearer ${process.env.CLOUDFLARE_EMAIL_TOKEN.trim()}` }
          : {}),
        ...(env.idempotencyKey
          ? { "Idempotency-Key": env.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: env.to }] }],
        from: {
          email: `no-reply@${process.env.EMAIL_FROM_DOMAIN?.trim() || "mail.booktimewith.com"}`,
          name: env.from,
        },
        ...(env.replyTo ? { reply_to: { email: env.replyTo } } : {}),
        subject: env.subject,
        content: [{ type: "text/html", value: html }],
        attachments: env.attachments,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { status: "delivered" };
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    return {
      status: "failed",
      error: `Email transport returned ${res.status}${detail ? `: ${detail}` : ""}`,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Email transport failed",
    };
  }
}

export async function spool(
  db: Db,
  env: Envelope,
  options: { deferDelivery?: boolean } = {},
): Promise<string | false> {
  const html = await render(env.element);
  const queuedAt = new Date();
  const delivery = process.env.EMAIL_WEBHOOK_URL ? "pending" : "skipped";
  const values: typeof schema.emailOutbox.$inferInsert = {
    ownerId: env.ownerId ?? null,
    ownerRecipientVersion: env.ownerRecipientVersion ?? null,
    ownerStateKey: env.ownerStateKey ?? null,
    authTokenId: env.authTokenId ?? null,
    bookingId: env.bookingId ?? null,
    bookingStateKey: env.bookingStateKey ?? null,
    dedupeKey: env.dedupeKey ?? null,
    toEmail: env.to,
    fromLine: env.from,
    replyTo: env.replyTo ?? null,
    subject: env.subject,
    template: env.template,
    html,
    attachments: env.attachments ? JSON.stringify(env.attachments) : null,
    delivery,
    attempts: 0,
    nextAttemptAt: queuedAt,
    lastError: process.env.EMAIL_WEBHOOK_URL
      ? null
      : "EMAIL_WEBHOOK_URL is not configured",
    deliveredAt: null,
    createdAt: queuedAt,
  };
  let [queued] = await db
    .insert(schema.emailOutbox)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: schema.emailOutbox.id });

  if (!queued && env.dedupeKey) {
    const existing = await db.query.emailOutbox.findFirst({
      where: eq(schema.emailOutbox.dedupeKey, env.dedupeKey),
    });
    if (existing?.delivery === "expired") {
      // A stale state/identity guard can safely replace an undelivered row.
      // The conditional update lets exactly one concurrent recovery revive it.
      [queued] = await db
        .update(schema.emailOutbox)
        .set(values)
        .where(
          and(
            eq(schema.emailOutbox.id, existing.id),
            eq(schema.emailOutbox.delivery, "expired"),
          ),
        )
        .returning({ id: schema.emailOutbox.id });
    }
  }

  if (!queued) return false;
  if (process.env.EMAIL_WEBHOOK_URL && !options.deferDelivery) {
    await deliverQueuedEmail(db, queued.id);
  }
  return queued.id;
}

/** Claim and deliver one outbox row. The conditional claim prevents duplicates. */
export async function deliverQueuedEmail(
  db: Db,
  id: string,
  at?: Date,
): Promise<boolean> {
  const deliverClaim = async (): Promise<boolean> => {
    // Compute after acquiring owner/booking mutexes. A queued auth row can wait
    // behind another provider call; its token must be valid at actual handoff.
    const now = at ?? new Date();
    const existing = await db.query.emailOutbox.findFirst({
      where: eq(schema.emailOutbox.id, id),
    });
    if (
      !existing ||
      !["pending", "failed", "processing", "skipped"].includes(
        existing.delivery,
      )
    ) {
      return false;
    }

    if (existing.ownerId && existing.ownerRecipientVersion !== null) {
      const recipientOwner = await db.query.owners.findFirst({
        where: eq(schema.owners.id, existing.ownerId),
      });
      const expectedRecipient =
        existing.template === "owner-verify-email"
          ? recipientOwner?.pendingEmail ?? recipientOwner?.email
          : recipientOwner?.email;
      if (
        !recipientOwner ||
        recipientOwner.sessionVersion !== existing.ownerRecipientVersion ||
        (existing.replyTo
          ? recipientOwner.email !== existing.replyTo
          : expectedRecipient !== existing.toEmail)
      ) {
        await db
          .update(schema.emailOutbox)
          .set({
            delivery: "expired",
            lastError: "The owner's email identity changed before delivery",
            ...(process.env.NODE_ENV === "production"
              ? { html: "", attachments: null }
              : {}),
          })
          .where(eq(schema.emailOutbox.id, existing.id));
        return false;
      }
      if (
        !recipientOwner.emailVerifiedAt &&
        !["owner-sign-in", "owner-verify-email"].includes(existing.template)
      ) {
        await db
          .update(schema.emailOutbox)
          .set({
            delivery: "pending",
            nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
            lastError: "Waiting for the owner email to be verified",
          })
          .where(eq(schema.emailOutbox.id, existing.id));
        return false;
      }
    }

    if (existing.ownerId && existing.ownerStateKey) {
      const stateOwner = await db.query.owners.findFirst({
        where: eq(schema.owners.id, existing.ownerId),
      });
      let currentStateKey: string | null = null;
      if (stateOwner && existing.template === "owner-morning-summary") {
        const [, dayKey] = existing.ownerStateKey.split(":");
        const range = dayKey
          ? ownerLocalDayRange(dayKey, stateOwner.timezone)
          : null;
        const bookings = range
          ? await db.query.bookings.findMany({
              where: and(
                eq(schema.bookings.ownerId, stateOwner.id),
                eq(schema.bookings.status, "confirmed"),
                gte(schema.bookings.startsAt, range.startsAt),
                lt(schema.bookings.startsAt, range.endsAt),
              ),
              orderBy: [
                asc(schema.bookings.startsAt),
                asc(schema.bookings.id),
              ],
              limit: OWNER_SUMMARY_BATCH_SIZE,
            })
          : [];
        currentStateKey = dayKey && range
          ? ownerMorningSummaryStateKey(stateOwner, dayKey, bookings)
          : null;
      } else if (stateOwner) {
        currentStateKey = ownerBillingMailStateKey(stateOwner);
      }
      if (currentStateKey !== existing.ownerStateKey) {
        await db
          .update(schema.emailOutbox)
          .set({
            delivery: "expired",
            lastError: "A newer owner state superseded this message",
            ...(process.env.NODE_ENV === "production"
              ? { html: "", attachments: null }
              : {}),
          })
          .where(eq(schema.emailOutbox.id, existing.id));
        return false;
      }
    }

    if (existing.bookingId && existing.bookingStateKey) {
      const booking = await db.query.bookings.findFirst({
        where: eq(schema.bookings.id, existing.bookingId),
      });
      if (
        !booking ||
        bookingMailStateKey(booking) !== existing.bookingStateKey
      ) {
        await db
          .update(schema.emailOutbox)
          .set({
            delivery: "expired",
            lastError: "A newer booking change superseded this message",
            ...(process.env.NODE_ENV === "production"
              ? { html: "", attachments: null }
              : {}),
          })
          .where(eq(schema.emailOutbox.id, existing.id));
        return false;
      }
    }

    const authToken = existing.authTokenId
      ? await db.query.authTokens.findFirst({
          where: eq(schema.authTokens.id, existing.authTokenId),
        })
      : null;
    const authMailInvalid = existing.authTokenId
      ? !authToken ||
        authToken.usedAt !== null ||
        authToken.expiresAt.getTime() <= now.getTime() ||
        authToken.ownerId !== existing.ownerId ||
        authToken.identityEmail !== existing.toEmail
      : existing.template === "owner-sign-in" ||
          existing.template === "owner-verify-email";
    if (authMailInvalid) {
      await db
        .update(schema.emailOutbox)
        .set({
          delivery: "expired",
          lastError: "The authentication link is no longer valid",
          ...(process.env.NODE_ENV === "production"
            ? { html: "", attachments: null }
            : {}),
        })
        .where(eq(schema.emailOutbox.id, existing.id));
      return false;
    }

    const [claimed] = await db
      .update(schema.emailOutbox)
      .set({
        delivery: "processing",
        nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
      })
      .where(
        and(
          eq(schema.emailOutbox.id, id),
          eq(schema.emailOutbox.delivery, existing.delivery),
          lte(schema.emailOutbox.nextAttemptAt, now),
        ),
      )
      .returning();
    if (!claimed) return false;

    let attachments: Attachment[] | undefined;
    try {
      attachments = claimed.attachments
        ? (JSON.parse(claimed.attachments) as Attachment[])
        : undefined;
    } catch {
      attachments = undefined;
    }
    const result = await deliver(
      {
        to: claimed.toEmail,
        from: claimed.fromLine,
        replyTo: claimed.replyTo ?? undefined,
        subject: claimed.subject,
        attachments,
        idempotencyKey: claimed.dedupeKey ?? claimed.id,
      },
      claimed.html,
    );
    const attempts = claimed.attempts + 1;
    const retryMinutes = Math.min(360, 2 ** Math.min(attempts, 8));

    await db
      .update(schema.emailOutbox)
      .set({
        delivery: result.status,
        attempts,
        lastError: result.error ?? null,
        deliveredAt: result.status === "delivered" ? now : null,
        nextAttemptAt: new Date(now.getTime() + retryMinutes * 60_000),
        // Delivered magic links must not remain recoverable from the production DB.
        ...(result.status === "delivered" && process.env.NODE_ENV === "production"
          ? { html: "", attachments: null }
          : {}),
      })
      .where(eq(schema.emailOutbox.id, claimed.id));

    if (result.status === "delivered" && claimed.dedupeKey) {
      await db
        .insert(schema.emailLog)
        .values({
          template: claimed.template,
          dedupeKey: claimed.dedupeKey,
          ownerId: claimed.ownerId,
          bookingId: claimed.bookingId,
        })
        .onConflictDoNothing();
    }
    return result.status === "delivered";
  };

  const row = await db.query.emailOutbox.findFirst({
    where: eq(schema.emailOutbox.id, id),
  });
  const withBooking = () =>
    row?.bookingId
      ? withBookingMutex(row.bookingId, deliverClaim)
      : deliverClaim();
  return row?.ownerId
    ? withOwnerMutex(row.ownerId, withBooking)
    : withBooking();
}

/** Retry due mail and recover rows left processing by a crashed worker. */
export async function retryEmailOutbox(db: Db, now = new Date(), limit = 25) {
  if (!process.env.EMAIL_WEBHOOK_URL) return { attempted: 0, delivered: 0 };
  const due = await db.query.emailOutbox.findMany({
    where: and(
      inArray(schema.emailOutbox.delivery, [
        "pending",
        "failed",
        "processing",
        "skipped",
      ]),
      lte(schema.emailOutbox.nextAttemptAt, now),
    ),
    orderBy: [
      asc(schema.emailOutbox.nextAttemptAt),
      asc(schema.emailOutbox.createdAt),
    ],
    limit,
  });
  let delivered = 0;
  for (const row of due) {
    // A batch can spend seconds in the transport. Re-evaluate link expiry and
    // claim timing at the instant each row is handed off, not at batch start.
    if (await deliverQueuedEmail(db, row.id)) delivered += 1;
  }
  return { attempted: due.length, delivered };
}

/**
 * Small, bounded passwordless-mail retry lane. It runs independently from the
 * slower calendar/billing cron so a provider timeout there cannot consume a
 * 15-minute sign-in link's useful lifetime.
 */
export async function retryAuthEmailOutbox(
  db: Db,
  now = new Date(),
  limit = 5,
) {
  if (!process.env.EMAIL_WEBHOOK_URL) return { attempted: 0, delivered: 0 };
  const due = await db.query.emailOutbox.findMany({
    where: and(
      inArray(schema.emailOutbox.template, [
        "owner-sign-in",
        "owner-verify-email",
      ]),
      inArray(schema.emailOutbox.delivery, [
        "pending",
        "failed",
        "processing",
        "skipped",
      ]),
      lte(schema.emailOutbox.nextAttemptAt, now),
    ),
    orderBy: [
      asc(schema.emailOutbox.nextAttemptAt),
      asc(schema.emailOutbox.createdAt),
    ],
    limit,
  });
  const results = await Promise.all(
    due.map((row) => deliverQueuedEmail(db, row.id)),
  );
  return {
    attempted: due.length,
    delivered: results.filter(Boolean).length,
  };
}

/**
 * Fast, bounded lane for mail created by a booking or booking-state change.
 * Request handlers only commit the durable outbox row; this worker performs
 * the network handoff without adding provider latency to the user response.
 */
export async function retryBookingEmailOutbox(
  db: Db,
  now = new Date(),
  limit = 10,
) {
  if (!process.env.EMAIL_WEBHOOK_URL) return { attempted: 0, delivered: 0 };
  const due = await db.query.emailOutbox.findMany({
    where: and(
      inArray(schema.emailOutbox.template, [
        "client-confirmation",
        "owner-new-booking",
        "client-owner-changed",
        "owner-client-changed",
      ]),
      inArray(schema.emailOutbox.delivery, [
        "pending",
        "failed",
        "processing",
        "skipped",
      ]),
      lte(schema.emailOutbox.nextAttemptAt, now),
    ),
    orderBy: [
      asc(schema.emailOutbox.nextAttemptAt),
      asc(schema.emailOutbox.createdAt),
    ],
    limit,
  });
  const results = await Promise.all(
    due.map((row) => deliverQueuedEmail(db, row.id)),
  );
  return {
    attempted: due.length,
    delivered: results.filter(Boolean).length,
  };
}

/** Bound secret/PII retention even when an account is not explicitly deleted. */
export async function cleanupEmailOutbox(db: Db, now = new Date()) {
  const deliveredBefore = new Date(now.getTime() - 30 * 86_400_000);
  const failedBefore = new Date(now.getTime() - 7 * 86_400_000);
  const removed = await db
    .delete(schema.emailOutbox)
    .where(
      or(
        and(
          eq(schema.emailOutbox.delivery, "delivered"),
          lt(schema.emailOutbox.createdAt, deliveredBefore),
        ),
        and(
          inArray(schema.emailOutbox.delivery, STALE_OUTBOX_DELIVERY_STATES),
          lt(schema.emailOutbox.createdAt, failedBefore),
        ),
      ),
    )
    .returning({ id: schema.emailOutbox.id });
  return removed.length;
}

/* ── formatting (owner-timezone wall clock) ─────────────────────── */

const dayLong = (d: Date, tz: string) => formatInTimeZone(d, tz, "EEEE, MMMM d");
const clock = (d: Date, tz: string) => formatInTimeZone(d, tz, "h:mm a");
const timesRange = (start: Date, minutes: number, tz: string) =>
  `${clock(start, tz)} – ${clock(new Date(start.getTime() + minutes * 60_000), tz)} ${formatInTimeZone(start, tz, "zzz")}`;
const bookingMinutes = (booking: Booking) =>
  Math.max(1, Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000));
const clientTimezone = (booking: Booking, owner: Owner) =>
  booking.clientTimezone ?? owner.timezone;

async function currentBookingOwner(
  db: Db,
  ownerId: string,
) {
  return db.query.owners.findFirst({ where: eq(schema.owners.id, ownerId) });
}

function whereLine(booking: Booking): string {
  if (booking.locationModeSnapshot === "theirs") {
    return `At your address: ${booking.locationSnapshot ?? "the address you gave"}`;
  }
  return booking.locationSnapshot
    ? `At ${booking.locationSnapshot}`
    : "Video call — the link arrives with your reminder";
}

/* ── event senders ──────────────────────────────────────────────── */

/** Client confirmation on first booking and again after a client reschedules. */
export async function sendClientBookingConfirmation(
  db: Db,
  o: {
    owner: Owner;
    booking: Booking;
    manageToken: string;
    baseUrl: string;
    rescheduled?: boolean;
    actionKey?: string;
  },
  options: MailSendOptions = {},
) {
  const owner = await currentBookingOwner(
    db,
    o.owner.id,
  );
  if (!owner) return false;
  const { booking, manageToken, baseUrl } = o;
  const tz = clientTimezone(booking, owner);
  const first = booking.clientName.split(" ")[0];
  const when = dayLong(booking.startsAt, tz);
  const times = timesRange(booking.startsAt, bookingMinutes(booking), tz);
  const manageUrl = `${baseUrl}/manage/${manageToken}`;
  const event = {
    title: `${booking.serviceNameSnapshot} with ${owner.name.split(",")[0]}`,
    start: booking.startsAt,
    end: booking.endsAt,
    location: booking.locationSnapshot ?? undefined,
    url: manageUrl,
    uid: `${booking.id}@booktimewith.com`,
  };
  const calendarUrl = googleCalendarUrl(event);

  return spool(db, {
    to: booking.clientEmail,
    from: ownerFrom(owner),
    replyTo: owner.email,
    subject: `${o.rescheduled ? "Your booking moved" : "You're booked"} — ${when} at ${clock(booking.startsAt, tz)}`,
    template: "client-confirmation",
    ownerId: owner.id,
    ownerRecipientVersion: owner.sessionVersion,
    bookingId: booking.id,
    bookingStateKey: bookingMailStateKey(booking),
    dedupeKey: clientConfirmationDedupeKey(
      booking.id,
      booking.startsAt,
      o.actionKey,
    ),
    // README: "Attach .ics to confirmation emails."
    attachments: [
      { filename: "booking.ics", contentType: "text/calendar", content: buildIcs(event) },
    ],
    element: ClientConfirmation({
      clientFirst: first,
      cardTitle: `${booking.serviceNameSnapshot} with ${owner.name.split(",")[0]}`,
      whenBold: when,
      whenTimes: times,
      whereLine: whereLine(booking),
      manageUrl,
      calendarUrl,
      handle: owner.handle,
    }),
  }, options);
}

/** On booking: client confirmation (+ .ics) and owner alert. */
export async function sendBookingEmails(
  db: Db,
  o: { owner: Owner; booking: Booking; manageToken: string; baseUrl: string },
  options: MailSendOptions = {},
) {
  const { booking } = o;
  await sendClientBookingConfirmation(db, o, options);

  const owner = await currentBookingOwner(
    db,
    o.owner.id,
  );
  if (!owner) return;

  if (owner.notifyOnChange && owner.emailVerifiedAt) {
    const tz = owner.timezone;
    const when = dayLong(booking.startsAt, tz);
    const times = timesRange(booking.startsAt, bookingMinutes(booking), tz);
    await spool(db, {
      to: owner.email,
      from: SYSTEM_FROM,
      subject: `New booking — ${booking.clientName}, ${formatInTimeZone(booking.startsAt, tz, "EEE MMM d")} at ${clock(booking.startsAt, tz)}`,
      template: "owner-new-booking",
      ownerId: owner.id,
      ownerRecipientVersion: owner.sessionVersion,
      bookingId: booking.id,
      bookingStateKey: bookingMailStateKey(booking),
      dedupeKey: ownerNewBookingDedupeKey(booking.id, booking.startsAt),
      element: OwnerNewBooking({
        clientName: booking.clientName,
        clientEmail: booking.clientEmail,
        cardTitle: `${booking.serviceNameSnapshot} · ${bookingMinutes(booking)} min`,
        whenBold: when,
        whenTimes: times,
        handle: owner.handle,
      }),
    }, options);
  }
}

/** Owner moved/cancelled from their bookings page → the system-written polite email. */
export async function sendClientOwnerChanged(
  db: Db,
  o: {
    owner: Owner;
    booking: Booking;
    kind: "moved" | "cancelled";
    wasStart: Date;
    manageToken: string;
    baseUrl: string;
    reason?: string;
    actionKey?: string;
  },
  options: MailSendOptions = {},
) {
  const owner = await currentBookingOwner(
    db,
    o.owner.id,
  );
  if (!owner) return false;
  const { booking, kind, wasStart, manageToken, baseUrl, reason } = o;
  const tz = clientTimezone(booking, owner);
  const ownerFirst = owner.name.split(/[ ,]/)[0];
  const wasDay = formatInTimeZone(wasStart, tz, "EEEE");
  const headline =
    kind === "moved"
      ? `${ownerFirst} had to move ${wasDay}.`
      : `${ownerFirst} had to cancel ${wasDay}.`;
  const lead =
    kind === "moved"
      ? `${reason?.trim() || `Something came up on ${ownerFirst}'s side`}, so your ${clock(wasStart, tz)} on ${wasDay} won't work. Sorry for the shuffle. You're pencilled in for ${dayLong(booking.startsAt, tz)} at ${clock(booking.startsAt, tz)}; if that doesn't suit, pick any open time below.`
      : `${reason?.trim() || `Something came up on ${ownerFirst}'s side`}, so your ${clock(wasStart, tz)} on ${wasDay} won't work. Sorry about that. Use the button below to book any open time that suits.`;
  const actionUrl =
    kind === "cancelled"
      ? `${baseUrl}/${owner.handle}`
      : `${baseUrl}/manage/${manageToken}`;

  return spool(db, {
    to: booking.clientEmail,
    from: ownerFrom(owner),
    replyTo: owner.email,
    subject:
      kind === "moved"
        ? `${ownerFirst} had to move your ${wasDay} ${booking.serviceNameSnapshot.toLowerCase()}`
        : `${ownerFirst} had to cancel your ${wasDay} ${booking.serviceNameSnapshot.toLowerCase()}`,
    template: "client-owner-changed",
    ownerId: owner.id,
    ownerRecipientVersion: owner.sessionVersion,
    bookingId: booking.id,
    bookingStateKey: bookingMailStateKey(booking),
    dedupeKey: o.actionKey
      ? clientOwnerChangedDedupeKey(booking.id, kind, o.actionKey)
      : `client-owner:${kind}:${booking.id}:${wasStart.toISOString()}:${booking.startsAt.toISOString()}`,
    element: ClientOwnerChanged({
      headline,
      lead,
      manageUrl: actionUrl,
      handle: owner.handle,
    }),
  }, options);
}

/** Client moved/cancelled via their manage link → tell the owner (respects the toggle). */
export async function sendOwnerClientChanged(
  db: Db,
  o: {
    owner: Owner;
    booking: Booking;
    kind: "moved" | "cancelled";
    wasStart: Date;
    calendarUpdated?: boolean;
    actionKey?: string;
  },
  options: MailSendOptions = {},
) {
  const owner = await currentBookingOwner(
    db,
    o.owner.id,
  );
  if (!owner) return false;
  const { booking, kind, wasStart, calendarUpdated } = o;
  if (!owner.notifyOnChange || !owner.emailVerifiedAt) return false;
  const tz = owner.timezone;
  const first = booking.clientName.split(" ")[0];

  return spool(db, {
    to: owner.email,
    from: SYSTEM_FROM,
    subject:
      kind === "moved"
        ? `${booking.clientName} moved to ${formatInTimeZone(booking.startsAt, tz, "EEEE")} at ${clock(booking.startsAt, tz)}`
        : `${booking.clientName} cancelled ${formatInTimeZone(wasStart, tz, "EEEE")}`,
    template: "owner-client-changed",
    ownerId: owner.id,
    ownerRecipientVersion: owner.sessionVersion,
    bookingId: booking.id,
    bookingStateKey: bookingMailStateKey(booking),
    dedupeKey: o.actionKey
      ? ownerClientChangedDedupeKey(booking.id, kind, o.actionKey)
      : `owner-client:${kind}:${booking.id}:${wasStart.toISOString()}:${booking.startsAt.toISOString()}`,
    element: OwnerClientChanged({
      headline:
        kind === "moved"
          ? `${first} moved to ${formatInTimeZone(booking.startsAt, tz, "EEEE")} at ${clock(booking.startsAt, tz)}.`
          : `${first} cancelled ${formatInTimeZone(wasStart, tz, "EEEE")}.`,
      cardTitle: `${booking.serviceNameSnapshot} · ${bookingMinutes(booking)} min`,
      wasLine: `${dayLong(wasStart, tz)} · ${clock(wasStart, tz)}`,
      nowLine:
        kind === "moved"
          ? `${dayLong(booking.startsAt, tz)} · ${timesRange(booking.startsAt, bookingMinutes(booking), tz)}`
          : null,
      finePrint:
        kind === "moved"
          ? calendarUpdated
            ? `Your calendar is updated. A fresh confirmation for ${first} is queued.`
            : `A fresh confirmation for ${first} is queued. Calendar sync is still pending.`
          : `The slot is open again on your page. Nothing for you to do.`,
      handle: owner.handle,
    }),
  }, options);
}

/** On finishing setup: the one welcome email. */
export async function sendWelcome(
  db: Db,
  owner: Owner,
  options: MailSendOptions = {},
) {
  return spool(db, {
    to: owner.email,
    from: SYSTEM_FROM,
    subject: "You're set up — here's your link",
    template: "welcome",
    ownerId: owner.id,
    ownerRecipientVersion: owner.sessionVersion,
    dedupeKey: `welcome:${owner.id}`,
    element: Welcome({ handle: owner.handle }),
  }, options);
}

/** Email (re)verification: mint a 24h single-use token and send the link. */
export async function sendVerification(
  db: Db,
  owner: Owner,
  baseUrl: string,
  options: { deferDelivery?: boolean } = {},
) {
  const identityEmail = owner.pendingEmail ?? owner.email;
  const token = generateIdentityToken(owner.sessionVersion);
  const authTokenId = crypto.randomUUID();
  await db.insert(schema.authTokens).values({
    id: authTokenId,
    kind: "email_verify",
    ownerId: owner.id,
    identityEmail,
    tokenHash: await hashToken(token),
    expiresAt: new Date(Date.now() + 24 * 3_600_000),
  });
  return spool(
    db,
    {
      to: identityEmail,
      from: SYSTEM_FROM,
      subject: "Confirm your email — one click",
      template: "owner-verify-email",
      ownerId: owner.id,
      ownerRecipientVersion: owner.sessionVersion,
      authTokenId,
      element: OwnerVerifyEmail({
        verifyUrl: `${baseUrl}/api/verify-email?token=${token}`,
        email: identityEmail,
      }),
    },
    options,
  );
}
