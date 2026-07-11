import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import {
  isBookableInstant,
  mintManageToken,
  ownerBookings,
  ownerByHandle,
  slotsFor,
} from "@/db/repo";
import {
  clientConfirmationDedupeKey,
  ownerNewBookingDedupeKey,
  sendBookingEmails,
} from "@/emails/send";
import { syncBookingCalendar } from "@/lib/booking-calendar";
import { sessionOwner } from "@/lib/authz";
import { bookingEntitlement } from "@/lib/entitlements";
import { CalendarUnavailableError } from "@/lib/calendar";
import {
  isDisposableEmail,
  requestIp,
  takeRateLimit,
  verifyTurnstile,
} from "@/lib/rate-limit";
import { canonicalBookingUrl } from "@/lib/urls";
import { isIanaZone } from "@/lib/timezone";
import {
  bookingIntentHash,
  matchesBookingIntent,
} from "@/lib/booking-intent";
import { snapshotBookingService } from "@/lib/booking-snapshot";
import { withOwnerMutex } from "@/lib/keyed-mutex";
import { assertSessionConfiguration } from "@/lib/session";

export const dynamic = "force-dynamic";

const BookingInput = z.object({
  handle: z.string().regex(/^[a-z0-9-]{3,30}$/),
  startsAt: z.string().datetime(),
  clientName: z.string().min(1).max(120),
  clientEmail: z.string().email().max(320),
  clientTimezone: z
    .string()
    .min(1)
    .max(100)
    .refine(isIanaZone, "Invalid IANA timezone")
    .optional(),
  clientAddress: z.string().max(240).optional(),
  clientRequestKey: z.string().min(16).max(128).optional(),
  turnstileToken: z.string().max(4096).optional(),
});

// 23505 = unique_violation (exact-time dup); 23P01 = exclusion_violation
// (overlapping range from the bookings_no_overlap constraint). Either means the
// slot is no longer free.
const isSlotTaken = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  "code" in e &&
  ((e as { code: string }).code === "23505" || (e as { code: string }).code === "23P01");

async function idempotentBookingResponse(
  db: Awaited<ReturnType<typeof getDb>>,
  booking: typeof schema.bookings.$inferSelect,
  request: Request,
) {
  const owner = await db.query.owners.findFirst({
    where: eq(schema.owners.id, booking.ownerId),
  });
  let current = booking;
  if (
    booking.status === "confirmed" &&
    ["pending", "failed"].includes(booking.calendarSyncStatus)
  ) {
    await syncBookingCalendar(db, booking);
    current =
      (await db.query.bookings.findFirst({
        where: eq(schema.bookings.id, booking.id),
      })) ?? booking;
  }
  const manageToken = await mintManageToken(
    db,
    current.id,
  );
  // A browser retry after an interrupted response also reconciles the durable
  // confirmation outbox. Dedupe keys make this safe when the first send won.
  if (owner && current.status === "confirmed") {
    const expectedKeys = [
      clientConfirmationDedupeKey(current.id, current.startsAt),
      ...(owner.notifyOnChange && owner.emailVerifiedAt
        ? [ownerNewBookingDedupeKey(current.id, current.startsAt)]
        : []),
    ];
    const queued = await db.query.emailOutbox.findMany({
      where: inArray(schema.emailOutbox.dedupeKey, expectedKeys),
    });
    const queuedKeys = new Set(
      queued
        .filter((row) => row.delivery !== "expired")
        .map((row) => row.dedupeKey),
    );
    if (expectedKeys.some((key) => !queuedKeys.has(key))) {
      await sendBookingEmails(db, {
        owner,
        booking: current,
        manageToken,
        baseUrl: canonicalBookingUrl(request.url),
      }, { deferDelivery: true });
    }
  }
  return NextResponse.json({
    ok: true,
    idempotent: true,
    booking: bookingResponse(current),
    manageUrl: `/manage/${manageToken}`,
  });
}

