import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { getDb, type Db } from "@/db/client";
import { isFreeForOwner, mintManageToken } from "@/db/repo";
import {
  clientConfirmationDedupeKey,
  clientOwnerChangedDedupeKey,
  sendClientBookingConfirmation,
  sendClientOwnerChanged,
} from "@/emails/send";
import { sessionOwner } from "@/lib/authz";
import { syncBookingCalendar } from "@/lib/booking-calendar";
import { CalendarUnavailableError } from "@/lib/calendar";
import { canonicalBookingUrl } from "@/lib/urls";
import { withBookingMutex, withOwnerMutex } from "@/lib/keyed-mutex";
import { assertSessionConfiguration } from "@/lib/session";

export const dynamic = "force-dynamic";

const actionKey = z.string().min(16).max(128);
const reason = z.string().trim().max(500).optional();
const ActionInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("move"),
    startsAt: z.string().datetime(),
    actionKey,
    reason,
  }),
  z.object({ action: z.literal("cancel"), actionKey, reason }),
  z.object({ action: z.literal("restore"), actionKey }),
]);

function matchesOwnerIntent(
  existing: typeof schema.bookingActions.$inferSelect,
  input: z.infer<typeof ActionInput>,
) {
  if (existing.actor !== "owner" || existing.action !== input.action) return false;
  if (
    input.action === "move" &&
    existing.toStartsAt?.getTime() !== new Date(input.startsAt).getTime()
  ) {
    return false;
  }
  return input.action === "restore"
    ? true
    : (existing.reason ?? "") === (input.reason ?? "");
}

const isSlotTaken = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  ((error as { code: string }).code === "23505" ||
    (error as { code: string }).code === "23P01");

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

async function recoverOwnerActionSideEffects(
  db: Db,
  requestUrl: string,
  owner: typeof schema.owners.$inferSelect,
  current: typeof schema.bookings.$inferSelect,
  action: typeof schema.bookingActions.$inferSelect,
): Promise<boolean> {
  let notificationBooking = current;
  if (["pending", "failed"].includes(current.calendarSyncStatus)) {
    await syncBookingCalendar(db, current);
    notificationBooking =
      (await db.query.bookings.findFirst({
        where: eq(schema.bookings.id, current.id),
      })) ?? current;
  }
  if (!action.fromStartsAt) return false;

  const kind = action.action === "cancel" ? "cancelled" : "moved";
  const dedupeKey =
    action.action === "restore"
      ? clientConfirmationDedupeKey(
          notificationBooking.id,
          notificationBooking.startsAt,
          action.actionKey,
        )
      : clientOwnerChangedDedupeKey(
          notificationBooking.id,
          kind,
          action.actionKey,
        );
  if (await hasQueuedEmail(db, dedupeKey)) return true;

  const manageToken = await mintManageToken(db, notificationBooking.id);
  return Boolean(
    action.action === "restore"
      ? await sendClientBookingConfirmation(db, {
          owner,
          booking: notificationBooking,
          manageToken,
          baseUrl: canonicalBookingUrl(requestUrl),
          rescheduled: true,
          actionKey: action.actionKey,
        }, { deferDelivery: true })
      : await sendClientOwnerChanged(db, {
          owner,
          booking: notificationBooking,
          kind,
          wasStart: action.fromStartsAt,
          manageToken,
          baseUrl: canonicalBookingUrl(requestUrl),
          reason: action.reason ?? undefined,
          actionKey: action.actionKey,
        }, { deferDelivery: true }),
  );
}

