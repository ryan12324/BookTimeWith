import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("booking snapshot migration", () => {
  it("backfills mine/theirs semantics before enforcing required snapshots", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(`
        CREATE TYPE "location_mode" AS ENUM ('mine', 'theirs');
        CREATE TABLE "owners" (
          "id" uuid PRIMARY KEY
        );
        CREATE TABLE "services" (
          "id" uuid PRIMARY KEY,
          "owner_id" uuid NOT NULL,
          "name" text NOT NULL,
          "location_mode" "location_mode" NOT NULL,
          "owner_address" text
        );
        CREATE TABLE "bookings" (
          "id" uuid PRIMARY KEY,
          "owner_id" uuid NOT NULL,
          "service_id" uuid NOT NULL,
          "client_address" text
        );
        CREATE TABLE "stripe_events" (
          "event_id" text PRIMARY KEY,
          "owner_id" uuid,
          CONSTRAINT "stripe_events_owner_id_owners_id_fk"
            FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE SET NULL
        );

        INSERT INTO "owners" ("id")
        VALUES ('00000000-0000-4000-8000-000000000001');
        INSERT INTO "services"
          ("id", "owner_id", "name", "location_mode", "owner_address")
        VALUES
          ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Original consultation', 'mine', '20 Original Road'),
          ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'Home visit', 'theirs', NULL);
        INSERT INTO "bookings"
          ("id", "owner_id", "service_id", "client_address")
        VALUES
          ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', NULL),
          ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012', '10 High Street');
        INSERT INTO "stripe_events" ("event_id", "owner_id")
        VALUES ('evt_123', '00000000-0000-4000-8000-000000000001');
      `);

      const migration = readFileSync(
        new URL("../drizzle/0012_easy_loa.sql", import.meta.url),
        "utf8",
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await pg.exec(statement);
      }

      const snapshots = await pg.query<{
        service_name_snapshot: string;
        location_mode_snapshot: "mine" | "theirs";
        location_snapshot: string | null;
      }>(`
        SELECT
          "service_name_snapshot",
          "location_mode_snapshot",
          "location_snapshot"
        FROM "bookings"
        ORDER BY "id"
      `);
      expect(snapshots.rows).toEqual([
        {
          service_name_snapshot: "Original consultation",
          location_mode_snapshot: "mine",
          location_snapshot: "20 Original Road",
        },
        {
          service_name_snapshot: "Home visit",
          location_mode_snapshot: "theirs",
          location_snapshot: "10 High Street",
        },
      ]);

      await expect(
        pg.exec(`
          INSERT INTO "bookings" ("id", "owner_id", "service_id")
          VALUES (
            '00000000-0000-4000-8000-000000000023',
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000011'
          )
        `),
      ).rejects.toThrow();

      await pg.exec(
        `DELETE FROM "owners" WHERE "id" = '00000000-0000-4000-8000-000000000001'`,
      );
      const stripeEvents = await pg.query(`SELECT * FROM "stripe_events"`);
      expect(stripeEvents.rows).toHaveLength(0);
    } finally {
      await pg.close();
    }
  });
});
