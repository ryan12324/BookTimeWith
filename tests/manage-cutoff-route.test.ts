import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSessionConfiguration: vi.fn(),
  bookingByManageToken: vi.fn(),
  findAction: vi.fn(),
  findOwner: vi.fn(),
  findService: vi.fn(),
  isBookableInstant: vi.fn(),
  mintManageToken: vi.fn(),
  sendClientBookingConfirmation: vi.fn(),
  sendOwnerClientChanged: vi.fn(),
  syncBookingCalendar: vi.fn(),
  transaction: vi.fn(),
  txExecute: vi.fn(),
  txInsert: vi.fn(),
  withOwnerMutex: vi.fn(),
  db: undefined as unknown,
}));

vi.mock("@/db/client", () => ({ getDb: async () => mocks.db }));
vi.mock("@/db/repo", () => ({
  bookingByManageToken: mocks.bookingByManageToken,
  isBookableInstant: mocks.isBookableInstant,
  mintManageToken: mocks.mintManageToken,
}));
vi.mock("@/emails/send", () => ({
  clientConfirmationDedupeKey: vi.fn(),
  ownerClientChangedDedupeKey: vi.fn(),
  sendClientBookingConfirmation: mocks.sendClientBookingConfirmation,
  sendOwnerClientChanged: mocks.sendOwnerClientChanged,
}));
vi.mock("@/lib/booking-calendar", () => ({
  syncBookingCalendar: mocks.syncBookingCalendar,
}));
vi.mock("@/lib/calendar", () => ({
  CalendarUnavailableError: class CalendarUnavailableError extends Error {},
}));
vi.mock("@/lib/keyed-mutex", () => ({
  withBookingMutex: async (_key: string, work: () => Promise<unknown>) => work(),
  withOwnerMutex: mocks.withOwnerMutex,
}));
vi.mock("@/lib/session", () => ({
  assertSessionConfiguration: mocks.assertSessionConfiguration,
}));
vi.mock("@/lib/timezone", () => ({ isIanaZone: () => true }));
vi.mock("@/lib/urls", () => ({
  canonicalBookingUrl: () => "https://booktimewith.link",
}));

import { PATCH } from "../src/app/api/manage/[token]/route";

const initialNow = new Date("2026-07-11T12:00:00.000Z");
const cutoffCrossed = new Date("2026-07-11T12:00:01.000Z");
const bookingStartsAt = new Date("2026-07-12T12:00:00.500Z");

const requestFor = (body: object) =>
  new Request("https://booktimewith.link/api/manage/manage-token", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("client booking cutoff transaction guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(initialNow);

    mocks.bookingByManageToken.mockResolvedValue({
      id: "booking-123",
      ownerId: "owner-123",
      serviceId: "service-123",
      startsAt: bookingStartsAt,
      endsAt: new Date("2026-07-12T13:00:00.500Z"),
      status: "confirmed",
      clientTimezone: "Europe/London",
    });
    mocks.findOwner.mockResolvedValue({
      id: "owner-123",
      name: "Dana",
      handle: "dana",
    });
    mocks.findService.mockResolvedValue({
      id: "service-123",
      ownerId: "owner-123",
      name: "Consultation",
    });
    mocks.findAction.mockResolvedValue(undefined);
    mocks.isBookableInstant.mockResolvedValue(true);

    const tx = {
      execute: mocks.txExecute,
      insert: mocks.txInsert,
    };
    mocks.transaction.mockImplementation(
      async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
    );
    mocks.db = {
      query: {
        owners: { findFirst: mocks.findOwner },
        services: { findFirst: mocks.findService },
        bookingActions: { findFirst: mocks.findAction },
      },
      transaction: mocks.transaction,
    };
    mocks.withOwnerMutex.mockImplementation(
      async (_key: string, work: () => Promise<unknown>) => {
        vi.setSystemTime(cutoffCrossed);
        return work();
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    {
      name: "move",
      body: {
        action: "move",
        startsAt: "2026-07-13T12:00:00.000Z",
        actionKey: "move-action-key-123456",
      },
    },
    {
      name: "cancel",
      body: {
        action: "cancel",
        actionKey: "cancel-action-key-123456",
      },
    },
  ])("rejects a $name that crosses the cutoff before commit", async ({ body }) => {
    const response = await PATCH(requestFor(body), {
      params: Promise.resolve({ token: "manage-token" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Less than 24 hours"),
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.txInsert).not.toHaveBeenCalled();
    expect(mocks.syncBookingCalendar).not.toHaveBeenCalled();
    expect(mocks.sendClientBookingConfirmation).not.toHaveBeenCalled();
    expect(mocks.sendOwnerClientChanged).not.toHaveBeenCalled();
  });
});
