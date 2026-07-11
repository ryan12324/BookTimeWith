import { eq, isNotNull, sql } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

export const OWNER_CRON_BATCH_SIZE = 50;
export const OWNER_REMINDER_BATCH_SIZE = 25;
// A 25-hour DST fallback day can contain at most 100 non-overlapping
// 15-minute appointments, so this remains a complete daily summary while
// placing a hard ceiling on materialization.
export const OWNER_SUMMARY_BATCH_SIZE = 100;

export type ScheduledOwner = typeof schema.owners.$inferSelect;
export type ScheduledOwnerErrorPhase = "jobs" | "cursor";

export function ownerLocalDayRange(dayKey: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const [year, month, day] = dayKey.split("-").map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (normalized.toISOString().slice(0, 10) !== dayKey) return null;
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
  return {
    startsAt: fromZonedTime(`${dayKey}T00:00:00`, timezone),
    endsAt: fromZonedTime(`${tomorrow}T00:00:00`, timezone),
  };
}

/**
 * Rotate bounded owner work fairly. An owner-level failure is isolated and the
 * cursor still advances, preventing one malformed account from starving every
 * owner after it on every five-minute run.
 */
export async function runScheduledOwnerBatch(
  db: Db,
  now: Date,
  run: (owner: ScheduledOwner) => Promise<void>,
  onError?: (
    owner: ScheduledOwner,
    error: unknown,
    phase: ScheduledOwnerErrorPhase,
  ) => void | Promise<void>,
) {
  const owners = await db.query.owners.findMany({
    where: isNotNull(schema.owners.setupCompletedAt),
    orderBy: (owner, { asc }) => [
      sql`${owner.cronCheckedAt} asc nulls first`,
      asc(owner.id),
    ],
    limit: OWNER_CRON_BATCH_SIZE,
  });

  let failed = 0;
  let cursorFailed = 0;
  const report = async (
    owner: ScheduledOwner,
    error: unknown,
    phase: ScheduledOwnerErrorPhase,
  ) => {
    try {
      await onError?.(owner, error, phase);
    } catch (reportingError) {
      console.error("Scheduled owner error reporting failed", reportingError);
    }
  };

  for (const owner of owners) {
    try {
      await run(owner);
    } catch (error) {
      failed += 1;
      await report(owner, error, "jobs");
    } finally {
      try {
        await db
          .update(schema.owners)
          .set({ cronCheckedAt: now })
          .where(eq(schema.owners.id, owner.id));
      } catch (error) {
        cursorFailed += 1;
        await report(owner, error, "cursor");
      }
    }
  }

  return { processed: owners.length, failed, cursorFailed };
}
