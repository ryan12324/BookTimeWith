import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bookingByManageToken: vi.fn(),
  routeDb: undefined as unknown,
  sessionOwner: vi.fn(),
}));

vi.mock("@/db/client", () => ({ getDb: async () => mocks.routeDb }));
vi.mock("@/db/repo", () => ({
  bookingByManageToken: mocks.bookingByManageToken,
}));
vi.mock("@/lib/authz", () => ({ sessionOwner: mocks.sessionOwner }));

import { GET as getManagedBooking } from "../src/app/api/manage/[token]/route";
import { GET as exportBookings } from "../src/app/api/export/bookings/route";
import {
  sendClientBookingConfirmation,
  sendClientOwnerChanged,
} from "../src/emails/send";

const owner = {
  id: "owner-123",
  name: "Dana Whitfield",
  email: "dana@example.com",
  handle: "dana",
  timezone: "Europe/London",
  sessionVersion: 3,
};

const booking = {
  id: "booking-123",
  ownerId: owner.id,
  serviceId: "service-123",
  startsAt: new Date("2026-08-12T09:00:00Z"),
  endsAt: new Date("2026-08-12T10:00:00Z"),
  manageExpiresAt: new Date("2026-08-12T10:00:00Z"),
  serviceNameSnapshot: "Original consultation",
  locationModeSnapshot: "mine" as const,
  locationSnapshot: "20 Original Road",
  clientName: "Alex Martin",
  clientEmail: "alex@example.com",
  clientTimezone: "Europe/London",
  clientAddress: null,
  status: "confirmed" as const,
  lastActionBy: "client" as const,
  lastActionKey: null,
  meetingLink: "https://meet.example/original",
  clientRequestKey: null,
  calendarProvider: null,
  calendarEventId: null,
  calendarRevision: 0,
  calendarSyncStatus: "synced",
  calendarSyncError: null,
  calendarUpdatedAt: null,
  createdAt: new Date("2026-07-11T12:00:00Z"),
};

describe("booking snapshot consumers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EMAIL_TRANSPORT", "");
    mocks.bookingByManageToken.mockResolvedValue(booking);
    mocks.sessionOwner.mockResolvedValue(owner);
    mocks.routeDb = {
      query: {
        owners: { findFirst: vi.fn().mockResolvedValue(owner) },
        bookings: { findMany: vi.fn().mockResolvedValue([booking]) },
      },
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves the committed identity and location on the manage API", async () => {
    const response = await getManagedBooking(
      new Request("https://booktimewith.link/api/manage/token"),
      { params: Promise.resolve({ token: "token" }) },
    );

    await expect(response.json()).resolves.toMatchObject({
      booking: {
        service: "Original consultation",
        locationMode: "mine",
        location: "20 Original Road",
        meetingLink: "https://meet.example/original",
      },
    });
  });

  it("exports per-booking service and resolved-location snapshots", async () => {
    const response = await exportBookings();
    const csv = await response.text();

    expect(csv).toContain('"Original consultation"');
    expect(csv).toContain('"mine","20 Original Road"');
    expect(csv).not.toContain("Renamed service");
    expect(csv).not.toContain("99 New Road");
  });

  it("renders confirmation HTML and ICS without loading the mutable service", async () => {
    let queued: Record<string, unknown> | undefined;
    const mailDb = {
      query: {
        owners: { findFirst: vi.fn().mockResolvedValue(owner) },
      },
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          queued = values;
          return {
            onConflictDoNothing: () => ({
              returning: async () => [{ id: "outbox-123" }],
            }),
          };
        }),
      })),
    };

    await sendClientBookingConfirmation(
      mailDb as never,
      {
        owner: owner as never,
        booking: booking as never,
        manageToken: "manage-token",
        baseUrl: "https://booktimewith.link",
      },
    );

    expect(String(queued?.html)).toContain("Original consultation");
    const attachments = JSON.parse(String(queued?.attachments)) as Array<{
      content: string;
    }>;
    expect(attachments[0]?.content).toContain(
      "SUMMARY:Original consultation with Dana Whitfield",
    );
    expect(attachments[0]?.content).toContain("LOCATION:20 Original Road");
    expect(mailDb.query).not.toHaveProperty("services");
  });

  it("links an owner-cancelled booking straight to the public booking page", async () => {
    let queued: Record<string, unknown> | undefined;
    const mailDb = {
      query: {
        owners: { findFirst: vi.fn().mockResolvedValue(owner) },
      },
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          queued = values;
          return {
            onConflictDoNothing: () => ({
              returning: async () => [{ id: "outbox-cancelled" }],
            }),
          };
        }),
      })),
    };

    await sendClientOwnerChanged(mailDb as never, {
      owner: owner as never,
      booking: booking as never,
      kind: "cancelled",
      wasStart: booking.startsAt,
      manageToken: "manage-token",
      baseUrl: "https://booktimewith.link",
      actionKey: "cancel-action-key",
    });

    expect(String(queued?.html)).toContain(
      'href="https://booktimewith.link/dana"',
    );
    expect(String(queued?.html)).not.toContain("/manage/manage-token");
  });
});
