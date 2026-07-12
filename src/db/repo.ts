import {
  and,
  asc,
  eq,
  gte,
  inArray,
  ne,
  sql,
} from "drizzle-orm";
import * as schema from "./schema";
import type { Db } from "./client";
import { blocksToCells, cellsToBlocks } from "@/lib/availability";
import type { OwnerConfig } from "@/lib/mock";
import { bookableDays, isSlotBookable, type BusySpan, type DaySlots } from "@/lib/slots";
import { hashToken } from "@/lib/auth-tokens";
import { PROVIDER_LABELS, calendarBusy, type Provider } from "@/lib/calendar";
import { canAcceptBookings } from "@/lib/entitlements";
import { isBillingCurrencyLocked } from "@/lib/billing";
import { deriveOpaqueToken } from "@/lib/session";
import { datePartsInZone, slotInstant } from "@/lib/timezone";
import { isEmailTransportConfigured } from "@/emails/transports/factory";

/** Owner-scoped data access. Public callers resolve a handle before entering here. */

export async function getOwnerConfig(db: Db, ownerId: string): Promise<OwnerConfig> {
  const owner = await db.query.owners.findFirst({
    where: eq(schema.owners.id, ownerId),
  });
  if (!owner) throw new Error("Owner not found");
  const service = (await db.query.services.findFirst({
    where: eq(schema.services.ownerId, ownerId),
  }));
  if (!service) throw new Error("Owner service not found");
  const blocks = await db.query.availability.findMany({
    where: eq(schema.availability.ownerId, ownerId),
  });
  const away = await db.query.awayPeriods.findFirst({
    where: eq(schema.awayPeriods.ownerId, ownerId),
  });
  const connection = await db.query.calendarConnections.findFirst({
    where: eq(schema.calendarConnections.ownerId, ownerId),
  });
  const cells = blocksToCells(blocks);
  const hours = blocks.map((b) => Math.floor(b.startMinute / 60));

  return {
    name: owner.name,
    handle: owner.handle,
    service: service.name,
    duration: service.durationMinutes,
    location: service.locationMode,
    ownerAddress: service.ownerAddress ?? "",
    cells,
    // grid bounds are presentation state; derive sensible bounds from paint
    startHour: hours.length ? Math.min(9, ...hours) : 9,
    endHour: hours.length ? Math.max(17, ...hours.map((h) => h + 1)) : 17,
    weekends: blocks.some((b) => b.weekday >= 5),
    calendar: connection
      ? (PROVIDER_LABELS[connection.provider as Provider] ?? connection.provider)
      : null,
    calendarStatus: connection
      ? connection.syncStatus === "degraded"
        ? "degraded"
        : "connected"
      : undefined,
    calendarError: connection?.lastError ?? null,
    calendarLastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
    meetingLink: service.meetingLink ?? "",
    notifyBook: owner.notifyOnChange,
    notifyMorning: owner.notifyMorningSummary,
    bookingHorizonDays: owner.bookingHorizonDays,
    timezone: owner.timezone,
    currency: owner.currency as OwnerConfig["currency"],
    billingCurrencyLocked: isBillingCurrencyLocked(owner),
    away: away ? { start: away.startDate, end: away.endDate } : null,
    paused: !canAcceptBookings(owner),
    email: owner.pendingEmail ?? owner.email,
    activeEmail: owner.email,
    pendingEmail: owner.pendingEmail,
    emailVerified: owner.emailVerifiedAt !== null,
    emailDeliveryConfigured: isEmailTransportConfigured(),
    setupComplete: owner.setupCompletedAt !== null,
    planStatus: owner.planStatus,
    trialEndsAt: owner.trialEndsAt?.toISOString() ?? null,
    graceUntil: owner.graceUntil?.toISOString() ?? null,
  };
}

/**
 * Apply a (partial) config from the client. Returns what changed in ways the
 * caller must react to (emails, redirects).
 */
