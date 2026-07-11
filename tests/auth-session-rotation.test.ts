import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieStore: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookieStore }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

import { GET as callback } from "../src/app/api/auth/callback/route";
import { POST as signout } from "../src/app/api/auth/signout/route";
import { generateIdentityToken } from "../src/lib/auth-tokens";
import {
  createSession,
  SESSION_COOKIE,
  verifySessionDetails,
} from "../src/lib/session";

function updateSequence(returningRows: unknown[][]) {
  let index = 0;
  const sets: unknown[] = [];
  const update = vi.fn(() => {
    const current = index++;
    return {
      set: (values: unknown) => {
        sets.push(values);
        return {
          where: () =>
            current < returningRows.length
              ? { returning: async () => returningRows[current] }
              : Promise.resolve(),
        };
      },
    };
  });
  return { sets, update };
}

describe("owner session rotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("APP_URL", "https://booktimewith.com");
  });

  it("atomically advances the generation used by a successful magic-link cookie", async () => {
    const token = generateIdentityToken(4);
    const candidate = {
      id: "token-123",
      ownerId: "owner-123",
      identityEmail: "owner@example.test",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const updates = updateSequence([
      [{ id: candidate.id }],
      [{ id: candidate.ownerId, sessionVersion: 5 }],
    ]);
    const tx = {
      query: {
        authTokens: { findFirst: vi.fn().mockResolvedValue(candidate) },
        owners: {
          findFirst: vi.fn().mockResolvedValue({
            id: candidate.ownerId,
            email: "owner@example.test",
            sessionVersion: 4,
            emailVerifiedAt: null,
          }),
        },
      },
      execute: vi.fn().mockResolvedValue(undefined),
      update: updates.update,
    };
    const db = {
      query: {
        authTokens: { findFirst: vi.fn().mockResolvedValue(candidate) },
      },
      transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx),
    };
    mocks.getDb.mockResolvedValue(db);

    const url = new URL("https://booktimewith.com/api/auth/callback");
    url.searchParams.set("token", token);
    url.searchParams.set("next", "/\n/evil.example");
    const response = await callback(new Request(url));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://booktimewith.com/app");
    expect(updates.update).toHaveBeenCalledTimes(3);
    expect(updates.sets[1]).toHaveProperty("sessionVersion");
    expect(updates.sets[1]).toHaveProperty(
      "emailVerifiedAt",
      expect.any(Date),
    );
    const cookie = response.headers
      .get("set-cookie")
      ?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
    expect(cookie).toBeTruthy();
    await expect(
      verifySessionDetails(decodeURIComponent(cookie!)),
    ).resolves.toEqual({ ownerId: "owner-123", sessionVersion: 5 });
  });

  it("rotates an authenticated generation before clearing the sign-out cookie", async () => {
    const cookie = await createSession("owner-123", new Date(), 8);
    mocks.cookieStore.mockResolvedValue({
      get: (name: string) =>
        name === SESSION_COOKIE ? { value: cookie } : undefined,
    });
    const updates = updateSequence([[{ sessionVersion: 9 }]]);
    const tx = { update: updates.update };
    mocks.getDb.mockResolvedValue({
      transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx),
    });

    const response = await signout(
      new Request("https://booktimewith.com/api/auth/signout", { method: "POST" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://booktimewith.com/");
    expect(updates.update).toHaveBeenCalledTimes(2);
    expect(updates.sets[0]).toHaveProperty("sessionVersion");
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
  });

  it("keeps unauthenticated sign-out idempotent without opening the database", async () => {
    mocks.cookieStore.mockResolvedValue({ get: () => undefined });

    const response = await signout(
      new Request("https://booktimewith.com/api/auth/signout", { method: "POST" }),
    );

    expect(response.status).toBe(303);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
  });
});
