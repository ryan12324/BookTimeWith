import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { mintManageToken } from "@/db/repo";
import {
  clientConfirmationDedupeKey,
  clientOwnerChangedDedupeKey,
  ownerClientChangedDedupeKey,
  ownerNewBookingDedupeKey,
  sendBookingEmails,
  sendClientBookingConfirmation,
  sendClientOwnerChanged,
  sendOwnerClientChanged,
} from "@/emails/send";

async function queued(db: Db, dedupeKey: string) {
  const row = await db.query.emailOutbox.findFirst({
    where: eq(schema.emailOutbox.dedupeKey, dedupeKey),
  });
  return Boolean(row && row.delivery !== "expired");
}

/**
 * Rebuild mail intents from durable booking/action ledgers after a process dies
 * between committing state and spooling its email. Dedupe keys and delivery
 * state guards make every repair safe to repeat.
 */
export async function recoverMissingBookingMail(
  db: Db,
  baseUrl: string,
  now = new Date(),
  limit = 20,
) {
  const candidateLimit = Math.max(limit, limit * 10);
  let inspected = 0;
  let recovered = 0;

  const initialBookings = await db.query.bookings.findMany({
    where: and(
      isNull(schema.bookings.lastActionKey),
      eq(schema.bookings.status, "confirmed"),
      gt(schema.bookings.endsAt, now),
    ),
    orderBy: (booking, { asc }) => [
      sql`${booking.mailRecoveryCheckedAt} asc nulls first`,
      asc(booking.createdAt),
    ],
    limit: candidateLimit,
  });
  for (const booking of initialBookings) {
    if (recovered >= limit) break;
    inspected += 1;
    try {
      // Let the separate calendar reconciler finish first so a recovered
      // confirmation contains the same final Meet/static link as the live path.
      if (
        booking.status !== "confirmed" ||
        booking.calendarSyncStatus === "pending"
      ) {
        continue;
      }
      const owner = await db.query.owners.findFirst({
        where: eq(schema.owners.id, booking.ownerId),
      });
      if (!owner) continue;
      const expected = [
        clientConfirmationDedupeKey(booking.id, booking.startsAt),
        ...(owner.notifyOnChange && owner.emailVerifiedAt
          ? [ownerNewBookingDedupeKey(booking.id, booking.startsAt)]
          : []),
      ];
      const missing = (
        await Promise.all(expected.map((key) => queued(db, key)))
      ).some((exists) => !exists);
      if (!missing) continue;
      const manageToken = await mintManageToken(db, booking.id);
      await sendBookingEmails(db, {
        owner,
        booking,
        manageToken,
        baseUrl,
      });
      recovered += 1;
    } catch (error) {
      log.error("email.booking_recovery.initial_failed", {
        bookingId: booking.id,
        error,
      });
    } finally {
      await db
        .update(schema.bookings)
        .set({ mailRecoveryCheckedAt: new Date() })
        .where(eq(schema.bookings.id, booking.id));
    }
  }

  const actions = await db.query.bookingActions.findMany({
    orderBy: (action, { asc }) => [
      sql`${action.mailRecoveryCheckedAt} asc nulls first`,
      asc(action.createdAt),
    ],
    limit: candidateLimit,
  });
  const actionRecoveryLimit = limit;
  for (const action of actions) {
    if (recovered >= actionRecoveryLimit) break;
    inspected += 1;
    try {
      const booking = await db.query.bookings.findFirst({
        where: and(
          eq(schema.bookings.id, action.bookingId),
          eq(schema.bookings.ownerId, action.ownerId),
        ),
      });
      if (
        !booking ||
        booking.lastActionKey !== action.actionKey ||
        booking.endsAt <= now ||
        booking.calendarSyncStatus === "pending"
      ) {
        continue;
      }
      const owner = await db.query.owners.findFirst({
        where: eq(schema.owners.id, action.ownerId),
      });
      if (!owner || !action.fromStartsAt) continue;

      const kind = action.action === "cancel" ? "cancelled" : "moved";
      if (action.actor === "client") {
        const ownerKey = ownerClientChangedDedupeKey(
          booking.id,
          kind,
          action.actionKey,
        );
        if (!(await queued(db, ownerKey))) {
          const queuedId = await sendOwnerClientChanged(db, {
            owner,
            booking,
            kind,
            wasStart: action.fromStartsAt,
            calendarUpdated: booking.calendarSyncStatus === "synced",
            actionKey: action.actionKey,
          });
          if (queuedId) recovered += 1;
        }
        if (action.action === "move") {
          const confirmationKey = clientConfirmationDedupeKey(
            booking.id,
            booking.startsAt,
            action.actionKey,
          );
          if (!(await queued(db, confirmationKey))) {
            const manageToken = await mintManageToken(db, booking.id);
            const queuedId = await sendClientBookingConfirmation(db, {
              owner,
              booking,
              manageToken,
              baseUrl,
              rescheduled: true,
              actionKey: action.actionKey,
            });
            if (queuedId) recovered += 1;
          }
        }
        continue;
      }

      if (action.action === "restore") {
        const confirmationKey = clientConfirmationDedupeKey(
          booking.id,
          booking.startsAt,
          action.actionKey,
        );
        if (!(await queued(db, confirmationKey))) {
          const manageToken = await mintManageToken(db, booking.id);
          const queuedId = await sendClientBookingConfirmation(db, {
            owner,
            booking,
            manageToken,
            baseUrl,
            rescheduled: true,
            actionKey: action.actionKey,
          });
          if (queuedId) recovered += 1;
        }
        continue;
      }

      if (action.action === "move" || action.action === "cancel") {
        const clientKey = clientOwnerChangedDedupeKey(
          booking.id,
          kind,
          action.actionKey,
        );
        if (!(await queued(db, clientKey))) {
          const manageToken = await mintManageToken(db, booking.id);
          const queuedId = await sendClientOwnerChanged(db, {
            owner,
            booking,
            kind,
            wasStart: action.fromStartsAt,
            manageToken,
            baseUrl,
            reason: action.reason ?? undefined,
            actionKey: action.actionKey,
          });
          if (queuedId) recovered += 1;
        }
      }
    } catch (error) {
      log.error("email.booking_recovery.action_failed", {
        actionId: action.id,
        error,
      });
    } finally {
      await db
        .update(schema.bookingActions)
        .set({ mailRecoveryCheckedAt: new Date() })
        .where(eq(schema.bookingActions.id, action.id));
    }
  }

  return { inspected, recovered };
}
import { log } from "@/lib/logger";