async function applyOwnerConfigPatch(
  db: Db,
  ownerId: string,
  patch: Partial<OwnerConfig>,
): Promise<{ emailChanged: boolean; setupJustCompleted: boolean }> {
  const owner = await db.query.owners.findFirst({
    where: eq(schema.owners.id, ownerId),
  });
  if (!owner) throw new Error("Owner not found");
  const service = (await db.query.services.findFirst({
    where: eq(schema.services.ownerId, ownerId),
  }));
  if (!service) throw new Error("Owner service not found");

  const ownerPatch: Partial<typeof schema.owners.$inferInsert> = {};
  let emailChanged = false;
  let setupJustCompleted = false;
  let verificationResetReason: string | null = null;

  if (patch.handle !== undefined && patch.handle !== owner.handle && patch.handle) {
    // Changing a LIVE handle keeps a 301 from the old one for 90 days.
    // During signup there's no old link to preserve.
    if (owner.handle && owner.setupCompletedAt) {
      await db
        .insert(schema.handleRedirects)
        .values({
          ownerId: owner.id,
          fromHandle: owner.handle,
          expiresAt: new Date(Date.now() + 90 * 86_400_000),
        })
        .onConflictDoUpdate({
          target: schema.handleRedirects.fromHandle,
          // An expired redirect may belong to a previous owner of this handle.
          // Transfer it as well as renewing it, or a later handle change would
          // redirect clients to the wrong tenant.
          set: {
            ownerId: owner.id,
            expiresAt: new Date(Date.now() + 90 * 86_400_000),
          },
        });
    }
    ownerPatch.handle = patch.handle;
  }
  if (patch.email !== undefined && patch.email) {
    // Normalise on write: sign-in looks the address up lowercased, so storing
    // it as-typed (e.g. "Ryan@Gmail.com") would lock the owner out forever.
    const normalized = patch.email.toLowerCase().trim();
    if (normalized === owner.email && owner.pendingEmail) {
      // Entering the trusted address again cancels an unconfirmed change.
      ownerPatch.pendingEmail = null;
      verificationResetReason = "The pending email change was cancelled";
    } else if (
      normalized !== owner.email &&
      normalized !== owner.pendingEmail
    ) {
      // Keep the trusted sign-in/notification identity in place until the
      // exact new address consumes its verification capability.
      ownerPatch.pendingEmail = normalized;
      emailChanged = true;
      verificationResetReason = "A newer verification address was requested";
    }
  }
  if (verificationResetReason) {
    await db
      .delete(schema.authTokens)
      .where(
        and(
          eq(schema.authTokens.ownerId, owner.id),
          eq(schema.authTokens.kind, "email_verify"),
        ),
      );
    await db
      .update(schema.emailOutbox)
      .set({
        delivery: "expired",
        lastError: verificationResetReason,
        html: "",
        attachments: null,
      })
      .where(
        and(
          eq(schema.emailOutbox.ownerId, owner.id),
          eq(schema.emailOutbox.template, "owner-verify-email"),
          inArray(schema.emailOutbox.delivery, [
            "pending",
            "failed",
            "processing",
            "skipped",
          ]),
        ),
      );
  }
  if (patch.name !== undefined && patch.name.trim() && patch.name !== owner.name) {
    ownerPatch.name = patch.name.trim();
  }
  if (patch.notifyBook !== undefined) ownerPatch.notifyOnChange = patch.notifyBook;
  if (patch.notifyMorning !== undefined) ownerPatch.notifyMorningSummary = patch.notifyMorning;
  if (patch.bookingHorizonDays !== undefined) {
    ownerPatch.bookingHorizonDays = patch.bookingHorizonDays;
  }
  if (patch.timezone !== undefined) ownerPatch.timezone = patch.timezone;
  if (patch.currency !== undefined && patch.currency !== owner.currency) {
    if (isBillingCurrencyLocked(owner)) throw new Error("BILLING_CURRENCY_LOCKED");
    ownerPatch.currency = patch.currency;
  }
  if (patch.setupComplete === true && owner.setupCompletedAt === null) {
    ownerPatch.setupCompletedAt = new Date();
    // the 30-day card-less trial starts when the page goes live
    ownerPatch.trialEndsAt = new Date(Date.now() + 30 * 86_400_000);
    setupJustCompleted = true;
  }
  if (Object.keys(ownerPatch).length) {
    await db.update(schema.owners).set(ownerPatch).where(eq(schema.owners.id, owner.id));
  }

  const servicePatch: Partial<typeof schema.services.$inferInsert> = {};
  if (patch.service !== undefined) servicePatch.name = patch.service;
  if (patch.duration !== undefined) servicePatch.durationMinutes = patch.duration;
  if (patch.location !== undefined) servicePatch.locationMode = patch.location;
  if (patch.ownerAddress !== undefined) servicePatch.ownerAddress = patch.ownerAddress || null;
  if (patch.meetingLink !== undefined) servicePatch.meetingLink = patch.meetingLink || null;
  if (Object.keys(servicePatch).length) {
    await db.update(schema.services).set(servicePatch).where(eq(schema.services.id, service.id));
  }

  if (patch.cells !== undefined) {
    await db.delete(schema.availability).where(eq(schema.availability.ownerId, owner.id));
    const blocks = cellsToBlocks(patch.cells);
    if (blocks.length) {
      await db
        .insert(schema.availability)
        .values(blocks.map((b) => ({ ownerId: owner.id, ...b })));
    }
  }

  if (patch.away !== undefined) {
    await db.delete(schema.awayPeriods).where(eq(schema.awayPeriods.ownerId, owner.id));
    if (patch.away) {
      await db.insert(schema.awayPeriods).values({
        ownerId: owner.id,
        startDate: patch.away.start,
        endDate: patch.away.end,
      });
    }
  }

  return { emailChanged, setupJustCompleted };
}

