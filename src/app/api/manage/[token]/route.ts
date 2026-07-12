import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { getDb, type Db } from "@/db/client";
import { bookingByManageToken, isBookableInstant, mintManageToken } from "@/db/repo";
import {
  clientConfirmationDedupeKey,
  ownerClientChangedDedupeKey,
  sendClientBookingConfirmation,
  sendOwnerClientChanged,
} from "@/emails/send";
import { syncBookingCalendar } from "@/lib/booking-calendar";
import { canClientChangeBooking } from "@/lib/booking-cutoff";
import { CalendarUnavailableError } from "@/lib/calendar";
import { canonicalBookingUrl } from "@/lib/urls";
import { isIanaZone } from "@/lib/timezone";
import { matchesClientActionIntent } from "@/lib/booking-intent";
import { withBookingMutex, withOwnerMutex } from "@/lib/keyed-mutex";
import { assertSessionConfiguration } from "@/lib/session";
import { isEmailTransportConfigured } from "@/emails/transports/factory";

export const dynamic = "force-dynamic";

const isSlotTaken = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  ((error as { code: string }).code === "23505" ||
    (error as { code: string }).code === "23P01");

async function context(db: Awaited<ReturnType<typeof getDb>>, token: string) {
  const booking = await bookingByManageToken(db, token);
  if (!booking) return null;
  const owner = await db.query.owners.findFirst({
    where: eq(schema.owners.id, booking.ownerId),
  });
  if (!owner) return null;
  return { booking, owner };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const db = await getDb();
  const { token } = await params;
  const ctx = await context(db, token);
  if (!ctx) return NextResponse.json({ error: "expired" }, { status: 404 });
  const { booking } = ctx;
  return NextResponse.json({
    booking: {
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      clientName: booking.clientName,
      status: booking.status,
      durationMinutes: Math.round(
        (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
      ),
      service: booking.serviceNameSnapshot,
      locationMode: booking.locationModeSnapshot,
      location: booking.locationSnapshot,
      meetingLink: booking.meetingLink,
      calendarSyncStatus: booking.calendarSyncStatus,
    },
    canChange:
      booking.status === "confirmed" && canClientChangeBooking(booking.startsAt),
  });
}

const actionKey = z.string().min(16).max(128);
const clientTimezone = z
  .string()
  .min(1)
  .max(100)
  .refine(isIanaZone, "Invalid IANA timezone")
  .optional();
const ManageAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("move"),
    startsAt: z.string().datetime(),
    actionKey,
    clientTimezone,
  }),
  z.object({ action: z.literal("cancel"), actionKey, clientTimezone }),
]);

async function priorAction(db: Db, key: string) {
  return db.query.bookingActions.findFirst({
    where: eq(schema.bookingActions.actionKey, key),
  });
}

async function hasQueuedEmail(db: Db, dedupeKey: string) {
  const row = await db.query.emailOutbox.findFirst({
    where: eq(schema.emailOutbox.dedupeKey, dedupeKey),
  });
  return Boolean(row && row.delivery !== "expired");
}

async function recoverClientActionSideEffects(
  db: Db,
  requestUrl: string,
  owner: typeof schema.owners.$inferSelect,
  current: typeof schema.bookings.$inferSelect,
  action: typeof schema.bookingActions.$inferSelect,
): Promise<boolean> {
  let calendarUpdated = current.calendarSyncStatus === "synced";
  let notificationBooking = current;
  if (["pending", "failed"].includes(current.calendarSyncStatus)) {
    calendarUpdated = (await syncBookingCalendar(db, current)).ok;
    notificationBooking =
      (await db.query.bookings.findFirst({
        where: eq(schema.bookings.id, current.id),
      })) ?? current;
  }
  if (!action.fromStartsAt) return false;

  const kind = action.action === "cancel" ? "cancelled" : "moved";
  const ownerKey = ownerClientChangedDedupeKey(
    notificationBooking.id,
    kind,
    action.actionKey,
  );
  let ownerNoticeQueued = await hasQueuedEmail(db, ownerKey);
  if (!ownerNoticeQueued) {
    ownerNoticeQueued = Boolean(
      await sendOwnerClientChanged(db, {
        owner,
        booking: notificationBooking,
        kind,
        wasStart: action.fromStartsAt,
        calendarUpdated,
        actionKey: action.actionKey,
      }, { deferDelivery: true }),
    );
  }

  if (action.action === "move") {
    const confirmationKey = clientConfirmationDedupeKey(
      notificationBooking.id,
      notificationBooking.startsAt,
      action.actionKey,
    );
    if (!(await hasQueuedEmail(db, confirmationKey))) {
      const manageToken = await mintManageToken(db, notificationBooking.id);
      await sendClientBookingConfirmation(db, {
        owner,
        booking: notificationBooking,
        manageToken,
        baseUrl: canonicalBookingUrl(requestUrl),
        rescheduled: true,
        actionKey: action.actionKey,
      }, { deferDelivery: true });
    }
  }
  return ownerNoticeQueued;
}

