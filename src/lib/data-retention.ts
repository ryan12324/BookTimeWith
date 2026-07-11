import { and, asc, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

export const CLIENT_PII_RETENTION_DAYS = 730;
export const CLIENT_PII_BATCH_SIZE = 100;
export const ANONYMIZED_CLIENT_NAME = "Former client";
export const ANONYMIZED_CLIENT_EMAIL = "redacted@booktimewith.invalid";

/**
 * Remove client-identifying data from old appointments while retaining the
 * anonymous service/time/status history an owner may need for aggregate
 * business records. Every dependent scrub and the booking marker commit in one
 * transaction, and the marker makes subsequent runs idempotent.
 */
export async function anonymizeExpiredClientPii(
  db: Db,
  now = new Date(),
  requestedLimit = CLIENT_PII_BATCH_SIZE,
) {
  const limit = Math.min(
    CLIENT_PII_BATCH_SIZE,
    Math.max(0, Math.floor(requestedLimit)),
  );
  if (!limit) return { inspected: 0, anonymized: 0 };

  const cutoff = new Date(
    now.getTime() - CLIENT_PII_RETENTION_DAYS * 86_400_000,
  );

  return db.transaction(async (tx) => {
    const candidates = await tx.query.bookings.findMany({
      columns: { id: true },
      where: and(
        isNull(schema.bookings.clientPiiAnonymizedAt),
        lt(schema.bookings.endsAt, cutoff),
      ),
      orderBy: [asc(schema.bookings.endsAt), asc(schema.bookings.id)],
      limit,
    });
    if (!candidates.length) return { inspected: 0, anonymized: 0 };

    const bookingIds = candidates.map(({ id }) => id);

    await tx
      .update(schema.bookingActions)
      .set({
        actionKey: sql`'anonymized:' || ${schema.bookingActions.id}::text`,
        reason: null,
        clientTimezoneIntent: null,
      })
      .where(inArray(schema.bookingActions.bookingId, bookingIds));
    await tx
      .delete(schema.authTokens)
      .where(inArray(schema.authTokens.bookingId, bookingIds));
    await tx
      .delete(schema.emailOutbox)
      .where(inArray(schema.emailOutbox.bookingId, bookingIds));

    const anonymized = await tx
      .update(schema.bookings)
      .set({
        clientName: ANONYMIZED_CLIENT_NAME,
        clientEmail: ANONYMIZED_CLIENT_EMAIL,
        clientTimezone: null,
        clientAddress: null,
        locationSnapshot: null,
        meetingLinkSnapshot: null,
        meetingLink: null,
        lastActionKey: null,
        clientRequestKey: null,
        initialIntentHash: null,
        calendarProvider: null,
        calendarEventId: null,
        calendarRevision: 0,
        calendarSyncStatus: "none",
        calendarSyncError: null,
        calendarUpdatedAt: null,
        clientPiiAnonymizedAt: now,
      })
      .where(
        and(
          inArray(schema.bookings.id, bookingIds),
          isNull(schema.bookings.clientPiiAnonymizedAt),
          lt(schema.bookings.endsAt, cutoff),
        ),
      )
      .returning({ id: schema.bookings.id });

    return { inspected: candidates.length, anonymized: anonymized.length };
  });
}