/** Apply a settings patch atomically so replacement collections cannot be half-written. */
export async function patchOwnerConfig(
  db: Db,
  ownerId: string,
  patch: Partial<OwnerConfig>,
): Promise<{ emailChanged: boolean; setupJustCompleted: boolean }> {
  return db.transaction(async (tx) => {
    // This write acquires the owner-row lock before any replacement collection
    // changes. Booking confirmation takes the same lock before its final check.
    await tx
      .update(schema.owners)
      .set({ configVersion: sql`${schema.owners.configVersion} + 1` })
      .where(eq(schema.owners.id, ownerId));
    return applyOwnerConfigPatch(tx as unknown as Db, ownerId, patch);
  });
}

/** Resolve a handle to the owner, following live handle redirects. */
export async function ownerByHandle(db: Db, handle: string) {
  const direct = await db.query.owners.findFirst({
    where: eq(schema.owners.handle, handle),
  });
  if (direct) return direct;
  const redirect = await db.query.handleRedirects.findFirst({
    where: eq(schema.handleRedirects.fromHandle, handle),
  });
  if (redirect && redirect.expiresAt > new Date()) {
    return db.query.owners.findFirst({ where: eq(schema.owners.id, redirect.ownerId) });
  }
  return undefined;
}

/**
 * Confirmed future bookings as busy spans for the slot engine.
 * `excludeBookingId` drops one booking's own span — needed when validating a
 * reschedule so the booking being moved doesn't block itself.
 */
export async function busySpansFor(
  db: Db,
  ownerId: string,
  excludeBookingId?: string,
  includeCalendar = true,
  horizonDays = 60,
): Promise<BusySpan[]> {
  const rows = await db.query.bookings.findMany({
    where: and(
      eq(schema.bookings.ownerId, ownerId),
      eq(schema.bookings.status, "confirmed"),
      gte(schema.bookings.startsAt, new Date(Date.now() - 86_400_000)),
    ),
  });
  const spans: BusySpan[] = rows
    .filter((b) => b.id !== excludeBookingId)
    .map((b) => ({
      start: b.startsAt,
      end: b.endsAt,
    }));

  // Synced-calendar busy events block booking slots ("both ways").
  const connection = await db.query.calendarConnections.findFirst({
    where: eq(schema.calendarConnections.ownerId, ownerId),
  });
  if (connection && includeCalendar) {
    const now = new Date();
    spans.push(
      ...(await calendarBusy(
        connection,
        now,
        new Date(now.getTime() + (horizonDays + 1) * 86_400_000),
        db,
      )),
    );
  }
  return spans;
}

/** Live slots for the public page: availability − bookings − away, all rules applied. */
export async function slotsFor(
  db: Db,
  ownerId: string,
  now = new Date(),
  count = 3,
  viewerTz?: string,
  after?: Date,
): Promise<DaySlots[]> {
  const cfg = await getOwnerConfig(db, ownerId);
  const busy = await busySpansFor(db, ownerId, undefined, true, cfg.bookingHorizonDays);
  return bookableDays(cfg, busy, now, count, viewerTz ?? cfg.timezone, after);
}

