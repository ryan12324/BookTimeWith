import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("virtual booking migration", () => {
  it("adds the virtual location mode and per-booking meeting-link override", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(`
        CREATE TYPE "location_mode" AS ENUM ('mine', 'theirs');
        CREATE TABLE "bookings" (
          "id" uuid PRIMARY KEY,
          "location_mode_snapshot" "location_mode" NOT NULL,
          "meeting_link" text,
          "meeting_link_snapshot" text
        );
      `);
      const migration = readFileSync(
        new URL("../drizzle/0019_complex_ink.sql", import.meta.url),
        "utf8",
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await pg.exec(statement);
      }
      await pg.exec(`
        INSERT INTO "bookings" (
          "id", "location_mode_snapshot", "meeting_link_override"
        ) VALUES (
          '00000000-0000-4000-8000-000000000001',
          'virtual',
          'https://meet.example/one-off'
        );
      `);
      const result = await pg.query<{
        location_mode_snapshot: string;
        meeting_link_override: string | null;
      }>(`SELECT "location_mode_snapshot", "meeting_link_override" FROM "bookings"`);
      expect(result.rows).toEqual([{
        location_mode_snapshot: "virtual",
        meeting_link_override: "https://meet.example/one-off",
      }]);
    } finally {
      await pg.close();
    }
  });
});
