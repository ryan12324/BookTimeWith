import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import {
  type CalendarWriteResult,
  type Provider,
  createBookingCalendarEvent,
  deleteBookingCalendarEvent,
  updateBookingCalendarEvent,
} from "@/lib/calendar";
import { canonicalBookingUrl } from "@/lib/urls";
import { withBookingMutex, withOwnerMutex } from "@/lib/keyed-mutex";

type Booking = typeof schema.bookings.$inferSelect;
type Owner = typeof schema.owners.$inferSelect;

const bookingPage = (handle: string) =>
  `${canonicalBookingUrl()}/${handle}`;

async function context(db: Db, ownerId: string) {
  const [owner, connection] = await Promise.all([
    db.query.owners.findFirst({ where: eq(schema.owners.id, ownerId) }),
    db.query.calendarConnections.findFirst({
      where: eq(schema.calendarConnections.ownerId, ownerId),
    }),
  ]);
  return { owner, connection };
}

export function bookingCalendarLocation(
  booking: Pick<Booking, "locationSnapshot">,
) {
  return booking.locationSnapshot?.trim() || undefined;
}

export function bookingCalendarEvent(
  owner: Pick<Owner, "handle">,
  booking: Pick<
    Booking,
    | "id"
    | "serviceNameSnapshot"
    | "clientName"
    | "startsAt"
    | "endsAt"
    | "locationSnapshot"
    | "calendarRevision"
  > & { meetingLink?: string | null; meetingLinkOverride?: string | null },
) {
  const joinUrl = booking.meetingLinkOverride ?? booking.meetingLink;
  return {
    title: `${booking.serviceNameSnapshot} · ${booking.clientName}`,
    start: booking.startsAt,
    end: booking.endsAt,
    description: `Booked at ${bookingPage(owner.handle)}${joinUrl ? `\nJoin online: ${joinUrl}` : ""}`,
    location: bookingCalendarLocation(booking),
    idempotencyKey: `${booking.id}-${booking.calendarRevision}`,
  };
}

export function effectiveBookingMeetingLink(
  booking: Pick<Booking, "meetingLink" | "meetingLinkSnapshot"> & {
    meetingLinkOverride?: string | null;
  },
  mode: "upsert" | "cancel",
  result: Pick<CalendarWriteResult, "ok" | "meetingLink">,
) {
  if (booking.meetingLinkOverride) return booking.meetingLinkOverride;
  if (mode === "cancel") return booking.meetingLinkSnapshot;
  return result.ok
    ? result.meetingLink ?? booking.meetingLinkSnapshot
    : booking.meetingLink ?? booking.meetingLinkSnapshot;
}

/**
 * Bring one booking's provider event to the requested state. Provider failure
 * never rolls back a confirmed booking; it becomes durable retryable state.
 */
async function syncBookingCalendarLocked(
  db: Db,
  booking: Booking,
  mode: "upsert" | "cancel",
) {
  const { owner, connection } = await context(db, booking.ownerId);
  if (!owner || !connection) {
    await db
      .update(schema.bookings)
      .set({
        calendarSyncStatus: connection ? "failed" : "none",
        calendarSyncError: connection ? "Calendar owner was not found" : null,
        calendarUpdatedAt: new Date(),
        meetingLink: booking.meetingLinkOverride ?? booking.meetingLinkSnapshot,
        mailRecoveryCheckedAt: null,
      })
      .where(eq(schema.bookings.id, booking.id));
    if (booking.lastActionKey) {
      await db
        .update(schema.bookingActions)
        .set({ mailRecoveryCheckedAt: null })
        .where(eq(schema.bookingActions.actionKey, booking.lastActionKey));
    }
    return { ok: !connection, meetingLink: booking.meetingLinkOverride ?? booking.meetingLinkSnapshot };
  }

  await db
    .update(schema.bookings)
    .set({ calendarSyncStatus: "pending", calendarSyncError: null })
    .where(eq(schema.bookings.id, booking.id));

  const event = bookingCalendarEvent(owner, booking);
  let revision = booking.calendarRevision;
  let attemptedFreshCreate = false;
  let result: CalendarWriteResult;
  if (mode === "cancel") {
    result = booking.calendarEventId
      ? await deleteBookingCalendarEvent(connection, booking.calendarEventId, db)
      : { ok: true };
  } else if (booking.calendarEventId && booking.calendarSyncStatus !== "deleted") {
    result = await updateBookingCalendarEvent(
      connection,
      booking.calendarEventId,
      event,
      db,
    );
    if (result.missing) {
      revision += 1;
      attemptedFreshCreate = true;
      result = await createBookingCalendarEvent(
        connection,
        { ...event, idempotencyKey: `${booking.id}-${revision}` },
        db,
      );
    }
  } else {
    attemptedFreshCreate = true;
    result = await createBookingCalendarEvent(connection, event, db);
  }

  const meetingLink = effectiveBookingMeetingLink(booking, mode, result);
  const calendarEventId =
    mode === "cancel" && result.ok
      ? null
      : result.eventId ?? (attemptedFreshCreate ? null : booking.calendarEventId);
  await db
    .update(schema.bookings)
    .set({
      calendarProvider: connection.provider,
      calendarEventId,
      calendarRevision: revision,
      calendarSyncStatus: result.ok ? (mode === "cancel" ? "deleted" : "synced") : "failed",
      calendarSyncError: result.error ?? null,
      calendarUpdatedAt: new Date(),
      meetingLink,
      mailRecoveryCheckedAt: null,
    })
    .where(eq(schema.bookings.id, booking.id));
  if (booking.lastActionKey) {
    await db
      .update(schema.bookingActions)
      .set({ mailRecoveryCheckedAt: null })
      .where(eq(schema.bookingActions.actionKey, booking.lastActionKey));
  }

  return { ok: result.ok, meetingLink, eventId: calendarEventId ?? undefined };
}