/**
 * Server-side authorization for a client-supplied booking time: is `target` an
 * actually-open slot right now? Used by the public booking create and the
 * client reschedule so those surfaces can't book outside painted availability,
 * over existing bookings, or past the notice/horizon rules.
 */
export async function isBookableInstant(
  db: Db,
  ownerId: string,
  target: Date,
  now = new Date(),
  excludeBookingId?: string,
  includeCalendar = true,
): Promise<boolean> {
  const cfg = await getOwnerConfig(db, ownerId);
  const busy = await busySpansFor(
    db,
    ownerId,
    excludeBookingId,
    includeCalendar,
    cfg.bookingHorizonDays,
  );
  return isSlotBookable(cfg, busy, target, now);
}

/**
 * Weaker check for OWNER-initiated moves: the owner may override their own
 * availability grid, but must never create two overlapping confirmed bookings.
 * True when `target`+duration overlaps no other confirmed booking / busy span.
 */
export async function isFreeForOwner(
  db: Db,
  ownerId: string,
  target: Date,
  durationMinutes: number,
  excludeBookingId?: string,
  includeCalendar = true,
): Promise<boolean> {
  const end = new Date(target.getTime() + durationMinutes * 60_000);
  const busy = await busySpansFor(
    db,
    ownerId,
    excludeBookingId,
    includeCalendar,
  );
  return !busy.some((s) => s.start < end && target < s.end);
}

/**
 * Return the one stable, unguessable manage token for a booking. Every initial
 * confirmation, action email, reminder, and retry upserts the same token row,
 * so repeated lifecycle events cannot grow the capability table without bound.
 */
export async function mintManageToken(
  db: Db,
  bookingId: string,
) {
  const token = await deriveOpaqueToken("booking-manage", bookingId);
  const tokenHash = await hashToken(token);
  await db.transaction(async (tx) => {
    // Serialize token writes with booking transitions, then read the expiry
    // committed by the latest state. A delayed caller can no longer overwrite
    // a newer move/restore/cancel with its stale end time.
    await tx.execute(
      sql`select ${schema.bookings.id} from ${schema.bookings} where ${schema.bookings.id} = ${bookingId} for update`,
    );
    const booking = await tx.query.bookings.findFirst({
      where: eq(schema.bookings.id, bookingId),
    });
    if (!booking) throw new Error("Booking no longer exists");
    await tx
      .insert(schema.authTokens)
      .values({
        kind: "client_manage",
        bookingId,
        tokenHash,
        expiresAt: booking.manageExpiresAt,
      })
      .onConflictDoUpdate({
        target: schema.authTokens.tokenHash,
        set: {
          bookingId,
          expiresAt: booking.manageExpiresAt,
        },
      });
    // Keep any legacy random manage links aligned until they naturally age out.
    await tx
      .update(schema.authTokens)
      .set({ expiresAt: booking.manageExpiresAt })
      .where(
        and(
          eq(schema.authTokens.bookingId, bookingId),
          eq(schema.authTokens.kind, "client_manage"),
        ),
      );
  });
  return token;
}

/** Resolve a manage token → booking (valid until the appointment ends). */
export async function bookingByManageToken(db: Db, token: string) {
  const row = await db.query.authTokens.findFirst({
    where: and(
      eq(schema.authTokens.tokenHash, await hashToken(token)),
      eq(schema.authTokens.kind, "client_manage"),
    ),
  });
  if (!row || !row.bookingId || row.expiresAt < new Date()) return undefined;
  return db.query.bookings.findFirst({ where: eq(schema.bookings.id, row.bookingId) });
}

/** All of the owner's bookings from today on (owner timezone), oldest first. */
export async function ownerBookings(db: Db, ownerId: string, tz: string) {
  // Start-of-day in the OWNER's zone, not the server's — otherwise a UTC host
  // shows a New York owner yesterday-evening rows or hides this-morning ones.
  const { y, m, d } = datePartsInZone(new Date(), tz, 0);
  const dayStart = slotInstant(y, m, d, 0, tz);
  return db.query.bookings.findMany({
    where: and(
      eq(schema.bookings.ownerId, ownerId),
      gte(schema.bookings.startsAt, dayStart),
      ne(schema.bookings.status, "moved"),
    ),
    orderBy: asc(schema.bookings.startsAt),
  });
}
