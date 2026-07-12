import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema";
import {
  ANONYMIZED_CLIENT_EMAIL,
  ANONYMIZED_CLIENT_NAME,
  anonymizeExpiredClientPii,
  CLIENT_PII_BATCH_SIZE,
  CLIENT_PII_RETENTION_DAYS,
} from "../src/lib/data-retention";
import {
  OWNER_CRON_BATCH_SIZE,
  OWNER_REMINDER_BATCH_SIZE,
  OWNER_SUMMARY_BATCH_SIZE,
  runScheduledOwnerBatch,
} from "../src/lib/scheduled-work";

function references(
  value: unknown,
  target: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (value === target) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).some((key) => {
    try {
      return references(Reflect.get(value, key), target, seen);
    } catch {
      return false;
    }
  });
}

function stringValues(
  value: unknown,
  seen = new WeakSet<object>(),
): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Reflect.ownKeys(value).flatMap((key) => {
    try {
      return stringValues(Reflect.get(value, key), seen);
    } catch {
      return [];
    }
  });
}

async function retentionDatabase(options: { rejectRedaction?: boolean } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "bookings" (
      "id" uuid PRIMARY KEY,
      "starts_at" timestamp with time zone NOT NULL,
      "ends_at" timestamp with time zone NOT NULL,
      "service_name_snapshot" text NOT NULL,
      "status" text NOT NULL,
      "client_name" text NOT NULL,
      "client_email" text NOT NULL${
        options.rejectRedaction
          ? ` CHECK ("client_email" <> '${ANONYMIZED_CLIENT_EMAIL}')`
          : ""
      },
      "client_timezone" text,
      "client_address" text,
      "location_snapshot" text,
      "meeting_link_snapshot" text,
      "meeting_link" text,
      "meeting_link_override" text,
      "last_action_key" text,
      "client_request_key" text,
      "initial_intent_hash" text,
      "calendar_provider" text,
      "calendar_event_id" text,
      "calendar_revision" integer NOT NULL DEFAULT 0,
      "calendar_sync_status" text NOT NULL DEFAULT 'none',
      "calendar_sync_error" text,
      "calendar_updated_at" timestamp with time zone,
      "client_pii_anonymized_at" timestamp with time zone
    );
    CREATE TABLE "booking_actions" (
      "id" uuid PRIMARY KEY,
      "booking_id" uuid NOT NULL,
      "action_key" text NOT NULL UNIQUE,
      "reason" text,
      "client_timezone_intent" text
    );
    CREATE TABLE "auth_tokens" (
      "id" uuid PRIMARY KEY,
      "booking_id" uuid
    );
    CREATE TABLE "email_outbox" (
      "id" uuid PRIMARY KEY,
      "booking_id" uuid
    );
  `);
  return { pg, db: drizzle(pg, { schema }) };
}

const bookingValues = (
  id: string,
  endsAt: string,
  anonymizedAt: string | null = null,
) => `(
  '${id}', '2024-07-10T09:00:00Z', '${endsAt}', 'Consultation', 'cancelled',
  'Alex Client', 'alex@example.com', 'America/New_York', '4 Private Road',
  '4 Private Road', 'https://zoom.example/private', 'https://meet.example/private',
  'https://whereby.example/private', 'action-private', 'request-private', 'hash-private', 'google', 'event-private',
  4, 'failed', 'client address in provider error', '2024-07-10T10:00:00Z',
  ${anonymizedAt ? `'${anonymizedAt}'` : "NULL"}
)`;

describe("bounded scheduled work", () => {
  it("rotates at most 50 setup-complete owners and advances past an isolated failure", async () => {
    type Owner = typeof schema.owners.$inferSelect;
    type FindOptions = {
      limit: number;
      where: unknown;
      orderBy: (
        owner: typeof schema.owners,
        operators: { asc: (column: unknown) => unknown },
      ) => unknown;
    };
    const owners = Array.from({ length: 55 }, (_, index) =>
      ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        handle: `owner-${index}`,
        setupCompletedAt: new Date(),
        cronCheckedAt: index % 2 ? new Date() : null,
      }) as Owner,
    );
    let options: FindOptions | undefined;
    const cursorWhere = vi.fn().mockResolvedValue(undefined);
    const cursorSet = vi.fn(() => ({ where: cursorWhere }));
    const db = {
      query: {
        owners: {
          findMany: vi.fn(async (input: FindOptions) => {
            options = input;
            return owners.slice(0, input.limit);
          }),
        },
      },
      update: vi.fn(() => ({ set: cursorSet })),
    } as unknown as Parameters<typeof runScheduledOwnerBatch>[0];
    const jobs = vi.fn(async (owner: Owner) => {
      if (owner.id === owners[0].id) throw new Error("isolated bad owner");
    });
    const errors = vi.fn();
    const now = new Date("2026-07-11T12:00:00Z");

    await expect(
      runScheduledOwnerBatch(db, now, jobs, errors),
    ).resolves.toEqual({ processed: 50, failed: 1, cursorFailed: 0 });
    expect(jobs).toHaveBeenCalledTimes(50);
    expect(cursorSet).toHaveBeenCalledTimes(50);
    expect(cursorSet).toHaveBeenCalledWith({ cronCheckedAt: now });
    expect(errors).toHaveBeenCalledWith(
      owners[0],
      expect.any(Error),
      "jobs",
    );
    expect(options?.limit).toBe(OWNER_CRON_BATCH_SIZE);
    expect(options?.where).toBeTruthy();
    const order = options?.orderBy(schema.owners, {
      asc: (column) => ({ column }),
    });
    expect(references(order, schema.owners.cronCheckedAt)).toBe(true);
    expect(stringValues(order).join(" ").toLowerCase()).toContain(
      "asc nulls first",
    );
  });

  it("keeps every scheduled materialization ceiling explicit", () => {
    expect(OWNER_CRON_BATCH_SIZE).toBe(50);
    expect(OWNER_REMINDER_BATCH_SIZE).toBe(25);
    expect(OWNER_SUMMARY_BATCH_SIZE).toBe(100);
    expect(CLIENT_PII_BATCH_SIZE).toBe(100);
    expect(CLIENT_PII_RETENTION_DAYS).toBe(730);
  });
});

describe("active-client PII retention", () => {
  it("atomically anonymizes expired client data and remains idempotent", async () => {
    const { pg, db } = await retentionDatabase();
    const expiredId = "00000000-0000-4000-8000-000000000001";
    const retainedId = "00000000-0000-4000-8000-000000000002";
    const alreadyDoneId = "00000000-0000-4000-8000-000000000003";
    try {
      await pg.exec(`
        INSERT INTO "bookings" VALUES
          ${bookingValues(expiredId, "2024-07-10T10:00:00Z")},
          ${bookingValues(retainedId, "2024-07-12T10:00:00Z")},
          ${bookingValues(alreadyDoneId, "2024-07-01T10:00:00Z", "2025-01-01T00:00:00Z")};
        INSERT INTO "booking_actions" VALUES
          ('10000000-0000-4000-8000-000000000001', '${expiredId}', 'client-request-private', 'Private medical reason', 'America/New_York'),
          ('10000000-0000-4000-8000-000000000002', '${retainedId}', 'client-request-retained', 'Keep for now', 'Europe/London');
        INSERT INTO "auth_tokens" VALUES
          ('20000000-0000-4000-8000-000000000001', '${expiredId}'),
          ('20000000-0000-4000-8000-000000000002', '${retainedId}');
        INSERT INTO "email_outbox" VALUES
          ('30000000-0000-4000-8000-000000000001', '${expiredId}'),
          ('30000000-0000-4000-8000-000000000002', '${retainedId}');
      `);
      const now = new Date("2026-07-11T12:00:00Z");

      await expect(anonymizeExpiredClientPii(db, now)).resolves.toEqual({
        inspected: 1,
        anonymized: 1,
      });
      const expired = await pg.query<Record<string, unknown>>(
        `SELECT * FROM "bookings" WHERE "id" = '${expiredId}'`,
      );
      expect(expired.rows[0]).toMatchObject({
        service_name_snapshot: "Consultation",
        status: "cancelled",
        client_name: ANONYMIZED_CLIENT_NAME,
        client_email: ANONYMIZED_CLIENT_EMAIL,
        client_timezone: null,
        client_address: null,
        location_snapshot: null,
        meeting_link_snapshot: null,
        meeting_link: null,
        meeting_link_override: null,
        last_action_key: null,
        client_request_key: null,
        initial_intent_hash: null,
        calendar_provider: null,
        calendar_event_id: null,
        calendar_revision: 0,
        calendar_sync_status: "none",
        calendar_sync_error: null,
        calendar_updated_at: null,
      });
      expect(
        new Date(expired.rows[0].client_pii_anonymized_at as string).toISOString(),
      ).toBe(now.toISOString());
      const action = await pg.query<{
        action_key: string;
        reason: string | null;
        client_timezone_intent: string | null;
      }>(`SELECT "action_key", "reason", "client_timezone_intent" FROM "booking_actions" WHERE "booking_id" = '${expiredId}'`);
      expect(action.rows[0]).toEqual({
        action_key: "anonymized:10000000-0000-4000-8000-000000000001",
        reason: null,
        client_timezone_intent: null,
      });
      const capabilities = await pg.query<{ source: string }>(`
        SELECT 'token' AS "source" FROM "auth_tokens" WHERE "booking_id" = '${expiredId}'
        UNION ALL
        SELECT 'mail' AS "source" FROM "email_outbox" WHERE "booking_id" = '${expiredId}'
      `);
      expect(capabilities.rows).toEqual([]);
      const retained = await pg.query<{ client_email: string; reason: string }>(`
        SELECT "booking"."client_email", "action"."reason"
        FROM "bookings" AS "booking"
        JOIN "booking_actions" AS "action" ON "action"."booking_id" = "booking"."id"
        WHERE "booking"."id" = '${retainedId}'
      `);
      expect(retained.rows[0]).toEqual({
        client_email: "alex@example.com",
        reason: "Keep for now",
      });

      await expect(anonymizeExpiredClientPii(db, now)).resolves.toEqual({
        inspected: 0,
        anonymized: 0,
      });
    } finally {
      await pg.close();
    }
  });

  it("rolls back dependent scrubs when the booking marker cannot commit", async () => {
    const { pg, db } = await retentionDatabase({ rejectRedaction: true });
    const bookingId = "00000000-0000-4000-8000-000000000011";
    try {
      await pg.exec(`
        INSERT INTO "bookings" VALUES ${bookingValues(bookingId, "2024-01-01T10:00:00Z")};
        INSERT INTO "booking_actions" VALUES
          ('10000000-0000-4000-8000-000000000011', '${bookingId}', 'request-must-survive', 'Must survive rollback', 'Europe/London');
        INSERT INTO "auth_tokens" VALUES
          ('20000000-0000-4000-8000-000000000011', '${bookingId}');
        INSERT INTO "email_outbox" VALUES
          ('30000000-0000-4000-8000-000000000011', '${bookingId}');
      `);

      await expect(
        anonymizeExpiredClientPii(db, new Date("2026-07-11T12:00:00Z")),
      ).rejects.toThrow();
      const retained = await pg.query<{
        client_email: string;
        reason: string;
        token_count: number;
        mail_count: number;
      }>(`
        SELECT
          "booking"."client_email",
          "action"."reason",
          (SELECT count(*)::int FROM "auth_tokens") AS "token_count",
          (SELECT count(*)::int FROM "email_outbox") AS "mail_count"
        FROM "bookings" AS "booking"
        JOIN "booking_actions" AS "action" ON "action"."booking_id" = "booking"."id"
        WHERE "booking"."id" = '${bookingId}'
      `);
      expect(retained.rows[0]).toEqual({
        client_email: "alex@example.com",
        reason: "Must survive rollback",
        token_count: 1,
        mail_count: 1,
      });
    } finally {
      await pg.close();
    }
  });
});
