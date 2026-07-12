import path from "node:path";
import { Pool, type PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { log, loggedOperation } from "@/lib/logger";

/** Driver-agnostic PostgreSQL query surface; production uses node-postgres. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type DatabaseGlobal = {
  __btwDb?: Promise<Db>;
  __btwPool?: Pool;
};

const g = globalThis as unknown as DatabaseGlobal;
const MIGRATION_LOCK_NAMESPACE = 1_118_337_311;
const MIGRATION_LOCK_KEY = 1;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "DATABASE_URL is required. Point it at a PostgreSQL database before starting Book Time With.",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// scheme.");
  }
  return value;
}

function integerSetting(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function poolConfig(): PoolConfig {
  return {
    connectionString: databaseUrl(),
    application_name: "booktimewith",
    max: integerSetting("DATABASE_POOL_MAX", 10, 1, 100),
    connectionTimeoutMillis: integerSetting(
      "DATABASE_CONNECT_TIMEOUT_MS",
      10_000,
      1_000,
      120_000,
    ),
    idleTimeoutMillis: integerSetting(
      "DATABASE_IDLE_TIMEOUT_MS",
      30_000,
      1_000,
      600_000,
    ),
    keepAlive: true,
  };
}

/**
 * Apply generated migrations through a dedicated session. The PostgreSQL
 * advisory lock serializes first boot across app replicas; unlike the old
 * embedded database, every process now shares one authoritative server.
 */
async function migrateDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    log.debug("database.migration_lock.waiting");
    await client.query("select pg_advisory_lock($1, $2)", [
      MIGRATION_LOCK_NAMESPACE,
      MIGRATION_LOCK_KEY,
    ]);
    locked = true;
    log.debug("database.migration_lock.acquired");
    const migrationDb = drizzle(client, { schema });
    await migrate(migrationDb, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
  } finally {
    if (locked) {
      await client
        .query("select pg_advisory_unlock($1, $2)", [
          MIGRATION_LOCK_NAMESPACE,
          MIGRATION_LOCK_KEY,
        ])
        .catch((error) => {
          log.error("database.migration_lock.release_failed", { error });
        });
    }
    client.release();
  }
}

async function init(): Promise<Db> {
  const config = poolConfig();
  log.info("database.pool.initializing", {
    maxConnections: config.max,
    connectionTimeoutMs: config.connectionTimeoutMillis,
    idleTimeoutMs: config.idleTimeoutMillis,
  });
  const pool = new Pool(config);
  g.__btwPool = pool;
  pool.on("error", (error) => {
    log.error("database.pool.idle_client_error", { error });
  });
  pool.on("connect", () => log.debug("database.pool.client_connected", { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }));
  pool.on("remove", () => log.debug("database.pool.client_removed", { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }));

  try {
    await loggedOperation("database.migrations", {}, () => migrateDatabase(pool));
    const db = drizzle(pool, { schema });
    await pool.query("select 1");
    const { hardenCalendarTokens } = await import("@/lib/calendar");
    await hardenCalendarTokens(db);
    log.info("database.ready", { total: pool.totalCount, idle: pool.idleCount });
    return db;
  } catch (error) {
    log.error("database.initialization_failed", { error });
    if (g.__btwPool === pool) delete g.__btwPool;
    await pool.end().catch(() => undefined);
    throw error;
  }
}

export function getDb(): Promise<Db> {
  if (!g.__btwDb) {
    const pending = init();
    g.__btwDb = pending;
    // A transient connection/migration failure must not poison readiness for
    // the lifetime of the process. A later health probe can retry cleanly.
    void pending.catch(() => {
      if (g.__btwDb === pending) delete g.__btwDb;
    });
  }
  return g.__btwDb;
}
