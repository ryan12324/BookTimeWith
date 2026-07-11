import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pools: [] as Array<{
    config: Record<string, unknown>;
    client: {
      query: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }>,
  database: { kind: "node-postgres-db" },
  drizzle: vi.fn(),
  migrate: vi.fn(),
  hardenCalendarTokens: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class {
    constructor(config: Record<string, unknown>) {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      };
      const pool = {
        config,
        client,
        connect: vi.fn().mockResolvedValue(client),
        query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
      mocks.pools.push(pool);
      return pool;
    }
  },
}));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: mocks.drizzle }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: mocks.migrate }));
vi.mock("@/lib/calendar", () => ({
  hardenCalendarTokens: mocks.hardenCalendarTokens,
}));

const databaseGlobal = globalThis as typeof globalThis & {
  __btwDb?: unknown;
  __btwPool?: unknown;
};

describe("PostgreSQL runtime client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.pools.length = 0;
    delete databaseGlobal.__btwDb;
    delete databaseGlobal.__btwPool;
    mocks.drizzle.mockReturnValue(mocks.database);
    mocks.migrate.mockResolvedValue(undefined);
    mocks.hardenCalendarTokens.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete databaseGlobal.__btwDb;
    delete databaseGlobal.__btwPool;
  });

  it("requires a PostgreSQL URL instead of silently creating local storage", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getDb } = await import("../src/db/client");

    await expect(getDb()).rejects.toThrow("DATABASE_URL is required");
    expect(mocks.pools).toHaveLength(0);
  });

  it("builds one bounded pool, serializes migrations, and reuses the database", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://booktimewith:secret@db.example.test:5432/booktimewith?sslmode=require",
    );
    vi.stubEnv("DATABASE_POOL_MAX", "17");
    vi.stubEnv("DATABASE_CONNECT_TIMEOUT_MS", "12000");
    vi.stubEnv("DATABASE_IDLE_TIMEOUT_MS", "45000");
    const { getDb } = await import("../src/db/client");

    const first = await getDb();
    const second = await getDb();

    expect(first).toBe(mocks.database);
    expect(second).toBe(first);
    expect(mocks.pools).toHaveLength(1);
    expect(mocks.pools[0].config).toMatchObject({
      connectionString:
        "postgresql://booktimewith:secret@db.example.test:5432/booktimewith?sslmode=require",
      application_name: "booktimewith",
      max: 17,
      connectionTimeoutMillis: 12000,
      idleTimeoutMillis: 45000,
      keepAlive: true,
    });
    expect(mocks.pools[0].client.query).toHaveBeenNthCalledWith(
      1,
      "select pg_advisory_lock($1, $2)",
      [expect.any(Number), 1],
    );
    expect(mocks.pools[0].client.query).toHaveBeenLastCalledWith(
      "select pg_advisory_unlock($1, $2)",
      [expect.any(Number), 1],
    );
    expect(mocks.migrate).toHaveBeenCalledOnce();
    expect(mocks.pools[0].query).toHaveBeenCalledWith("select 1");
    expect(mocks.hardenCalendarTokens).toHaveBeenCalledWith(mocks.database);
    expect(mocks.pools[0].client.release).toHaveBeenCalledOnce();
  });

  it("closes a failed pool and permits a clean readiness retry", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://booktimewith:secret@localhost:5432/booktimewith",
    );
    mocks.migrate
      .mockRejectedValueOnce(new Error("database starting"))
      .mockResolvedValueOnce(undefined);
    const { getDb } = await import("../src/db/client");

    await expect(getDb()).rejects.toThrow("database starting");
    expect(mocks.pools[0].end).toHaveBeenCalledOnce();
    await expect(getDb()).resolves.toBe(mocks.database);
    expect(mocks.pools).toHaveLength(2);
  });

  it("rejects unsafe pool configuration before opening a connection", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://booktimewith:secret@localhost:5432/booktimewith",
    );
    vi.stubEnv("DATABASE_POOL_MAX", "0");
    const { getDb } = await import("../src/db/client");

    await expect(getDb()).rejects.toThrow(
      "DATABASE_POOL_MAX must be an integer between 1 and 100",
    );
    expect(mocks.pools).toHaveLength(0);
  });
});
