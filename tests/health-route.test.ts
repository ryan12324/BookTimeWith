import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const execute = vi.fn();
  const findBilledOwner = vi.fn();
  const findCalendarConnections = vi.fn();
  const db = {
    execute,
    query: {
      owners: { findFirst: findBilledOwner },
      calendarConnections: { findMany: findCalendarConnections },
    },
  };

  return {
    db,
    execute,
    findBilledOwner,
    findCalendarConnections,
    getDb: vi.fn(),
  };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers);
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify(body), { ...init, headers });
    },
  },
}));

vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

import { GET } from "../src/app/api/health/route";

const requiredProductionEnvironment = {
  NODE_ENV: "production",
  AUTH_TOKEN_SECRET: "a".repeat(32),
  CRON_SECRET: "c".repeat(32),
  DATABASE_URL: "postgresql://booktimewith:secret@db:5432/booktimewith",
  EMAIL_TRANSPORT: "cloudflare",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_EMAIL_API_TOKEN: "email-token",
  EMAIL_FROM_DOMAIN: "mail.booktimewith.com",
  APP_URL: "https://app.example.test",
  BOOKING_URL: "https://book.example.test",
  NEXT_PUBLIC_APP_URL: "",
  NEXT_PUBLIC_BOOKING_URL: "",
  CALENDAR_TOKEN_SECRET: "",
  RATE_LIMIT_SECRET: "",
  TURNSTILE_SECRET_KEY: "",
  TURNSTILE_SITE_KEY: "",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  MICROSOFT_CLIENT_ID: "",
  MICROSOFT_CLIENT_SECRET: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  STRIPE_PRICE_GBP: "",
  STRIPE_PRICE_USD: "",
  STRIPE_PRICE_EUR: "",
  STRIPE_PRICE_AUD: "",
} as const;

function stubProductionEnvironment() {
  for (const [name, value] of Object.entries(requiredProductionEnvironment)) {
    vi.stubEnv(name, value);
  }
}

function configurationFailure(): Error {
  expect(console.error).toHaveBeenCalledOnce();
  const [message, error] = vi.mocked(console.error).mock.calls[0] ?? [];
  expect(message).toBe("Health check failed");
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

describe("production health readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubProductionEnvironment();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getDb.mockResolvedValue(mocks.db);
    mocks.execute.mockResolvedValue(undefined);
    mocks.findBilledOwner.mockResolvedValue(undefined);
    mocks.findCalendarConnections.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects production when EMAIL_TRANSPORT is missing", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "");

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "error" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(configurationFailure().message).toContain(
      "EMAIL_TRANSPORT is not configured",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects production when DATABASE_URL is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "error" });
    expect(configurationFailure().message).toContain(
      "DATABASE_URL is required",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects incomplete Cloudflare email credentials", async () => {
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "");

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "error" });
    expect(configurationFailure().message).toContain(
      "Cloudflare email transport is missing CLOUDFLARE_EMAIL_API_TOKEN",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each(["CALENDAR_TOKEN_SECRET", "RATE_LIMIT_SECRET"] as const)(
    "rejects a configured %s shorter than 32 characters",
    async (secretName) => {
      vi.stubEnv(secretName, "too-short");

      const response = await GET();

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ status: "error" });
      expect(configurationFailure().message).toContain(
        `${secretName} must contain at least 32 characters when set`,
      );
      expect(mocks.getDb).not.toHaveBeenCalled();
    },
  );

  it("reports ready when production configuration and the database are healthy", async () => {
    vi.stubEnv("CALENDAR_TOKEN_SECRET", "k".repeat(32));
    vi.stubEnv("RATE_LIMIT_SECRET", "r".repeat(32));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.getDb).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.findBilledOwner).toHaveBeenCalledOnce();
    expect(mocks.findCalendarConnections).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
  });
});
