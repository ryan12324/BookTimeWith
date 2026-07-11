import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  deliverQueuedEmail: vi.fn(),
  findOwner: vi.fn(),
  insertValues: vi.fn(),
  ownerSignIn: vi.fn(() => ({ type: "owner-sign-in" })),
  render: vi.fn(),
  spool: vi.fn(),
  takeRateLimit: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: mocks.after,
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
      }),
  },
}));

vi.mock("react-email", () => ({ render: mocks.render }));
vi.mock("@/db/client", () => ({
  getDb: async () => ({
    query: { owners: { findFirst: mocks.findOwner } },
    insert: () => ({ values: mocks.insertValues }),
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  requestIp: () => "127.0.0.1",
  takeRateLimit: mocks.takeRateLimit,
}));
vi.mock("@/emails/send", () => ({
  deliverQueuedEmail: mocks.deliverQueuedEmail,
  spool: mocks.spool,
}));
vi.mock("@/emails/templates", () => ({ OwnerSignIn: mocks.ownerSignIn }));

import { POST } from "../src/app/api/auth/signin/route";

const request = () =>
  new Request("http://localhost/api/auth/signin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", next: "/app" }),
  });

describe("sign-in response privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EMAIL_WEBHOOK_URL", "https://email.example.test/send");
    mocks.takeRateLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.render.mockResolvedValue("<p>sign in</p>");
    mocks.spool.mockResolvedValue("outbox-123");
    mocks.deliverQueuedEmail.mockResolvedValue(true);
  });

  it("durably queues known-account mail and defers provider delivery", async () => {
    mocks.findOwner.mockResolvedValue({
      id: "owner-123",
      email: "owner@example.com",
      sessionVersion: 4,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.insertValues).toHaveBeenCalledOnce();
    expect(mocks.spool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: "owner@example.com",
        template: "owner-sign-in",
      }),
      { deferDelivery: true },
    );
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.deliverQueuedEmail).not.toHaveBeenCalled();

    const deferred = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
    await deferred();
    expect(mocks.deliverQueuedEmail).toHaveBeenCalledWith(
      expect.anything(),
      "outbox-123",
    );
  });

  it("does equivalent hash/template work without queuing mail for an unknown account", async () => {
    mocks.findOwner.mockResolvedValue(undefined);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.ownerSignIn).toHaveBeenCalledOnce();
    expect(mocks.render).toHaveBeenCalledOnce();
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.spool).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
