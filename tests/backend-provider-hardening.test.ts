import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "../src/db/schema";
import {
  calendarBusy,
  hardenCalendarTokens,
} from "../src/lib/calendar";

async function apply(pg: PGlite, name: string) {
  const migration = readFileSync(
    new URL(`../drizzle/${name}`, import.meta.url),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await pg.exec(statement);
  }
}

describe("backend provider hardening", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("upgrades static-link/action-intent columns without reviving stale mail", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(`
        CREATE TABLE "services" (
          "id" uuid PRIMARY KEY,
          "owner_id" uuid NOT NULL,
          "meeting_link" text
        );
        CREATE TABLE "bookings" (
          "id" uuid PRIMARY KEY,
          "owner_id" uuid NOT NULL,
          "service_id" uuid NOT NULL,
          "ends_at" timestamp with time zone NOT NULL,
          "last_action_key" text,
          "mail_recovery_checked_at" timestamp with time zone,
          "meeting_link" text,
          "calendar_provider" text
        );
        CREATE TABLE "booking_actions" (
          "id" uuid PRIMARY KEY,
          "action_key" text NOT NULL,
          "mail_recovery_checked_at" timestamp with time zone
        );
        INSERT INTO "services" VALUES
          ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', ' https://zoom.example/static ');
        INSERT INTO "bookings" VALUES
          ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '2099-08-01T10:00:00Z', 'action-future', '2026-07-01T00:00:00Z', 'https://meet.google.com/provider', NULL),
          ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '2020-08-01T10:00:00Z', 'action-past', '2026-07-01T00:00:00Z', 'https://meet.google.com/old', 'google');
        INSERT INTO "booking_actions" VALUES
          ('00000000-0000-4000-8000-000000000031', 'action-future', '2026-07-01T00:00:00Z'),
          ('00000000-0000-4000-8000-000000000032', 'action-past', '2026-07-01T00:00:00Z');
      `);

      await apply(pg, "0015_brief_gambit.sql");
      const bookings = await pg.query<{
        meeting_link_snapshot: string | null;
        meeting_link: string | null;
        initial_intent_hash: string | null;
        mail_recovery_checked_at: Date | null;
      }>(`
        SELECT "meeting_link_snapshot", "meeting_link", "initial_intent_hash", "mail_recovery_checked_at"
        FROM "bookings" ORDER BY "id"
      `);
      expect(bookings.rows[0]).toMatchObject({
        meeting_link_snapshot: "https://zoom.example/static",
        meeting_link: "https://zoom.example/static",
        initial_intent_hash: null,
        mail_recovery_checked_at: null,
      });
      expect(bookings.rows[1].mail_recovery_checked_at).not.toBeNull();

      const actions = await pg.query<{
        client_timezone_intent: string | null;
        mail_recovery_checked_at: Date | null;
      }>(`
        SELECT "client_timezone_intent", "mail_recovery_checked_at"
        FROM "booking_actions" ORDER BY "id"
      `);
      expect(actions.rows[0]).toMatchObject({
        client_timezone_intent: null,
        mail_recovery_checked_at: null,
      });
      expect(actions.rows[1].mail_recovery_checked_at).not.toBeNull();
    } finally {
      await pg.close();
    }
  });

  it("encrypts every legacy credential and serializes provider reads", async () => {
    vi.stubEnv(
      "AUTH_TOKEN_SECRET",
      "test-calendar-token-secret-with-more-than-32-characters",
    );
    const pg = new PGlite();
    try {
      await pg.exec(`
        CREATE TYPE "calendar_provider" AS ENUM ('google', 'outlook', 'apple');
        CREATE TABLE "calendar_connections" (
          "id" uuid PRIMARY KEY,
          "owner_id" uuid NOT NULL,
          "provider" "calendar_provider" NOT NULL,
          "access_token" text NOT NULL,
          "refresh_token" text,
          "sync_state" text,
          "sync_status" text DEFAULT 'connected' NOT NULL,
          "last_synced_at" timestamp with time zone,
          "last_error" text,
          "connected_at" timestamp with time zone DEFAULT now() NOT NULL
        );
        INSERT INTO "calendar_connections"
          ("id", "owner_id", "provider", "access_token", "refresh_token")
        VALUES
          ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000001', 'google', 'legacy-access', 'legacy-refresh');
      `);
      const db = drizzle(pg, { schema });
      await expect(hardenCalendarTokens(db)).resolves.toBe(1);
      await expect(hardenCalendarTokens(db)).resolves.toBe(0);
      const [connection] = await db.query.calendarConnections.findMany();
      expect(connection.accessToken).toMatch(/^enc:v1:/);
      expect(connection.refreshToken).toMatch(/^enc:v1:/);
      expect(connection.accessToken).not.toContain("legacy-access");
      expect(connection.refreshToken).not.toContain("legacy-refresh");

      let active = 0;
      let maximumActive = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return new Response(
            JSON.stringify({ calendars: { primary: { busy: [] } } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }),
      );
      const from = new Date("2026-08-01T00:00:00Z");
      const to = new Date("2026-08-02T00:00:00Z");
      await Promise.all([
        calendarBusy({ ...connection }, from, to, db),
        calendarBusy({ ...connection }, from, to, db),
      ]);
      expect(maximumActive).toBe(1);
    } finally {
      await pg.close();
    }
  });
});
