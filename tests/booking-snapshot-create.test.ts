import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSessionConfiguration: vi.fn(),
  isBookableInstant: vi.fn(),
  mintManageToken: vi.fn(),
  ownerByHandle: vi.fn(),
  sendBookingEmails: vi.fn(),
  syncBookingCalendar: vi.fn(),
  takeRateLimit: vi.fn(),
  db: undefined as unknown,
}));

vi.mock("@/db/client", () => ({ getDb: async () => mocks.db }));
vi.mock("@/db/repo", () => ({
  isBookableInstant: mocks.isBookableInstant,
  mintManageToken: mocks.mintManageToken,
  ownerBookings: vi.fn(),
  ownerByHandle: mocks.ownerByHandle,
  slotsFor: vi.fn(),
}));
vi.mock("@/emails/send", () => ({
  clientConfirmationDedupeKey: vi.fn(),
  ownerNewBookingDedupeKey: vi.fn(),
  sendBookingEmails: mocks.sendBookingEmails,
}));
vi.mock("@/lib/authz", () => ({ sessionOwner: vi.fn() }));
vi.mock("@/lib/booking-calendar", () => ({
  syncBookingCalendar: mocks.syncBookingCalendar,
}));
vi.mock("@/lib/keyed-mutex", () => ({
  withOwnerMutex: async (_key: string, work: () => Promise<unknown>) => work(),
}));
vi.mock("@/lib/rate-limit", () => ({
  isDisposableEmail: () => false,
  requestIp: () => "203.0.113.10",
  takeRateLimit: mocks.takeRateLimit,
  verifyTurnstile: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  assertSessionConfiguration: mocks.assertSessionConfiguration,
}));

import { POST } from "../src/app/api/bookings/route";

describe("booking service snapshot creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const owner = {
      id: "owner-123",
      name: "Dana Whitfield",
      email: "dana@example.com",
      emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
      handle: "dana",
      timezone: "Europe/London",
      setupCompletedAt: new Date("2026-01-01T00:00:00Z"),
      planStatus: "trialing",
      trialEndsAt: new Date("2027-01-01T00:00:00Z"),
      graceUntil: null,
      accessEndsAt: null,
    };
    const service = {
      id: "service-123",
      ownerId: owner.id,
      name: "Original consultation",
      durationMinutes: 60,
      locationMode: "theirs" as "mine" | "theirs",
      ownerAddress: "20 Owner Road",
      meetingLink: "https://meet.example/original",
    };
    let insertedBooking: Record<string, unknown> | undefined;
    const tx = {
      execute: vi.fn(),
      query: {
        owners: { findFirst: vi.fn().mockResolvedValue(owner) },
        services: { findFirst: vi.fn().mockResolvedValue(service) },
      },
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          returning: async () => {
            insertedBooking = {
              id: "booking-123",
              status: "confirmed",
              lastActionKey: null,
              calendarRevision: 0,
              calendarSyncStatus: "pending",
              calendarEventId: null,
              ...values,
              createdAt: new Date("2026-07-11T12:00:00Z"),
            };
            // Simulate settings changing immediately after the atomic insert.
            service.name = "Renamed service";
            service.locationMode = "mine";
            service.ownerAddress = "99 New Road";
            service.meetingLink = "https://meet.example/new";
            return [insertedBooking];
          },
        })),
      })),
    };
    mocks.db = {
      query: {
        services: { findFirst: vi.fn().mockResolvedValue(service) },
        bookings: {
          findFirst: vi.fn(async () => insertedBooking),
        },
      },
      transaction: async (work: (transaction: typeof tx) => Promise<unknown>) =>
        work(tx),
    };
    mocks.ownerByHandle.mockResolvedValue(owner);
    mocks.isBookableInstant.mockResolvedValue(true);
    mocks.takeRateLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    mocks.syncBookingCalendar.mockResolvedValue({
      ok: true,
      meetingLink: "https://meet.example/original",
    });
    mocks.mintManageToken.mockResolvedValue("stable-manage-token");
  });

  it("returns and emails the values captured in the booking transaction", async () => {
    const response = await POST(
      new Request("https://booktimewith.link/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: "dana",
          startsAt: "2026-08-12T09:00:00.000Z",
          clientName: "Alex Martin",
          clientEmail: "alex@example.com",
          clientTimezone: "Europe/London",
          clientAddress: " 10 High Street ",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      booking: {
        service: "Original consultation",
        locationMode: "theirs",
        location: "10 High Street",
        meetingLink: "https://meet.example/original",
      },
    });
    expect(mocks.sendBookingEmails).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        booking: expect.objectContaining({
          serviceNameSnapshot: "Original consultation",
          locationModeSnapshot: "theirs",
          locationSnapshot: "10 High Street",
          meetingLinkSnapshot: "https://meet.example/original",
          meetingLink: "https://meet.example/original",
          initialIntentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
      { deferDelivery: true },
    );
  });
});
