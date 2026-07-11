import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "../src/db/client";

const runtimeUrl = process.env.TEST_DATABASE_URL?.trim();
const integration = runtimeUrl ? describe : describe.skip;
const databaseGlobal = globalThis as typeof globalThis & {
  __btwDb?: unknown;
  __btwPool?: { end: () => Promise<void> };
};

integration("real PostgreSQL runtime", () => {
  let db: Db;

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", runtimeUrl!);
    vi.stubEnv(
      "AUTH_TOKEN_SECRET",
      "postgres-runtime-test-auth-secret-32-characters",
    );
    vi.stubEnv(
      "CALENDAR_TOKEN_SECRET",
      "postgres-runtime-test-calendar-secret-value",
    );
    delete databaseGlobal.__btwDb;
    delete databaseGlobal.__btwPool;
    const { getDb } = await import("../src/db/client");
    db = await getDb();
  });

  afterAll(async () => {
    await databaseGlobal.__btwPool?.end();
    delete databaseGlobal.__btwDb;
    delete databaseGlobal.__btwPool;
    vi.unstubAllEnvs();
  });

  it("connects, applies every migration, and exposes required PostgreSQL features", async () => {
    const result = (await db.execute(sql`
      select
        current_database() as database_name,
        (select count(*)::int from drizzle.__drizzle_migrations) as migration_count,
        exists(select 1 from pg_extension where extname = 'btree_gist') as has_btree_gist,
        exists(
          select 1
          from pg_constraint
          where conname = 'bookings_no_overlap'
        ) as has_overlap_constraint
    `)) as unknown as {
      rows: Array<{
        database_name: string;
        migration_count: number;
        has_btree_gist: boolean;
        has_overlap_constraint: boolean;
      }>;
    };

    expect(result.rows[0]).toMatchObject({
      migration_count: 18,
      has_btree_gist: true,
      has_overlap_constraint: true,
    });
    expect(result.rows[0].database_name).toBeTruthy();
    await expect(db.query.owners.findMany({ limit: 1 })).resolves.toEqual([]);
  });
});
