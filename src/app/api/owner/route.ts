import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { getDb, type Db } from "@/db/client";
import {
  bookingByManageToken,
  getOwnerConfig,
  ownerByHandle,
  patchOwnerConfig,
} from "@/db/repo";
import { cellsToBlocks } from "@/lib/availability";
import { checkHandle } from "@/lib/handles";
import { bookingEntitlement } from "@/lib/entitlements";
import { deleteStripeCustomer } from "@/lib/billing";
import { DEFAULT_OWNER, type OwnerConfig } from "@/lib/mock";
import { sendVerification, sendWelcome } from "@/emails/send";
import {
  assertSessionConfiguration,
  createSession,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
} from "@/lib/session";
import { sessionOwner, sessionOwnerId } from "@/lib/authz";
import { requestIp, takeRateLimit } from "@/lib/rate-limit";
import { canonicalAppUrl, isHttpUrl } from "@/lib/urls";
import { withOwnerMutex } from "@/lib/keyed-mutex";

export const dynamic = "force-dynamic";

const HANDLE_RE = /^[a-z0-9-]{3,30}$/;
const CELL_RE = /^(?:[0-6])-(?:[5-9]|1\d|2[0-2])-[ab]$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CELLS = 7 * 18 * 2;

const isIanaZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const isIsoDate = (value: string) => {
  if (!ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

const Cells = z.record(z.literal(1)).superRefine((cells, ctx) => {
  const keys = Object.keys(cells);
  if (keys.length > MAX_CELLS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Too many availability cells" });
  }
  for (const key of keys) {
    if (!CELL_RE.test(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid availability cell: ${key}`,
      });
    }
  }
});

const Away = z
  .object({
    start: z.string().refine(isIsoDate, "Invalid away start date"),
    end: z.string().refine(isIsoDate, "Invalid away end date"),
  })
  .refine((range) => range.start <= range.end, {
    message: "Away end date must not be before its start date",
    path: ["end"],
  });

const EditableConfig = z.object({
  handle: z.string().regex(HANDLE_RE),
  name: z.string().trim().min(1).max(120),
  service: z.string().trim().min(1).max(120),
  duration: z.number().int().min(15).max(240).multipleOf(5),
  location: z.enum(["mine", "theirs", "virtual"]),
  ownerAddress: z.string().trim().max(240),
  meetingLink: z.union([
    z.literal(""),
    z
      .string()
      .url()
      .max(300)
      .refine(isHttpUrl, "Meeting link must use http or https"),
  ]),
  cells: Cells,
  weekends: z.boolean(),
  startHour: z.number().int().min(5).max(22),
  endHour: z.number().int().min(6).max(23),
  calendar: z.string().nullable(),
  notifyBook: z.boolean(),
  notifyMorning: z.boolean(),
  bookingHorizonDays: z.number().int().min(1).max(730),
  timezone: z.string().min(1).max(100).refine(isIanaZone, "Invalid IANA timezone"),
  currency: z.enum(["GBP", "USD", "EUR", "AUD"]),
  away: Away.nullable(),
  email: z.string().trim().toLowerCase().email().max(320),
  setupComplete: z.boolean(),
});

const ConfigPatch = EditableConfig.partial();
const LiveConfig = EditableConfig.extend({ setupComplete: z.literal(true) }).superRefine(
  (config, ctx) => {
    if (checkHandle(config.handle) !== "available") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["handle"],
        message: "That handle is reserved or invalid",
      });
    }
    if (config.location === "mine" && !config.ownerAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownerAddress"],
        message: "An address is required when clients come to you",
      });
    }
    if (!Object.keys(config.cells).length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cells"],
        message: "Paint at least one available time",
      });
    }
    if (config.startHour >= config.endHour) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endHour"],
        message: "End hour must be later than start hour",
      });
    }
  },
);

type LiveOwnerConfig = z.infer<typeof LiveConfig>;

const clearStaleSession = (status = 401) => {
  const response = NextResponse.json({ error: "unauthorized" }, { status });
  response.cookies.delete(SESSION_COOKIE);
  return response;
};

const setSession = async (
  response: NextResponse,
  ownerId: string,
  requestUrl: string,
  sessionVersion = 0,
) => {
  const url = new URL(canonicalAppUrl(requestUrl));
  response.cookies.set(
    SESSION_COOKIE,
    await createSession(ownerId, new Date(), sessionVersion),
    {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
    },
  );
};

const logRejectedEmails = (results: PromiseSettledResult<unknown>[]) => {
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Owner email could not be queued", result.reason);
    }
  }
};

async function handleTaken(db: Db, handle: string, ownerId?: string) {
  const taken = await db.query.owners.findFirst({
    where: ownerId
      ? and(eq(schema.owners.handle, handle), ne(schema.owners.id, ownerId))
      : eq(schema.owners.handle, handle),
  });
  if (taken) return true;
  const redirect = await db.query.handleRedirects.findFirst({
    where: ownerId
      ? and(
          eq(schema.handleRedirects.fromHandle, handle),
          ne(schema.handleRedirects.ownerId, ownerId),
        )
      : eq(schema.handleRedirects.fromHandle, handle),
  });
  return Boolean(redirect && redirect.expiresAt > new Date());
}

async function emailTaken(db: Db, email: string, ownerId?: string) {
  return Boolean(
    await db.query.owners.findFirst({
      where: ownerId
        ? and(eq(schema.owners.email, email), ne(schema.owners.id, ownerId))
        : eq(schema.owners.email, email),
    }),
  );
}

async function createOwner(db: Db, config: LiveOwnerConfig) {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    if (await handleTaken(scoped, config.handle)) throw new Error("HANDLE_TAKEN");
    if (await emailTaken(scoped, config.email)) throw new Error("EMAIL_TAKEN");

    const now = new Date();
    const [owner] = await tx
      .insert(schema.owners)
      .values({
        email: config.email,
        name: config.name,
        handle: config.handle,
        timezone: config.timezone,
        currency: config.currency,
        notifyOnChange: config.notifyBook,
        notifyMorningSummary: config.notifyMorning,
        bookingHorizonDays: config.bookingHorizonDays,
        setupCompletedAt: now,
        trialEndsAt: new Date(now.getTime() + 30 * 86_400_000),
      })
      .returning();

    await tx.insert(schema.services).values({
      ownerId: owner.id,
      name: config.service,
      durationMinutes: config.duration,
      locationMode: config.location,
      ownerAddress: config.ownerAddress || null,
      meetingLink: config.meetingLink || null,
    });

    const blocks = cellsToBlocks(config.cells);
    if (blocks.length) {
      await tx
        .insert(schema.availability)
        .values(blocks.map((block) => ({ ownerId: owner.id, ...block })));
    }
    if (config.away) {
      await tx.insert(schema.awayPeriods).values({
        ownerId: owner.id,
        startDate: config.away.start,
        endDate: config.away.end,
      });
    }
    return owner;
  });
}

async function publicOwnerFor(request: Request, db: Db) {
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle")?.toLowerCase();
  if (handle) return (await ownerByHandle(db, handle)) ?? null;

  const manageToken = url.searchParams.get("manageToken");
  if (manageToken) {
    const booking = await bookingByManageToken(db, manageToken);
    if (!booking) return null;
    return (
      (await db.query.owners.findFirst({
        where: eq(schema.owners.id, booking.ownerId),
      })) ?? null
    );
  }
  return null;
}

const publicConfig = (
  config: OwnerConfig,
  owner: typeof schema.owners.$inferSelect,
) => {
  const entitlement = bookingEntitlement(owner);
  return {
    ...config,
    email: "",
    activeEmail: "",
    pendingEmail: null,
    emailVerified: false,
    notifyBook: true,
    notifyMorning: true,
    calendar: null,
    calendarStatus: undefined,
    calendarError: null,
    calendarLastSyncedAt: null,
    cells: {},
    away: null,
    ownerAddress: "",
    meetingLink: "",
    trialEndsAt: null,
    graceUntil: null,
    billingCurrencyLocked: false,
    paused: !entitlement.allowed,
    planStatus: entitlement.allowed ? ("active" as const) : ("paused" as const),
    entitlementReason: entitlement.reason,
  };
};

/** Public config is handle/manage-token scoped; private config is session scoped. */
export async function GET(request: Request) {
  const db = await getDb();
  const url = new URL(request.url);
  const wantsPublic =
    url.searchParams.get("public") === "1" ||
    request.headers.get("x-btw-public") === "1";

  if (wantsPublic) {
    const owner = await publicOwnerFor(request, db);
    if (!owner || !owner.setupCompletedAt) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(publicConfig(await getOwnerConfig(db, owner.id), owner));
  }

  const signedOwnerId = await sessionOwnerId();
  const owner = await sessionOwner(db);
  if (signedOwnerId && !owner) return clearStaleSession();
  // Anonymous private reads are the blank signup state, never another owner's data.
  if (!owner) return NextResponse.json(DEFAULT_OWNER);
  return NextResponse.json(await getOwnerConfig(db, owner.id));
}

/** Delete exactly the signed-in owner and revoke the current cookie. */
export async function DELETE() {
  const db = await getDb();
  const owner = await sessionOwner(db);
  if (!owner) return clearStaleSession();
  try {
    await withOwnerMutex(owner.id, async () => {
      const lockedOwner = await db.query.owners.findFirst({
        where: eq(schema.owners.id, owner.id),
      });
      if (
        !lockedOwner ||
        lockedOwner.sessionVersion !== owner.sessionVersion
      ) {
        throw new Error("Owner no longer exists");
      }
      // Deleting the encrypted local credentials immediately ends this app's
      // calendar access. Google revocation is grant-wide for a user/client and
      // could break another Book Time With owner connected to that same Google
      // account, so it is deliberately left to the provider security page.
      if (lockedOwner.stripeCustomerId) {
        await deleteStripeCustomer(lockedOwner.stripeCustomerId);
      }
      await db.delete(schema.owners).where(eq(schema.owners.id, owner.id));
    });
  } catch (error) {
    console.error("Account deletion could not finish", error);
    return NextResponse.json(
      {
        error:
          "Your account was not deleted because connected billing could not be closed. Try again shortly.",
      },
      { status: 502 },
    );
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

/** Anonymous full-config PATCH creates an account; authenticated PATCH updates only that owner. */
export async function PATCH(request: Request) {
  const db = await getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ConfigPatch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid config", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const signedOwnerId = await sessionOwnerId();
  let owner = await sessionOwner(db);
  if (signedOwnerId && !owner) return clearStaleSession();

  if (!owner) {
    const live = LiveConfig.safeParse({ ...DEFAULT_OWNER, ...parsed.data });
    if (!live.success) {
      return NextResponse.json(
        { error: "Complete every setup field before going live", issues: live.error.flatten() },
        { status: 400 },
      );
    }
    try {
      assertSessionConfiguration();
    } catch {
      return NextResponse.json(
        { error: "Account creation is temporarily unavailable." },
        { status: 503 },
      );
    }
    const signupLimit = await takeRateLimit(db, {
      scope: "owner-signup-ip",
      identifier: requestIp(request),
      limit: 10,
      windowMs: 24 * 60 * 60_000,
    });
    if (!signupLimit.allowed) {
      return NextResponse.json(
        { error: "Too many accounts were created from this connection. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(signupLimit.retryAfterSeconds) },
        },
      );
    }
    try {
      owner = await createOwner(db, live.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("EMAIL_TAKEN") || message.includes("owners_email")) {
        return NextResponse.json(
          { error: "That email already has an account — sign in instead" },
          { status: 409 },
        );
      }
      if (message.includes("HANDLE_TAKEN") || message.includes("owners_handle")) {
        return NextResponse.json({ error: "That handle is already taken" }, { status: 409 });
      }
      throw error;
    }

    const baseUrl = canonicalAppUrl(request.url);
    logRejectedEmails(
      await Promise.allSettled([
        sendWelcome(db, owner, { deferDelivery: true }),
        sendVerification(db, owner, baseUrl, { deferDelivery: true }),
      ]),
    );
    const response = NextResponse.json(await getOwnerConfig(db, owner.id));
    await setSession(response, owner.id, request.url, owner.sessionVersion);
    return response;
  }

  const current = await getOwnerConfig(db, owner.id);
  const merged = LiveConfig.safeParse({ ...current, ...parsed.data, setupComplete: true });
  if (!merged.success) {
    return NextResponse.json(
      { error: "Invalid config", issues: merged.error.flatten() },
      { status: 400 },
    );
  }
  if (
    merged.data.handle !== owner.handle &&
    (await handleTaken(db, merged.data.handle, owner.id))
  ) {
    return NextResponse.json({ error: "That handle is already taken" }, { status: 409 });
  }
  if (
    parsed.data.email !== undefined &&
    merged.data.email !== owner.email &&
    merged.data.email !== owner.pendingEmail &&
    (await emailTaken(db, merged.data.email, owner.id))
  ) {
    return NextResponse.json(
      { error: "That email already has an account" },
      { status: 409 },
    );
  }

  let changes: { emailChanged: boolean; setupJustCompleted: boolean };
  try {
    changes = await withOwnerMutex(owner.id, async () => {
      const currentOwner = await db.query.owners.findFirst({
        where: eq(schema.owners.id, owner!.id),
      });
      if (
        !currentOwner ||
        currentOwner.sessionVersion !== owner!.sessionVersion
      ) {
        throw new Error("OWNER_GONE");
      }
      return patchOwnerConfig(db, currentOwner.id, parsed.data);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("BILLING_CURRENCY_LOCKED")) {
      return NextResponse.json(
        {
          error:
            "Your current subscription keeps its existing currency. Manage billing to change the subscription itself.",
          code: "BILLING_CURRENCY_LOCKED",
          config: await getOwnerConfig(db, owner.id),
        },
        { status: 409 },
      );
    }
    if (message.includes("OWNER_GONE")) return clearStaleSession();
    if (message.includes("owners_email") || message.includes("email_unique")) {
      return NextResponse.json(
        { error: "That email already has an account" },
        { status: 409 },
      );
    }
    if (
      message.includes("owners_handle") ||
      message.includes("handle_unique") ||
      message.includes("from_handle")
    ) {
      return NextResponse.json(
        { error: "That handle is already taken" },
        { status: 409 },
      );
    }
    throw error;
  }
  const { emailChanged, setupJustCompleted } = changes;
  owner = (await db.query.owners.findFirst({ where: eq(schema.owners.id, owner.id) }))!;

  const baseUrl = canonicalAppUrl(request.url);
  if (setupJustCompleted) {
    logRejectedEmails(
      await Promise.allSettled([
        sendWelcome(db, owner, { deferDelivery: true }),
        sendVerification(db, owner, baseUrl, { deferDelivery: true }),
      ]),
    );
  } else if (emailChanged && owner.setupCompletedAt) {
    logRejectedEmails(
      await Promise.allSettled([
        sendVerification(db, owner, baseUrl, { deferDelivery: true }),
      ]),
    );
  }

  const response = NextResponse.json(await getOwnerConfig(db, owner.id));
  if (setupJustCompleted || emailChanged) {
    await setSession(
      response,
      owner.id,
      request.url,
      owner.sessionVersion,
    );
  }
  return response;
}
