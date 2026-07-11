import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bookingIntentHash,
  matchesBookingIntent,
  matchesClientActionIntent,
} from "../src/lib/booking-intent";
import { deriveOpaqueToken } from "../src/lib/session";
import {
  bookingMailStateKey,
  clientConfirmationDedupeKey,
  clientOwnerChangedDedupeKey,
  ownerNewBookingDedupeKey,
  ownerClientChangedDedupeKey,
  STALE_OUTBOX_DELIVERY_STATES,
} from "../src/emails/send";

describe("non-billing idempotency hardening", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("binds a booking request key to its immutable normalized intent", async () => {
    const existing = {
      startsAt: new Date("2026-08-12T09:00:00.000Z"),
      clientName: "Alex Martin",
      clientEmail: "alex@example.com",
      clientTimezone: "Europe/London",
      clientAddress: "10 High Street",
    };
    const submitted = {
      startsAt: "2026-08-12T09:00:00.000Z",
      clientName: " Alex Martin ",
      clientEmail: "ALEX@example.com",
      clientTimezone: "Europe/London",
      clientAddress: " 10 High Street ",
    };

    expect(await matchesBookingIntent(existing, submitted)).toBe(true);
    expect(
      await matchesBookingIntent(existing, {
        ...submitted,
        clientEmail: "corrected@example.com",
      }),
    ).toBe(false);
    expect(
      await matchesBookingIntent(existing, {
        ...submitted,
        startsAt: "2026-08-12T09:30:00.000Z",
      }),
    ).toBe(false);
    expect(
      await matchesBookingIntent(existing, {
        ...submitted,
        clientTimezone: "America/New_York",
      }),
    ).toBe(false);

    const initialIntentHash = await bookingIntentHash(submitted);
    const moved = {
      ...existing,
      startsAt: new Date("2026-08-20T14:00:00.000Z"),
      clientTimezone: "America/New_York",
      initialIntentHash,
    };
    expect(await matchesBookingIntent(moved, submitted)).toBe(true);
    expect(
      await matchesBookingIntent(moved, {
        ...submitted,
        startsAt: moved.startsAt.toISOString(),
      }),
    ).toBe(false);
  });

  it("binds client action keys to the submitted timezone", () => {
    const existing = {
      actor: "client" as const,
      action: "move",
      toStartsAt: new Date("2026-08-12T09:00:00.000Z"),
      clientTimezoneIntent: "Europe/London",
    };
    expect(
      matchesClientActionIntent(existing, {
        action: "move",
        startsAt: "2026-08-12T09:00:00.000Z",
        clientTimezone: "Europe/London",
      }),
    ).toBe(true);
    expect(
      matchesClientActionIntent(existing, {
        action: "move",
        startsAt: "2026-08-12T09:00:00.000Z",
        clientTimezone: "America/New_York",
      }),
    ).toBe(false);
  });

  it("derives one stable secret manage token per booking", async () => {
    vi.stubEnv(
      "AUTH_TOKEN_SECRET",
      "test-secret-with-more-than-thirty-two-characters",
    );
    const first = await deriveOpaqueToken(
      "booking-manage",
      "booking-123",
    );
    const replay = await deriveOpaqueToken(
      "booking-manage",
      "booking-123",
    );
    const otherBooking = await deriveOpaqueToken(
      "booking-manage",
      "booking-456",
    );

    expect(first).toBe(replay);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(otherBooking).not.toBe(first);
  });

  it("keeps email dedupe keys stable and bounds every undelivered state", () => {
    const startsAt = new Date("2026-08-12T09:00:00.000Z");
    expect(clientConfirmationDedupeKey("booking-123", startsAt)).toBe(
      "confirm:booking-123:initial:2026-08-12T09:00:00.000Z",
    );
    expect(
      clientConfirmationDedupeKey("booking-123", startsAt, "action-123"),
    ).toBe("confirm:booking-123:action-123");
    expect(ownerNewBookingDedupeKey("booking-123", startsAt)).toBe(
      "owner-new:booking-123:2026-08-12T09:00:00.000Z",
    );
    expect(
      clientOwnerChangedDedupeKey("booking-123", "moved", "action-123"),
    ).toBe("client-owner:moved:booking-123:action-123");
    expect(
      ownerClientChangedDedupeKey(
        "booking-123",
        "cancelled",
        "action-456",
      ),
    ).toBe("owner-client:cancelled:booking-123:action-456");
    expect(
      bookingMailStateKey({ startsAt, lastActionKey: null, meetingLink: null }),
    ).toBe("initial:2026-08-12T09:00:00.000Z:meeting:-");
    expect(
      bookingMailStateKey({
        startsAt,
        lastActionKey: "action-456",
        meetingLink: "https://meet.example/updated",
      }),
    ).toBe("action:action-456:meeting:https://meet.example/updated");
    expect(STALE_OUTBOX_DELIVERY_STATES).toEqual(
      expect.arrayContaining([
        "pending",
        "processing",
        "failed",
        "skipped",
        "expired",
      ]),
    );
  });
});
