import path from "node:path";
import process from "node:process";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const TABLES = [
  "owners",
  "services",
  "availability",
  "away_periods",
  "handle_redirects",
  "bookings",
  "calendar_connections",
  "auth_tokens",
  "booking_actions",
  "email_log",
  "email_outbox",
  "stripe_events",
  "rate_limits",
];
const BATCH_SIZE = 100;
const MIGRATION_LOCK_NAMESPACE = 1_118_337_311;
const MIGRATION_LOCK_KEY = 1;

function identifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function targetUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required for the PostgreSQL target.");
  const parsed = new URL(value);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://.");
  }
  return value;
}

async function columns(client, table) {
  const result = await client.query(
    `select column_name, is_nullable, column_default, is_identity
     from information_schema.columns
     where table_schema = 'public' and table_name = $1
     order by ordinal_position`,
    [table],
  );
  return result.rows;
}

async function count(client, table) {
  const result = await client.query(
    `select count(*)::int as count from ${identifier(table)}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function applyTargetMigrations(client) {
  await client.query("select pg_advisory_lock($1, $2)", [
    MIGRATION_LOCK_NAMESPACE,
    MIGRATION_LOCK_KEY,
  ]);
  try {
    await migrate(drizzle(client), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
  } finally {
    await client.query("select pg_advisory_unlock($1, $2)", [
      MIGRATION_LOCK_NAMESPACE,
      MIGRATION_LOCK_KEY,
    ]);
  }
}

async function insertRows(client, table, columnNames, rows) {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = columnNames.map((column) => {
        values.push(row[column]);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(
      `insert into ${identifier(table)} (${columnNames
        .map(identifier)
        .join(", ")}) values ${tuples.join(", ")}`,
      values,
    );
  }
}

async function main() {
  const sourceDirectory = path.resolve(
    process.env.PGLITE_DATA_DIR?.trim() || path.join(".data", "btw"),
  );
  const source = new PGlite(sourceDirectory, {
    extensions: { btree_gist },
  });
  const pool = new Pool({
    connectionString: targetUrl(),
    application_name: "booktimewith-pglite-import",
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  const target = await pool.connect();

  try {
    await applyTargetMigrations(target);
    const populated = [];
    for (const table of TABLES) {
      if ((await count(target, table)) > 0) populated.push(table);
    }
    if (populated.length) {
      throw new Error(
        `PostgreSQL target must be empty; found data in: ${populated.join(", ")}.`,
      );
    }

    await target.query("begin");
    const imported = {};
    try {
      for (const table of TABLES) {
        const [sourceColumnsResult, targetColumns] = await Promise.all([
          source.query(
            `select column_name
             from information_schema.columns
             where table_schema = 'public' and table_name = $1
             order by ordinal_position`,
            [table],
          ),
          columns(target, table),
        ]);
        const sourceColumns = new Set(
          sourceColumnsResult.rows.map((row) => row.column_name),
        );
        const missingRequired = targetColumns.filter(
          (column) =>
            !sourceColumns.has(column.column_name) &&
            column.is_nullable === "NO" &&
            column.column_default === null &&
            column.is_identity !== "YES",
        );
        if (missingRequired.length) {
          throw new Error(
            `${table} source schema is too old; missing required columns: ${missingRequired
              .map((column) => column.column_name)
              .join(", ")}. Start the old app once with current migrations, then retry.`,
          );
        }
        const sharedColumns = targetColumns
          .map((column) => column.column_name)
          .filter((column) => sourceColumns.has(column));
        const sourceRows = await source.query(
          `select ${sharedColumns.map(identifier).join(", ")} from ${identifier(table)}`,
        );
        if (sourceRows.rows.length) {
          await insertRows(target, table, sharedColumns, sourceRows.rows);
        }
        imported[table] = sourceRows.rows.length;
      }
      for (const table of TABLES) {
        const targetCount = await count(target, table);
        if (targetCount !== imported[table]) {
          throw new Error(
            `${table} verification failed: imported ${imported[table]}, found ${targetCount}.`,
          );
        }
      }
      await target.query("commit");
    } catch (error) {
      await target.query("rollback");
      throw error;
    }

    console.log(
      `Imported ${Object.values(imported).reduce((sum, value) => sum + value, 0)} rows from ${sourceDirectory}.`,
    );
    for (const table of TABLES) console.log(`${table}: ${imported[table]}`);
  } finally {
    target.release();
    await pool.end();
    await source.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