function bookingResponse(
  booking: typeof schema.bookings.$inferSelect,
) {
  return {
    id: booking.id,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    durationMinutes: Math.round(
      (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
    ),
    status: booking.status,
    service: booking.serviceNameSnapshot,
    locationMode: booking.locationModeSnapshot,
    location: booking.locationSnapshot,
    meetingLink: booking.meetingLink,
    emailDeliveryConfigured: Boolean(process.env.EMAIL_WEBHOOK_URL),
  };
}

/**
 * Create a booking. The unique partial index on (owner, starts_at) where
 * status='confirmed' is the race protection — the second booker gets a 409
 * with the friendly "that time just went" message.
 */
export async function POST(request: Request) {
  // A booking response always needs a stable, signed manage capability. Fail
  // before reserving a slot if production token signing is misconfigured.
  try {
    assertSessionConfiguration();
  } catch {
    return NextResponse.json(
      { error: "Booking is temporarily unavailable." },
      { status: 503 },
    );
  }
  const db = await getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BookingInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid booking", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const owner = await ownerByHandle(db, parsed.data.handle.toLowerCase());
  if (!owner) return NextResponse.json({ error: "Unknown handle" }, { status: 404 });
  if (!owner.setupCompletedAt) {
    return NextResponse.json({ error: "This page is not live yet" }, { status: 409 });
  }
  const entitlement = bookingEntitlement(owner);
  if (!entitlement.allowed) {
    return NextResponse.json(
      {
        error: `${owner.name.split(",")[0]} isn't taking bookings right now.`,
        reason: entitlement.reason,
      },
      { status: 409 },
    );
  }

  const clientEmail = parsed.data.clientEmail.toLowerCase().trim();
  const clientName = parsed.data.clientName.trim();
  if (!clientName) {
    return NextResponse.json({ error: "Please include your name." }, { status: 400 });
  }
  if (isDisposableEmail(clientEmail)) {
    return NextResponse.json(
      { error: "Please use an email address you can receive confirmations at." },
      { status: 422 },
    );
  }

  const ip = requestIp(request);
  const ipLimit = await takeRateLimit(db, {
    scope: "public-booking-ip",
    identifier: ip,
    limit: 12,
    windowMs: 60 * 60_000,
  });
  const emailLimit = await takeRateLimit(db, {
    scope: "public-booking-email-handle",
    identifier: `${owner.handle}:${clientEmail}`,
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!ipLimit.allowed || !emailLimit.allowed) {
    const turnstileConfigured = Boolean(
      process.env.TURNSTILE_SECRET_KEY?.trim() &&
        (process.env.TURNSTILE_SITE_KEY?.trim() ||
          process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
    );
    const expectedTurnstileHost = new URL(
      canonicalBookingUrl(request.url),
    ).hostname;
    if (
      turnstileConfigured &&
      !(await verifyTurnstile(
        parsed.data.turnstileToken,
        ip,
        expectedTurnstileHost,
      ))
    ) {
      return NextResponse.json(
        {
          error: "Please complete the anti-spam check.",
          challengeRequired: true,
          siteKey:
            process.env.TURNSTILE_SITE_KEY?.trim() ||
            process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim(),
        },
        { status: 403 },
      );
    }
    if (!turnstileConfigured) {
      return NextResponse.json(
        { error: "Too many booking attempts. Try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds),
            ),
          },
        },
      );
    }
  }

  // Replays consume the same abuse budget as fresh bookings. The key is also
  // bound to the exact persisted intent, so it never becomes a manage-token
  // oracle for another payload.
  if (parsed.data.clientRequestKey) {
    const existing = await db.query.bookings.findFirst({
      where: eq(schema.bookings.clientRequestKey, parsed.data.clientRequestKey),
    });
    if (existing) {
      if (
        existing.ownerId !== owner.id ||
        !(await matchesBookingIntent(existing, parsed.data))
      ) {
        return NextResponse.json(
          { error: "Invalid booking request key" },
          { status: 409 },
        );
      }
      return idempotentBookingResponse(db, existing, request);
    }
  }

  const startsAt = new Date(parsed.data.startsAt);
  const initialIntentHash = await bookingIntentHash(parsed.data);
  const now = new Date();
  // Authorize the time server-side: painted availability, away periods, busy
  // time (which also blocks overlap with existing bookings), slot alignment,
  // duration-fit, min-notice and horizon. The slot list on the page is only a
  // convenience — this is the check that actually gates a booking.
  let bookable: boolean;
  try {
    bookable = await isBookableInstant(db, owner.id, startsAt, now);
  } catch (error) {
    if (error instanceof CalendarUnavailableError) {
      return NextResponse.json(
        { error: "Availability is temporarily unavailable. Try again shortly." },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    throw error;
  }
  if (!bookable) {
    return NextResponse.json(
      { error: "That time can't be booked — pick another." },
      { status: 422 },
    );
  }

  const service = (await db.query.services.findFirst({
    where: eq(schema.services.ownerId, owner.id),
  }))!;
  const clientAddress = parsed.data.clientAddress?.trim();
  if (service.locationMode === "theirs" && !clientAddress) {
    return NextResponse.json(
      { error: "Please include the address for this booking." },
      { status: 400 },
    );
  }
  let booking: typeof schema.bookings.$inferSelect;
  let notificationOwner = owner;
  try {
    const created = await withOwnerMutex(owner.id, async () => {
      // OAuth connect/disconnect uses this same mutex. Recheck the remote
      // calendar after acquiring it so a just-installed connection cannot be
      // missed, then keep the transaction-only recheck provider-free.
      if (!(await isBookableInstant(db, owner.id, startsAt, new Date()))) {
        throw new Error("CONFIG_CHANGED");
      }
      return db.transaction(async (tx) => {
      // Settings writes increment configVersion under the same owner-row lock.
      // This final validation and insert therefore see one coherent config.
      await tx.execute(
        sql`select ${schema.owners.id} from ${schema.owners} where ${schema.owners.id} = ${owner.id} for update`,
      );
      const scoped = tx as unknown as Awaited<ReturnType<typeof getDb>>;
      const lockedOwner = await tx.query.owners.findFirst({
        where: eq(schema.owners.id, owner.id),
      });
      if (!lockedOwner || !bookingEntitlement(lockedOwner).allowed) {
        throw new Error("ENTITLEMENT_CHANGED");
      }
      if (
        !(await isBookableInstant(
          scoped,
          owner.id,
          startsAt,
          new Date(),
          undefined,
          false,
        ))
      ) {
        throw new Error("CONFIG_CHANGED");
      }
      const lockedService = await tx.query.services.findFirst({
        where: eq(schema.services.ownerId, owner.id),
      });
      if (!lockedService) throw new Error("SERVICE_MISSING");
      if (lockedService.locationMode === "theirs" && !clientAddress) {
        throw new Error("ADDRESS_REQUIRED");
      }
      const endsAt = new Date(
        startsAt.getTime() + lockedService.durationMinutes * 60_000,
      );
      const serviceSnapshot = snapshotBookingService(
        lockedService,
        clientAddress,
      );
      const [row] = await tx
        .insert(schema.bookings)
        .values({
          ownerId: owner.id,
          serviceId: lockedService.id,
          startsAt,
          endsAt,
          manageExpiresAt: endsAt,
          ...serviceSnapshot,
          clientName,
          clientEmail,
          clientTimezone: parsed.data.clientTimezone ?? lockedOwner.timezone,
          clientAddress:
            lockedService.locationMode === "theirs" ? clientAddress : null,
          lastActionBy: "client",
          clientRequestKey: parsed.data.clientRequestKey,
          initialIntentHash,
          meetingLink: serviceSnapshot.meetingLinkSnapshot,
          // Durable intent: if the request dies before the provider call, the
          // cron worker still knows this booking needs reconciliation.
          calendarSyncStatus: "pending",
        })
        .returning();
        return { booking: row, owner: lockedOwner };
      });
    });
    booking = created.booking;
    notificationOwner = created.owner;
  } catch (e) {
    if (parsed.data.clientRequestKey) {
      const existing = await db.query.bookings.findFirst({
        where: eq(schema.bookings.clientRequestKey, parsed.data.clientRequestKey),
      });
      if (existing) {
        if (
          existing.ownerId !== owner.id ||
          !(await matchesBookingIntent(existing, parsed.data))
        ) {
          return NextResponse.json(
            { error: "Invalid booking request key" },
            { status: 409 },
          );
        }
        return idempotentBookingResponse(db, existing, request);
      }
    }
    if (e instanceof Error && e.message === "ADDRESS_REQUIRED") {
      return NextResponse.json(
        { error: "Please include the address for this booking." },
        { status: 400 },
      );
    }
    if (e instanceof Error && e.message === "ENTITLEMENT_CHANGED") {
      return NextResponse.json(
        { error: `${owner.name.split(",")[0]} isn't taking bookings right now.` },
        { status: 409 },
      );
    }
    if (e instanceof Error && e.message === "CONFIG_CHANGED") {
      return NextResponse.json(
        { error: "Availability changed while you were booking. Pick another time." },
        { status: 422 },
      );
    }
    if (e instanceof CalendarUnavailableError) {
      return NextResponse.json(
        { error: "Availability is temporarily unavailable. Try again shortly." },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    if (isSlotTaken(e)) {
      return NextResponse.json(
        { error: "That time just went — here's what's still open." },
        { status: 409 },
      );
    }
    throw e;
  }

  const calendarResult = await syncBookingCalendar(db, booking);
  booking =
    (await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) })) ??
    (calendarResult.meetingLink
      ? { ...booking, meetingLink: calendarResult.meetingLink }
      : booking);

  const manageToken = await mintManageToken(
    db,
    booking.id,
  );
  await sendBookingEmails(db, {
    owner: notificationOwner,
    booking,
    manageToken,
    baseUrl: canonicalBookingUrl(request.url),
  }, { deferDelivery: true });

  return NextResponse.json(
    {
      ok: true,
      booking: bookingResponse(booking),
      manageUrl: `/manage/${manageToken}`,
    },
    { status: 201 },
  );
}

/** The owner's bookings (today onward) with 3 move-option chips per row. */
export async function GET() {
  const db = await getDb();
  const owner = await sessionOwner(db);
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await ownerBookings(db, owner.id, owner.timezone);
  let open: { startsAt: string; full: string; label: string }[] = [];
  try {
    open = (await slotsFor(db, owner.id, new Date(), 5, owner.timezone)).flatMap(
      (d) =>
        d.slots.map((s) => ({
          startsAt: s.start.toISOString(),
          full: d.full,
          label: s.label,
        })),
    );
  } catch (error) {
    if (!(error instanceof CalendarUnavailableError)) throw error;
    // Still show existing bookings; simply withhold unsafe move suggestions.
  }

  return NextResponse.json({
    bookings: rows.map((b) => ({
      id: b.id,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      durationMinutes: Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000),
      clientName: b.clientName,
      clientEmail: b.clientEmail,
      clientAddress: b.clientAddress,
      serviceName: b.serviceNameSnapshot,
      locationMode: b.locationModeSnapshot,
      location: b.locationSnapshot,
      status: b.status,
      calendarSyncStatus: b.calendarSyncStatus,
      moveOptions: open
        .filter((s) => s.startsAt !== b.startsAt.toISOString())
        .slice(0, 3)
        .map((s) => ({
          startsAt: s.startsAt,
          // same-day alternatives read "11:00"; other days "Thu 9:00"
          label:
            formatInTimeZone(new Date(s.startsAt), owner.timezone, "yyyy-MM-dd") ===
            formatInTimeZone(b.startsAt, owner.timezone, "yyyy-MM-dd")
              ? s.label
              : `${s.full.split(" ")[0].slice(0, 3)} ${s.label}`,
        })),
    })),
  });
}
