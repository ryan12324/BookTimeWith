import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

async function apply(pg: PGlite, name: string) {
  const sql = readFileSync(
    new URL(`../drizzle/${name}`, import.meta.url),
    "utf8",
  );
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) await pg.exec(statement);
  }
}

describe("hardening migration upgrade path", () => {
  it("backfills capabilities/snapshots and expires unverifiable legacy mail", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(`
        CREATE TYPE "location_mode" AS ENUM ('mine', 'theirs');
        CREATE TABLE "owners" (
          "id" uuid PRIMARY KEY,
          "email" text NOT NULL,
          "session_version" integer NOT NULL DEFAULT 0
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
          "client_address" text,
          "ends_at" timestamp with time zone NOT NULL
        );
        CREATE TABLE "auth_tokens" (
          "id" uuid PRIMARY KEY,
          "kind" text NOT NULL,
          "booking_id" uuid,
          "expires_at" timestamp with time zone NOT NULL
        );
        CREATE TABLE "email_outbox" (
          "id" uuid PRIMARY KEY,
          "owner_id" uuid,
          "template" text NOT NULL,
          "to_email" text NOT NULL,
          "reply_to" text,
          "delivery" text NOT NULL,
          "last_error" text,
          "html" text NOT NULL,
          "attachments" text
        );
        CREATE TABLE "booking_actions" ("id" uuid PRIMARY KEY);
        CREATE TABLE "stripe_events" (
          "event_id" text PRIMARY KEY,
          "owner_id" uuid,
          CONSTRAINT "stripe_events_owner_id_owners_id_fk"
            FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE SET NULL
        );

        INSERT INTO "owners" ("id", "email", "session_version")
        VALUES ('00000000-0000-4000-8000-000000000001', 'current@example.com', 3);
        INSERT INTO "services"
          ("id", "owner_id", "name", "location_mode", "owner_address")
        VALUES
          ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Original service', 'mine', '20 Original Road');
        INSERT INTO "bookings"
          ("id", "owner_id", "service_id", "ends_at")
        VALUES
          ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', '2026-08-01T10:00:00Z');
        INSERT INTO "auth_tokens" ("id", "kind", "booking_id", "expires_at")
        VALUES
          ('00000000-0000-4000-8000-000000000031', 'client_manage', '00000000-0000-4000-8000-000000000021', '2026-08-08T10:00:00Z');
        INSERT INTO "email_outbox"
          ("id", "owner_id", "template", "to_email", "reply_to", "delivery", "html")
        VALUES
          ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000001', 'owner-sign-in', 'current@example.com', NULL, 'pending', 'legacy auth link'),
          ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000001', 'client-confirmation', 'client@example.com', 'current@example.com', 'pending', 'booking'),
          ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000001', 'payment-failed', 'current@example.com', NULL, 'pending', 'old state'),
          ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000001', 'owner-new-booking', 'old@example.com', NULL, 'pending', 'old recipient');
      `);

      for (const name of [
        "0010_omniscient_guardsmen.sql",
        "0011_square_dragon_lord.sql",
        "0012_easy_loa.sql",
        "0013_amused_junta.sql",
        "0014_milky_cardiac.sql",
      ]) {
        await apply(pg, name);
      }

      const booking = await pg.query<{
        manage_expires_at: Date;
        service_name_snapshot: string;
        location_snapshot: string | null;
        mail_recovery_checked_at: Date | null;
      }>(`SELECT "manage_expires_at", "service_name_snapshot", "location_snapshot", "mail_recovery_checked_at" FROM "bookings"`);
      expect(booking.rows[0]).toMatchObject({
        service_name_snapshot: "Original service",
        location_snapshot: "20 Original Road",
        mail_recovery_checked_at: null,
      });
      expect(new Date(booking.rows[0].manage_expires_at).toISOString()).toBe(
        "2026-08-08T10:00:00.000Z",
      );

      const mail = await pg.query<{
        id: string;
        delivery: string;
        owner_recipient_version: number | null;
        auth_token_id: string | null;
        html: string;
      }>(`SELECT "id", "delivery", "owner_recipient_version", "auth_token_id", "html" FROM "email_outbox" ORDER BY "id"`);
      expect(mail.rows).toEqual([
        expect.objectContaining({
          delivery: "expired",
          owner_recipient_version: null,
          auth_token_id: null,
          html: "",
        }),
        expect.objectContaining({
          delivery: "pending",
          owner_recipient_version: 3,
          auth_token_id: null,
          html: "booking",
        }),
        expect.objectContaining({ delivery: "expired", html: "" }),
        expect.objectContaining({ delivery: "expired", html: "" }),
      ]);
    } finally {
      await pg.close();
    }
  });
});