/** Client reschedule/cancel with cutoff, idempotency and conditional transitions. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  // Move recovery and confirmation always mint a signed manage link. Never
  // commit a lifecycle transition that the server cannot return or email.
  try {
    assertSessionConfiguration();
  } catch {
    return NextResponse.json(
      { error: "Booking changes are temporarily unavailable." },
      { status: 503 },
    );
  }
  const db = await getDb();
  const { token } = await params;
  const ctx = await context(db, token);
  if (!ctx) return NextResponse.json({ error: "expired" }, { status: 404 });
  const { booking, owner } = ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ManageAction.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid action", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const already = await priorAction(db, parsed.data.actionKey);
  if (already) {
    if (already.ownerId !== owner.id || already.bookingId !== booking.id) {
      return NextResponse.json({ error: "Invalid action key" }, { status: 409 });
    }
    if (!matchesClientActionIntent(already, parsed.data)) {
      return NextResponse.json({ error: "Invalid action key" }, { status: 409 });
    }
    const current = await db.query.bookings.findFirst({
      where: eq(schema.bookings.id, booking.id),
    });
    if (!current || current.lastActionKey !== already.actionKey) {
      return NextResponse.json(
        {
          error: "This booking changed after that action. Reload to see its current state.",
          status: current?.status,
          startsAt: current?.startsAt.toISOString(),
        },
        { status: 409 },
      );
    }
    const ownerNoticeQueued = await recoverClientActionSideEffects(
      db,
      request.url,
      owner,
      current,
      already,
    );
    return NextResponse.json({
      ok: true,
      idempotent: true,
      startsAt: current?.startsAt.toISOString(),
      status: current?.status,
      emailDeliveryConfigured: isEmailTransportConfigured(),
      ownerNotified: Boolean(
        isEmailTransportConfigured() && ownerNoticeQueued,
      ),
    });
  }

  if (booking.status !== "confirmed") {
    return NextResponse.json(
      { error: "This booking is no longer active and can't be changed." },
      { status: 409 },
    );
  }

  if (!canClientChangeBooking(booking.startsAt)) {
    return NextResponse.json(
      {
        error:
          "Less than 24 hours to go — changes are locked. Reply to your confirmation email if something's come up.",
      },
      { status: 403 },
    );
  }

  const wasStart = booking.startsAt;
  const durationMinutes = Math.round(
    (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
  );
  try {
    if (parsed.data.action === "move") {
      const startsAt = new Date(parsed.data.startsAt);
      if (!(await isBookableInstant(db, owner.id, startsAt, new Date(), booking.id))) {
        return NextResponse.json(
          { error: "That time isn't available — pick another." },
          { status: 422 },
        );
      }
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
      const updated = await withOwnerMutex(owner.id, async () => {
        if (!(await isBookableInstant(db, owner.id, startsAt, new Date(), booking.id))) {
          throw new Error("CONFIG_CHANGED");
        }
        return withBookingMutex(booking.id, () => db.transaction(async (tx) => {
        if (!canClientChangeBooking(wasStart)) {
          throw new Error("CUTOFF_REACHED");
        }
        await tx.execute(
          sql`select ${schema.owners.id} from ${schema.owners} where ${schema.owners.id} = ${owner.id} for update`,
        );
        const scoped = tx as unknown as Awaited<ReturnType<typeof getDb>>;
        if (
          !(await isBookableInstant(
            scoped,
            owner.id,
            startsAt,
            new Date(),
            booking.id,
            false,
          ))
        ) {
          throw new Error("CONFIG_CHANGED");
        }
        await tx.insert(schema.bookingActions).values({
          ownerId: owner.id,
          bookingId: booking.id,
          actionKey: parsed.data.actionKey,
          action: "move",
          actor: "client",
          clientTimezoneIntent: parsed.data.clientTimezone ?? "",
          fromStartsAt: wasStart,
          toStartsAt: startsAt,
        });
        const [row] = await tx
          .update(schema.bookings)
          .set({
            startsAt,
            endsAt,
            manageExpiresAt: endsAt,
            status: "confirmed",
            lastActionBy: "client",
            lastActionKey: parsed.data.actionKey,
            clientTimezone:
              parsed.data.clientTimezone ?? booking.clientTimezone,
            calendarSyncStatus: "pending",
            calendarSyncError: null,
          })
          .where(
            and(
              eq(schema.bookings.id, booking.id),
              eq(schema.bookings.ownerId, owner.id),
              eq(schema.bookings.status, "confirmed"),
              eq(schema.bookings.startsAt, wasStart),
            ),
          )
          .returning();
        if (!row) throw new Error("ACTION_CONFLICT");
        await tx
          .update(schema.authTokens)
          .set({ expiresAt: endsAt })
          .where(eq(schema.authTokens.bookingId, booking.id));
        return row;
        }));
      });
      const manageToken = await mintManageToken(db, booking.id);
      const calendar = await syncBookingCalendar(db, updated);
      const notificationBooking =
        (await db.query.bookings.findFirst({
          where: eq(schema.bookings.id, updated.id),
        })) ?? updated;
      const [ownerNotice] = await Promise.all([
        sendOwnerClientChanged(db, {
          owner,
          booking: notificationBooking,
          kind: "moved",
          wasStart,
          calendarUpdated: calendar.ok,
          actionKey: parsed.data.actionKey,
        }, { deferDelivery: true }),
        sendClientBookingConfirmation(db, {
          owner,
          booking: notificationBooking,
          manageToken,
          baseUrl: canonicalBookingUrl(request.url),
          rescheduled: true,
          actionKey: parsed.data.actionKey,
        }, { deferDelivery: true }),
      ]);
      return NextResponse.json({
        ok: true,
        startsAt: updated.startsAt.toISOString(),
        emailDeliveryConfigured: isEmailTransportConfigured(),
        ownerNotified: Boolean(isEmailTransportConfigured() && ownerNotice),
      });
    }

    const updated = await withOwnerMutex(owner.id, () =>
      withBookingMutex(booking.id, () => db.transaction(async (tx) => {
      if (!canClientChangeBooking(wasStart)) {
        throw new Error("CUTOFF_REACHED");
      }
      await tx.insert(schema.bookingActions).values({
        ownerId: owner.id,
        bookingId: booking.id,
        actionKey: parsed.data.actionKey,
        action: "cancel",
        actor: "client",
        clientTimezoneIntent: parsed.data.clientTimezone ?? "",
        fromStartsAt: wasStart,
      });
      const [row] = await tx
        .update(schema.bookings)
        .set({
          status: "cancelled",
          lastActionBy: "client",
          lastActionKey: parsed.data.actionKey,
          clientTimezone:
            parsed.data.clientTimezone ?? booking.clientTimezone,
          calendarRevision: sql`${schema.bookings.calendarRevision} + 1`,
          calendarSyncStatus: "pending",
          calendarSyncError: null,
        })
        .where(
          and(
            eq(schema.bookings.id, booking.id),
            eq(schema.bookings.ownerId, owner.id),
            eq(schema.bookings.status, "confirmed"),
            eq(schema.bookings.startsAt, wasStart),
          ),
        )
        .returning();
      if (!row) throw new Error("ACTION_CONFLICT");
      return row;
      })),
    );
    const calendar = await syncBookingCalendar(db, updated);
    const notificationBooking =
      (await db.query.bookings.findFirst({
        where: eq(schema.bookings.id, updated.id),
      })) ?? updated;
    const ownerNotice = await sendOwnerClientChanged(db, {
      owner,
      booking: notificationBooking,
      kind: "cancelled",
      wasStart,
      calendarUpdated: calendar.ok,
      actionKey: parsed.data.actionKey,
    }, { deferDelivery: true });
    return NextResponse.json({
      ok: true,
      emailDeliveryConfigured: isEmailTransportConfigured(),
      ownerNotified: Boolean(isEmailTransportConfigured() && ownerNotice),
    });
  } catch (error) {
    const existing = await priorAction(db, parsed.data.actionKey);
    if (existing?.ownerId === owner.id && existing.bookingId === booking.id) {
      if (!matchesClientActionIntent(existing, parsed.data)) {
        return NextResponse.json({ error: "Invalid action key" }, { status: 409 });
      }
      const current = await db.query.bookings.findFirst({
        where: eq(schema.bookings.id, booking.id),
      });
      if (current?.lastActionKey === existing.actionKey) {
        const ownerNoticeQueued = await recoverClientActionSideEffects(
          db,
          request.url,
          owner,
          current,
          existing,
        );
        return NextResponse.json({
          ok: true,
          idempotent: true,
          startsAt: current.startsAt.toISOString(),
          status: current.status,
          emailDeliveryConfigured: isEmailTransportConfigured(),
          ownerNotified: Boolean(
            isEmailTransportConfigured() && ownerNoticeQueued,
          ),
        });
      }
      return NextResponse.json(
        { error: "This booking changed after that action. Reload to see it." },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "CUTOFF_REACHED") {
      return NextResponse.json(
        {
          error:
            "Less than 24 hours to go — changes are locked. Reply to your confirmation email if something's come up.",
        },
        { status: 403 },
      );
    }
    if (error instanceof Error && error.message === "ACTION_CONFLICT") {
      return NextResponse.json(
        { error: "That booking changed in another request — refresh and try again." },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "CONFIG_CHANGED") {
      return NextResponse.json(
        { error: "Availability changed while you were choosing. Pick another time." },
        { status: 422 },
      );
    }
    if (error instanceof CalendarUnavailableError) {
      return NextResponse.json(
        { error: "Calendar availability is temporarily unavailable. Try again shortly." },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    if (isSlotTaken(error)) {
      return NextResponse.json(
        { error: "That time just went — here's what's still open." },
        { status: 409 },
      );
    }
    throw error;
  }
}
