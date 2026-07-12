import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const MIGRATION_LOCK_NAMESPACE = 1_118_337_311;
const MIGRATION_LOCK_KEY = 1;
const TRANSIENT_DATABASE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "53300", // too_many_connections
  "57P03", // cannot_connect_now
]);

function databaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "DATABASE_URL is required before database migrations can run.",
    );
  }
  let url;
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

function connectTimeout() {
  const raw = process.env.DATABASE_CONNECT_TIMEOUT_MS?.trim();
  if (!raw) return 10_000;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 120_000) {
    throw new Error(
      "DATABASE_CONNECT_TIMEOUT_MS must be an integer between 1000 and 120000.",
    );
  }
  return value;
}

/** Run every generated migration while holding the same cross-replica lock. */
export async function runMigrations() {
  const pool = new Pool({
    connectionString: databaseUrl(),
    application_name: "booktimewith-migrate",
    max: 1,
    connectionTimeoutMillis: connectTimeout(),
  });
  let client;
  let locked = false;
  try {
    client = await pool.connect();
    await client.query("select pg_advisory_lock($1, $2)", [
      MIGRATION_LOCK_NAMESPACE,
      MIGRATION_LOCK_KEY,
    ]);
    locked = true;
    await migrate(drizzle(client), {
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
          console.error("PostgreSQL migration lock release failed", error);
        });
    }
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Retry only connection/readiness failures; invalid SQL fails immediately. */
export async function runMigrationsWithRetry(maxAttempts = 10) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runMigrations();
      return;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (!TRANSIENT_DATABASE_CODES.has(code) || attempt === maxAttempts) {
        throw error;
      }
      const delay = Math.min(5_000, attempt * 1_000);
      console.warn(
        `PostgreSQL is not ready (${code}); retrying migration ${attempt + 1}/${maxAttempts} in ${delay}ms.`,
      );
      await wait(delay);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log("Applying PostgreSQL migrations before application startup...");
  runMigrationsWithRetry()
    .then(() => {
      console.log("PostgreSQL migrations are current.");
    })
    .catch((error) => {
      console.error("PostgreSQL migration startup failed", error);
      process.exitCode = 1;
    });
}