/**
 * Serialize this owner/booking inside the process while PostgreSQL conditional
 * writes protect committed state across processes. Provider I/O stays outside
 * database transactions so it never occupies a pooled connection while idle.
 */
export async function syncBookingCalendar(
  db: Db,
  booking: Booking,
) {
  return withOwnerMutex(booking.ownerId, () =>
    withBookingMutex(booking.id, async () => {
      const current = await db.query.bookings.findFirst({
        where: eq(schema.bookings.id, booking.id),
      });
      if (!current) {
        return {
          ok: false,
          meetingLink: booking.meetingLinkOverride ?? booking.meetingLinkSnapshot,
        };
      }
      return syncBookingCalendarLocked(
        db,
        current,
        current.status === "cancelled" ? "cancel" : "upsert",
      );
    }),
  );
}

/** Mark future bookings for recreation after a provider is connected/replaced. */
export async function queueOwnerCalendarReconciliation(
  db: Db,
  ownerId: string,
  provider: Provider,
) {
  const now = new Date();
  await db
    .update(schema.bookings)
    .set({
      calendarProvider: null,
      calendarEventId: null,
      calendarSyncStatus: "none",
      calendarSyncError: null,
      calendarUpdatedAt: now,
      meetingLink: sql`coalesce(${schema.bookings.meetingLinkOverride}, ${schema.bookings.meetingLinkSnapshot})`,
    })
    .where(
      and(
        eq(schema.bookings.ownerId, ownerId),
        lte(schema.bookings.endsAt, now),
      ),
    );
  await db
    .update(schema.bookings)
    .set({
      calendarEventId: null,
      calendarRevision: sql`${schema.bookings.calendarRevision} + 1`,
      meetingLink: sql`coalesce(${schema.bookings.meetingLinkOverride}, ${schema.bookings.meetingLinkSnapshot})`,
    })
    .where(
      and(
        eq(schema.bookings.ownerId, ownerId),
        inArray(schema.bookings.status, ["confirmed", "cancelled"]),
        gt(schema.bookings.endsAt, now),
        isNotNull(schema.bookings.calendarProvider),
        ne(schema.bookings.calendarProvider, provider),
      ),
    );
  await db
    .update(schema.bookings)
    .set({
      calendarProvider: provider,
      // Same-provider reconnects preserve id/revision and PATCH the original
      // event (or recreate after 404). Provider switches were cleared above
      // because an opaque id from the other API may be rejected before 404.
      calendarSyncStatus: "pending",
      calendarUpdatedAt: now,
      meetingLink: sql`coalesce(${schema.bookings.meetingLinkOverride}, ${schema.bookings.meetingLinkSnapshot})`,
      mailRecoveryCheckedAt: null,
    })
    .where(
      and(
        eq(schema.bookings.ownerId, ownerId),
        inArray(schema.bookings.status, ["confirmed", "cancelled"]),
        gt(schema.bookings.endsAt, now),
      ),
    );
}

/** Retry calendar mutations after transient provider failures. */
export async function retryCalendarSync(db: Db, limit = 25) {
  const rows = await db.query.bookings.findMany({
    where: inArray(schema.bookings.calendarSyncStatus, ["failed", "pending"]),
    // Crashed-before-first-attempt rows have no timestamp and go first. Every
    // attempted failure receives a fresh timestamp, moving it behind other due
    // work so one revoked account cannot starve the entire queue.
    orderBy: [
      sql`${schema.bookings.calendarUpdatedAt} asc nulls first`,
      asc(schema.bookings.createdAt),
    ],
    limit,
  });
  let synced = 0;
  for (const booking of rows) {
    const result = await syncBookingCalendar(
      db,
      booking,
    );
    if (result.ok) synced += 1;
  }
  return { attempted: rows.length, synced };
}

/** Remove provider state when a calendar is disconnected, without touching bookings. */
export async function clearOwnerCalendarState(db: Db, ownerId: string) {
  await db
    .update(schema.bookings)
    .set({
      calendarProvider: null,
      calendarEventId: null,
      calendarSyncStatus: "none",
      calendarSyncError: null,
      calendarUpdatedAt: new Date(),
      meetingLink: sql`coalesce(${schema.bookings.meetingLinkOverride}, ${schema.bookings.meetingLinkSnapshot})`,
    })
    .where(
      and(
        eq(schema.bookings.ownerId, ownerId),
        inArray(schema.bookings.status, ["confirmed", "cancelled"]),
      ),
    );
}