/** Owner move/cancel/restore with conditional state transitions and action idempotency. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Owner actions may need to send a stable client manage link. Validate the
  // signing key before changing durable booking state.
  try {
    assertSessionConfiguration();
  } catch {
    return NextResponse.json(
      { error: "Booking changes are temporarily unavailable." },
      { status: 503 },
    );
  }
  const db = await getDb();
  const owner = await sessionOwner(db);
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ActionInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid action", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const already = await priorAction(db, parsed.data.actionKey);
  if (already) {
    if (already.ownerId !== owner.id || already.bookingId !== id) {
      return NextResponse.json({ error: "Invalid action key" }, { status: 409 });
    }
    if (!matchesOwnerIntent(already, parsed.data)) {
      return NextResponse.json({ error: "Invalid action key" }, { status: 409 });
    }
    const current = await db.query.bookings.findFirst({
      where: and(eq(schema.bookings.id, id), eq(schema.bookings.ownerId, owner.id)),
    });
    if (!current || current.lastActionKey !== already.actionKey) {
      return NextResponse.json(
        {
          error: "That booking changed after this action. Refresh to see its current state.",
          status: current?.status,
          startsAt: current?.startsAt.toISOString(),
        },
        { status: 409 },
      );
    }
    // Recover a process death between the committed state transition and its
    // calendar/outbox side effects without creating a second capability row.
    const clientNoticeQueued = await recoverOwnerActionSideEffects(
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
      emailDeliveryConfigured: Boolean(process.env.EMAIL_WEBHOOK_URL),
      clientEmailQueued: Boolean(
        process.env.EMAIL_WEBHOOK_URL && clientNoticeQueued,
      ),
    });
  }

  const booking = await db.query.bookings.findFirst({
    where: and(eq(schema.bookings.id, id), eq(schema.bookings.ownerId, owner.id)),
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const wasStart = booking.startsAt;
  const durationMinutes = Math.round(
    (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
  );

  try {
    if (parsed.data.action === "move") {
      const startsAt = new Date(parsed.data.startsAt);
      const ownerReason = parsed.data.reason;
      if (startsAt.getTime() <= Date.now()) {
        return NextResponse.json(
          { error: "A booking can't be moved into the past." },
          { status: 422 },
        );
      }
      if (!(await isFreeForOwner(db, owner.id, startsAt, durationMinutes, id))) {
        return NextResponse.json(
          { error: "That overlaps another booking — pick another time." },
          { status: 409 },
        );
      }
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
      const updated = await withOwnerMutex(owner.id, async () => {
        if (!(await isFreeForOwner(db, owner.id, startsAt, durationMinutes, id))) {
          throw new Error("CONFIG_CHANGED");
        }
        return withBookingMutex(id, () => db.transaction(async (tx) => {
        await tx.execute(
          sql`select ${schema.owners.id} from ${schema.owners} where ${schema.owners.id} = ${owner.id} for update`,
        );
        const scoped = tx as unknown as Db;
        if (
          startsAt.getTime() <= Date.now() ||
          !(await isFreeForOwner(
            scoped,
            owner.id,
            startsAt,
            durationMinutes,
            id,
            false,
          ))
        ) {
          throw new Error("CONFIG_CHANGED");
        }
        await tx.insert(schema.bookingActions).values({
          ownerId: owner.id,
          bookingId: id,
          actionKey: parsed.data.actionKey,
          action: "move",
          actor: "owner",
          reason: ownerReason || null,
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
            lastActionBy: "owner",
            lastActionKey: parsed.data.actionKey,
            calendarSyncStatus: "pending",
            calendarSyncError: null,
          })
          .where(
            and(
              eq(schema.bookings.id, id),
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
          .where(eq(schema.authTokens.bookingId, id));
        return row;
        }));
      });
      const manageToken = await mintManageToken(db, id);
      await syncBookingCalendar(db, updated);
      const notificationBooking =
        (await db.query.bookings.findFirst({
          where: eq(schema.bookings.id, updated.id),
        })) ?? updated;
      const clientNotice = await sendClientOwnerChanged(db, {
        owner,
        booking: notificationBooking,
        kind: "moved",
        wasStart,
        manageToken,
        baseUrl: canonicalBookingUrl(request.url),
        reason: ownerReason,
        actionKey: parsed.data.actionKey,
      }, { deferDelivery: true });
      return NextResponse.json({
        ok: true,
        startsAt: updated.startsAt.toISOString(),
        emailDeliveryConfigured: Boolean(process.env.EMAIL_WEBHOOK_URL),
        clientEmailQueued: Boolean(process.env.EMAIL_WEBHOOK_URL && clientNotice),
      });
    }

    if (parsed.data.action === "cancel") {
      const ownerReason = parsed.data.reason;
      const cancelManageExpiresAt = new Date(
        Math.max(booking.endsAt.getTime(), Date.now() + 7 * 86_400_000),
      );
      const updated = await withOwnerMutex(owner.id, () =>
        withBookingMutex(id, () => db.transaction(async (tx) => {
        await tx.insert(schema.bookingActions).values({
          ownerId: owner.id,
          bookingId: id,
          actionKey: parsed.data.actionKey,
          action: "cancel",
          actor: "owner",
          reason: ownerReason || null,
          fromStartsAt: wasStart,
        });
        const [row] = await tx
          .update(schema.bookings)
          .set({
            status: "cancelled",
            manageExpiresAt: cancelManageExpiresAt,
            lastActionBy: "owner",
            lastActionKey: parsed.data.actionKey,
            calendarRevision: sql`${schema.bookings.calendarRevision} + 1`,
            calendarSyncStatus: "pending",
            calendarSyncError: null,
          })
          .where(
            and(
              eq(schema.bookings.id, id),
              eq(schema.bookings.ownerId, owner.id),
              eq(schema.bookings.status, "confirmed"),
              eq(schema.bookings.startsAt, wasStart),
            ),
          )
          .returning();
        if (!row) throw new Error("ACTION_CONFLICT");
        await tx
          .update(schema.authTokens)
          .set({ expiresAt: cancelManageExpiresAt })
          .where(eq(schema.authTokens.bookingId, id));
        return row;
        })),
      );
      await syncBookingCalendar(db, updated);
      const notificationBooking =
        (await db.query.bookings.findFirst({
          where: eq(schema.bookings.id, updated.id),
        })) ?? updated;
      const manageToken = await mintManageToken(db, id);
      const clientNotice = await sendClientOwnerChanged(db, {
        owner,
        booking: notificationBooking,
        kind: "cancelled",
        wasStart,
        manageToken,
        baseUrl: canonicalBookingUrl(request.url),
        reason: ownerReason,
        actionKey: parsed.data.actionKey,
      }, { deferDelivery: true });
      return NextResponse.json({
        ok: true,
        emailDeliveryConfigured: Boolean(process.env.EMAIL_WEBHOOK_URL),
        clientEmailQueued: Boolean(process.env.EMAIL_WEBHOOK_URL && clientNotice),
      });
    }

    if (wasStart.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "A past booking can't be restored." },
        { status: 422 },
      );
    }
    if (!(await isFreeForOwner(db, owner.id, wasStart, durationMinutes, id))) {
      return NextResponse.json(
        { error: "That time is no longer free, so this booking can't be restored." },
        { status: 409 },
      );
    }

    const updated = await withOwnerMutex(owner.id, async () => {
      if (!(await isFreeForOwner(db, owner.id, wasStart, durationMinutes, id))) {
        throw new Error("CONFIG_CHANGED");
      }
      return withBookingMutex(id, () => db.transaction(async (tx) => {
      await tx.execute(
        sql`select ${schema.owners.id} from ${schema.owners} where ${schema.owners.id} = ${owner.id} for update`,
      );
      const scoped = tx as unknown as Db;
      if (
        wasStart.getTime() <= Date.now() ||
        !(await isFreeForOwner(
          scoped,
          owner.id,
          wasStart,
          durationMinutes,
          id,
          false,
        ))
      ) {
        throw new Error("CONFIG_CHANGED");
      }
      await tx.insert(schema.bookingActions).values({
        ownerId: owner.id,
        bookingId: id,
        actionKey: parsed.data.actionKey,
        action: "restore",
        actor: "owner",
        fromStartsAt: wasStart,
        toStartsAt: wasStart,
      });
      const [row] = await tx
        .update(schema.bookings)
        .set({
          status: "confirmed",
          manageExpiresAt: booking.endsAt,
          lastActionBy: "owner",
          lastActionKey: parsed.data.actionKey,
          calendarRevision: sql`${schema.bookings.calendarRevision} + 1`,
          calendarSyncStatus: "pending",
          calendarSyncError: null,
        })
        .where(
          and(
            eq(schema.bookings.id, id),
            eq(schema.bookings.ownerId, owner.id),
            eq(schema.bookings.status, "cancelled"),
            eq(schema.bookings.startsAt, wasStart),
          ),
        )
        .returning();
      if (!row) throw new Error("ACTION_CONFLICT");
      await tx
        .update(schema.authTokens)
        .set({ expiresAt: row.endsAt })
        .where(eq(schema.authTokens.bookingId, id));
      return row;
      }));
    });
    await syncBookingCalendar(db, updated);
    const notificationBooking =
      (await db.query.bookings.findFirst({
        where: eq(schema.bookings.id, updated.id),
      })) ?? updated;
    const manageToken = await mintManageToken(db, id);
    const clientNotice = await sendClientBookingConfirmation(db, {
      owner,
      booking: notificationBooking,
      manageToken,
      baseUrl: canonicalBookingUrl(request.url),
      rescheduled: true,
      actionKey: parsed.data.actionKey,
    }, { deferDelivery: true });
    return NextResponse.json({
      ok: true,
      status: updated.status,
      emailDeliveryConfigured: Boolean(process.env.EMAIL_WEBHOOK_URL),
      clientEmailQueued: Boolean(process.env.EMAIL_WEBHOOK_URL && clientNotice),
    });
  } catch (error) {
    const existing = await priorAction(db, parsed.data.actionKey);
    if (existing?.ownerId === owner.id && existing.bookingId === id) {
      if (!matchesOwnerIntent(existing, parsed.data)) {
        return NextResponse.json({ error: "Invalid action key" }, { status: 409 });
      }
      const current = await db.query.bookings.findFirst({
        where: and(eq(schema.bookings.id, id), eq(schema.bookings.ownerId, owner.id)),
      });
      if (current?.lastActionKey === existing.actionKey) {
        const clientNoticeQueued = await recoverOwnerActionSideEffects(
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
          emailDeliveryConfigured: Boolean(process.env.EMAIL_WEBHOOK_URL),
          clientEmailQueued: Boolean(
            process.env.EMAIL_WEBHOOK_URL && clientNoticeQueued,
          ),
        });
      }
      return NextResponse.json(
        { error: "That booking changed after this action. Refresh to see it." },
        { status: 409 },
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
        { error: "That time changed while you were saving. Pick another." },
        { status: 409 },
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
        { error: "That time just went — pick another." },
        { status: 409 },
      );
    }
    throw error;
  }
}
