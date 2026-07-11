import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appOwnedStripeSubscriptions,
  aggregateStripeEntitlement,
  authoritativeStripeSubscription,
  checkoutIdempotencyKey,
  createStripeCustomer,
  isBillingCurrencyLocked,
  createCheckoutSession,
  listOpenStripeCheckoutSessions,
  listStripeSubscriptions,
  openStripeCheckoutUrl,
  retrieveStripeSubscription,
  stripeCancellationNoticeKey,
  stripeCurrencyCode,
  stripeOwnerReference,
  stripePaymentFailureTiming,
  stripeSubscriptionId,
  stripeSubscriptionAnomalies,
  subscriptionEntitlementPatch,
  verifyStripeSignature,
} from "../src/lib/billing";
import {
  CalendarUnavailableError,
  calendarBusy,
  createBookingCalendarEvent,
  revokeCalendarConnection,
} from "../src/lib/calendar";
import {
  bookingCalendarEvent,
  bookingCalendarLocation,
  effectiveBookingMeetingLink,
} from "../src/lib/booking-calendar";
import { canClientChangeBooking } from "../src/lib/booking-cutoff";
import { snapshotBookingService } from "../src/lib/booking-snapshot";
import { bookingEntitlement } from "../src/lib/entitlements";
import { requestIp } from "../src/lib/rate-limit";
import {
  generateIdentityToken,
  identityTokenVersion,
} from "../src/lib/auth-tokens";
import { checkHandle, normalizeHandle } from "../src/lib/handles";
import { buildIcs } from "../src/lib/ics";
import {
  generateSlots,
  openIntervalsForDay,
  subtractBusy,
} from "../src/lib/scheduling";
import {
  createSession,
  safeNextPath,
  safeNextUrl,
  verifySession,
  verifySessionDetails,
} from "../src/lib/session";
import { datePartsInZone, slotInstant } from "../src/lib/timezone";
import {
  canonicalAppUrl,
  canonicalBookingUrl,
  isHttpUrl,
} from "../src/lib/urls";

describe("launch hardening", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("normalizes handles while rejecting reserved, abusive, and ambiguous forms", () => {
    expect(normalizeHandle(" Dana.W ")).toBe("danaw");
    expect(checkHandle("dana-w")).toBe("available");
    expect(checkHandle("admin")).toBe("reserved");
    expect(checkHandle("dana-fuck")).toBe("reserved");
    expect(checkHandle("-dana")).toBe("invalid");
    expect(checkHandle("dana--w")).toBe("invalid");
    expect(checkHandle("ab")).toBe("too-short");
  });

  it("trusts forwarded client addresses only behind an explicit sanitized edge", () => {
    const request = new Request("https://booktimewith.link/api/slots", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.9",
      },
    });
    vi.stubEnv("TRUST_PROXY_HEADERS", "false");
    expect(requestIp(request)).toBe("untrusted-direct");
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    expect(requestIp(request)).toBe("203.0.113.10");
  });

  it("subtracts busy time and only emits starts where the full service fits", () => {
    const open = openIntervalsForDay(
      {
        "0-9-a": 1,
        "0-9-b": 1,
        "0-10-a": 1,
        "0-10-b": 1,
        "1-9-a": 1,
      },
      0,
    );
    expect(open).toEqual([{ start: 9 * 60, end: 11 * 60 }]);
    const free = subtractBusy(open, [{ start: 9 * 60 + 30, end: 10 * 60 }]);
    expect(free).toEqual([
      { start: 9 * 60, end: 9 * 60 + 30 },
      { start: 10 * 60, end: 11 * 60 },
    ]);
    expect(generateSlots(free, 50)).toEqual([10 * 60]);
  });

  it("materializes owner wall time correctly on both sides of UK DST", () => {
    expect(
      slotInstant(2026, 2, 29, 9 * 60, "Europe/London").toISOString(),
    ).toBe("2026-03-29T08:00:00.000Z");
    expect(
      slotInstant(2026, 9, 25, 9 * 60, "Europe/London").toISOString(),
    ).toBe("2026-10-25T09:00:00.000Z");
    expect(
      datePartsInZone(new Date("2026-03-28T23:30:00Z"), "Europe/London", 1),
    ).toMatchObject({
      y: 2026,
      m: 2,
      d: 29,
    });
  });

  it("fails closed at trial, grace, and cancellation entitlement boundaries", () => {
    const now = new Date("2026-07-11T12:00:00Z");
    expect(
      bookingEntitlement(
        {
          planStatus: "trialing",
          trialEndsAt: new Date("2026-07-11T12:00:01Z"),
          graceUntil: null,
          accessEndsAt: null,
          emailVerifiedAt: new Date("2026-07-01T00:00:00Z"),
        },
        now,
      ).allowed,
    ).toBe(true);
    expect(
      bookingEntitlement(
        {
          planStatus: "trialing",
          trialEndsAt: null,
          graceUntil: null,
          accessEndsAt: null,
          emailVerifiedAt: new Date("2026-07-01T00:00:00Z"),
        },
        now,
      ),
    ).toEqual({ allowed: false, reason: "trial_expired" });
    expect(
      bookingEntitlement(
        {
          planStatus: "past_due",
          trialEndsAt: null,
          graceUntil: now,
          accessEndsAt: null,
          emailVerifiedAt: new Date("2026-07-01T00:00:00Z"),
        },
        now,
      ).allowed,
    ).toBe(false);
    expect(
      bookingEntitlement(
        {
          planStatus: "cancelled",
          trialEndsAt: null,
          graceUntil: null,
          accessEndsAt: new Date("2026-07-12T12:00:00Z"),
          emailVerifiedAt: new Date("2026-07-01T00:00:00Z"),
        },
        now,
      ).allowed,
    ).toBe(true);
    expect(
      bookingEntitlement(
        {
          planStatus: "active",
          trialEndsAt: null,
          graceUntil: null,
          accessEndsAt: null,
          emailVerifiedAt: null,
        },
        now,
      ),
    ).toEqual({ allowed: false, reason: "email_unverified" });
  });

  it("locks client changes exactly at the 24-hour boundary", () => {
    const now = new Date("2026-07-11T12:00:00Z");
    expect(canClientChangeBooking(new Date("2026-07-12T12:00:00Z"), now)).toBe(
      true,
    );
    expect(
      canClientChangeBooking(new Date("2026-07-12T11:59:59.999Z"), now),
    ).toBe(false);
  });

  it("accepts a current Stripe signature and rejects stale or altered payloads", async () => {
    const secret = "whsec_test_secret";
    const payload = '{"id":"evt_123","type":"invoice.paid"}';
    const now = new Date("2026-07-11T12:00:00Z");
    const timestamp = Math.floor(now.getTime() / 1000);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${payload}`),
    );
    const signature = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const header = `t=${timestamp},v1=${"0".repeat(64)},v1=${signature}`;

    await expect(
      verifyStripeSignature(payload, header, secret, now),
    ).resolves.toBe(true);
    await expect(
      verifyStripeSignature(`${payload} `, header, secret, now),
    ).resolves.toBe(false);
    await expect(
      verifyStripeSignature(
        payload,
        header,
        secret,
        new Date(now.getTime() + 301_000),
      ),
    ).resolves.toBe(false);
  });

  it("finds subscriptions and owner metadata across Stripe webhook versions", () => {
    expect(
      stripeSubscriptionId("checkout.session.completed", {
        subscription: { id: "sub_checkout" },
      }),
    ).toBe("sub_checkout");
    expect(
      stripeSubscriptionId("invoice.paid", { subscription: "sub_legacy" }),
    ).toBe("sub_legacy");

    const basilInvoice = {
      parent: {
        subscription_details: {
          subscription: "sub_basil",
          metadata: { owner_id: "owner-123" },
        },
      },
    };
    expect(stripeSubscriptionId("invoice.payment_failed", basilInvoice)).toBe(
      "sub_basil",
    );
    expect(stripeOwnerReference(basilInvoice)).toBe("owner-123");
    expect(
      stripeSubscriptionId("customer.subscription.updated", {
        id: "sub_updated",
      }),
    ).toBe("sub_updated");
  });

  it("maps authoritative subscription state without regressing from event order", () => {
    const now = new Date("2026-07-11T12:00:00Z");
    const oldGrace = new Date("2026-07-20T12:00:00Z");

    expect(
      subscriptionEntitlementPatch(
        { status: "active", currency: "usd" },
        { graceUntil: oldGrace },
        now,
      ),
    ).toEqual({
      planStatus: "active",
      accessEndsAt: null,
      graceUntil: null,
      purgeAfter: null,
      currency: "USD",
    });

    const pastDue = subscriptionEntitlementPatch(
      { status: "past_due" },
      { graceUntil: oldGrace },
      now,
    );
    expect(pastDue?.graceUntil).toBe(oldGrace);
    expect(
      subscriptionEntitlementPatch(
        { status: "past_due" },
        { graceUntil: null },
        now,
      )?.graceUntil,
    ).toEqual(new Date("2026-07-25T12:00:00Z"));

    const cancelled = subscriptionEntitlementPatch(
      {
        status: "canceled",
        current_period_end: 1_783_776_000,
        items: {
          data: [
            { current_period_end: 1_786_368_000 },
            { current_period_end: 1_789_046_400 },
          ],
        },
      },
      { graceUntil: oldGrace },
      now,
    );
    expect(cancelled?.planStatus).toBe("cancelled");
    expect(cancelled?.accessEndsAt).toEqual(new Date(1_789_046_400_000));
    expect(cancelled?.purgeAfter).toEqual(
      new Date(1_789_046_400_000 + 90 * 86_400_000),
    );
    expect(
      subscriptionEntitlementPatch(
        { status: "a_future_status" },
        { graceUntil: null },
        now,
      ),
    ).toBeNull();

    const active = { id: "sub_active", status: "active" };
    const canceled = {
      id: "sub_canceled",
      status: "canceled",
      current_period_end: 1_800_000_000,
    };
    expect(authoritativeStripeSubscription([active, canceled])?.id).toBe(
      "sub_active",
    );
    expect(authoritativeStripeSubscription([canceled, active])?.id).toBe(
      "sub_active",
    );
    expect(
      authoritativeStripeSubscription([
        canceled,
        {
          id: "sub_later_canceled",
          status: "canceled",
          current_period_end: 1_900_000_000,
        },
      ])?.id,
    ).toBe("sub_later_canceled");

    const composite = aggregateStripeEntitlement(
      [
        {
          id: "sub_paid_through",
          status: "canceled",
          current_period_end: Math.floor(
            new Date("2026-08-20T12:00:00Z").getTime() / 1000,
          ),
        },
        { id: "sub_paused", status: "paused" },
      ],
      { graceUntil: null },
      now,
    );
    expect(composite.patch).toMatchObject({
      planStatus: "cancelled",
      accessEndsAt: new Date("2026-08-20T12:00:00Z"),
      purgeAfter: null,
    });
    expect(composite.hasManageableSubscription).toBe(true);

    const pastDueComposite = aggregateStripeEntitlement(
      [
        { id: "sub_due", status: "past_due" },
        {
          id: "sub_paid_through",
          status: "canceled",
          current_period_end: Math.floor(
            new Date("2026-08-20T12:00:00Z").getTime() / 1000,
          ),
        },
      ],
      { graceUntil: null },
      now,
    );
    expect(pastDueComposite.patch).toMatchObject({
      planStatus: "past_due",
      graceUntil: new Date("2026-08-20T12:00:00Z"),
      purgeAfter: null,
    });

    const longestLimitedGrant = aggregateStripeEntitlement(
      [
        {
          id: "sub_trial",
          status: "trialing",
          trial_end: Math.floor(
            new Date("2026-07-18T12:00:00Z").getTime() / 1000,
          ),
        },
        { id: "sub_due", status: "past_due" },
        {
          id: "sub_cancelled",
          status: "canceled",
          current_period_end: Math.floor(
            new Date("2026-07-20T12:00:00Z").getTime() / 1000,
          ),
        },
      ],
      { graceUntil: new Date("2026-07-25T12:00:00Z") },
      now,
    );
    expect(longestLimitedGrant.subscription?.id).toBe("sub_trial");
    expect(longestLimitedGrant.patch).toMatchObject({
      planStatus: "trialing",
      trialEndsAt: new Date("2026-07-25T12:00:00Z"),
    });

    const expiredPastDue = aggregateStripeEntitlement(
      [{ id: "sub_late_failure", status: "past_due" }],
      { graceUntil: new Date("2026-07-10T12:00:00Z") },
      now,
    );
    expect(expiredPastDue.patch).toMatchObject({
      planStatus: "past_due",
      graceUntil: new Date("2026-07-10T12:00:00Z"),
      purgeAfter: null,
    });
  });

  it("deduplicates aggregate cancellation notices across webhook order", () => {
    const paidThrough = new Date("2026-08-20T12:00:00Z");
    expect(
      stripeCancellationNoticeKey("owner-123", "sub_final", paidThrough),
    ).toBe("cancelled:owner-123:sub_final:1787227200");
    expect(
      stripeCancellationNoticeKey("owner-123", "sub_final", paidThrough),
    ).not.toBe(
      stripeCancellationNoticeKey("owner-123", "sub_next", paidThrough),
    );
    expect(
      stripeCancellationNoticeKey("owner-123", "sub_final", paidThrough),
    ).not.toBe(
      stripeCancellationNoticeKey(
        "owner-123",
        "sub_final",
        new Date("2026-08-21T12:00:00Z"),
      ),
    );
  });

  it("does not present elapsed payment retries or grace as future", () => {
    const now = new Date("2026-07-25T12:00:00Z");
    const elapsed = stripePaymentFailureTiming(
      new Date("2026-07-20T12:00:00Z"),
      Math.floor(new Date("2026-07-24T12:00:00Z").getTime() / 1000),
      now,
    );
    expect(elapsed).toEqual({
      graceExpired: true,
      retryAt: null,
      retryBeforeGrace: false,
    });

    const futureRetry = stripePaymentFailureTiming(
      new Date("2026-07-20T12:00:00Z"),
      Math.floor(new Date("2026-07-27T12:00:00Z").getTime() / 1000),
      now,
    );
    expect(futureRetry).toEqual({
      graceExpired: true,
      retryAt: new Date("2026-07-27T12:00:00Z"),
      retryBeforeGrace: false,
    });

    expect(
      stripePaymentFailureTiming(
        new Date("2026-07-30T12:00:00Z"),
        Math.floor(new Date("2026-07-27T12:00:00Z").getTime() / 1000),
        now,
      ).retryBeforeGrace,
    ).toBe(true);
  });

  it("retrieves current Stripe subscription state and tolerates a deleted resource", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: "subscription",
            id: "sub_current",
            customer: "cus_123",
            metadata: { owner_id: "owner-123" },
            status: "active",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "resource_missing",
              message: "No such subscription",
            },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      retrieveStripeSubscription("sub_current"),
    ).resolves.toMatchObject({
      customer: "cus_123",
      status: "active",
    });
    await expect(retrieveStripeSubscription("sub_deleted")).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.stripe.com/v1/subscriptions/sub_current",
    );
    expect(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
    ).toMatchObject({ Authorization: "Bearer sk_test_secret" });
  });

  it("reconciles every customer subscription so a newer active plan wins", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: "list",
            has_more: true,
            data: [
              {
                object: "subscription",
                id: "sub_old",
                customer: "cus_123",
                metadata: { owner_id: "owner-123" },
                status: "canceled",
                current_period_end: 100,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: "list",
            has_more: false,
            data: [
              {
                object: "subscription",
                id: "sub_new",
                customer: "cus_123",
                metadata: { owner_id: "owner-123" },
                status: "active",
                created: 200,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const subscriptions = await listStripeSubscriptions("cus_123");
    expect(subscriptions.map((subscription) => subscription.id)).toEqual([
      "sub_old",
      "sub_new",
    ]);
    expect(authoritativeStripeSubscription(subscriptions)?.id).toBe("sub_new");
    expect(appOwnedStripeSubscriptions(subscriptions, "another-owner")).toEqual(
      [],
    );
    const secondUrl = fetchMock.mock.calls[1]?.[0] as URL;
    expect(secondUrl.searchParams.get("starting_after")).toBe("sub_old");
    expect(secondUrl.searchParams.get("status")).toBe("all");
    expect(
      stripeSubscriptionAnomalies([
        { status: "active", currency: "gbp" },
        { status: "past_due", currency: "usd" },
      ]),
    ).toEqual({ multipleManageable: true, conflictingCurrencies: true });
    expect(
      stripeSubscriptionAnomalies([
        { status: "active", currency: "gbp" },
        { status: "past_due", currency: "cad" },
      ]).conflictingCurrencies,
    ).toBe(true);
  });

  it("reuses an app-owned open Checkout and ignores another tenant's session", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_secret");
    const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          has_more: false,
          data: [
            {
              object: "checkout.session",
              id: "cs_other",
              customer: "cus_123",
              mode: "subscription",
              status: "open",
              metadata: { owner_id: "other-owner" },
              expires_at: expiresAt,
              url: "https://checkout.stripe.test/other",
            },
            {
              object: "checkout.session",
              id: "cs_owned",
              customer: "cus_123",
              mode: "subscription",
              status: "open",
              metadata: { owner_id: "owner-123" },
              expires_at: expiresAt,
              url: "https://checkout.stripe.test/owned",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const sessions = await listOpenStripeCheckoutSessions(
      "cus_123",
      "owner-123",
    );
    expect(sessions.map((session) => session.id)).toEqual(["cs_owned"]);
    expect(openStripeCheckoutUrl(sessions)).toBe(
      "https://checkout.stripe.test/owned",
    );
  });

  it("creates one idempotent Stripe customer identity per owner", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ object: "customer", id: "cus_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createStripeCustomer({
        ownerId: "owner-123",
        email: "owner@example.com",
      }),
    ).resolves.toBe("cus_123");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      "Idempotency-Key": "billing-customer:owner-123",
    });
    expect(request.body).toContain("metadata%5Bowner_id%5D=owner-123");
  });

  it("uses a fresh key per Checkout attempt and reuses an explicit live attempt", async () => {
    expect(checkoutIdempotencyKey("attempt-a")).toBe(
      "checkout-session:attempt-a",
    );
    vi.stubEnv("STRIPE_PRICE_GBP", "price_gbp");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_secret");
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            object: "checkout.session",
            url: "https://checkout.stripe.test/session",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const checkout = {
      ownerId: "owner-123",
      customerId: "cus_123",
      currency: "GBP",
      baseUrl: "https://booktimewith.com",
    };

    await createCheckoutSession(checkout);
    await createCheckoutSession(checkout);

    const firstHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit)
      .headers as Record<string, string>;
    const secondHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit)
      .headers as Record<string, string>;
    expect(firstHeaders["Idempotency-Key"]).toMatch(/^checkout-session:/);
    expect(secondHeaders["Idempotency-Key"]).toMatch(/^checkout-session:/);
    expect(firstHeaders["Idempotency-Key"]).not.toBe(
      secondHeaders["Idempotency-Key"],
    );

    await createCheckoutSession({
      ...checkout,
      attemptId: "persisted-attempt",
    });
    await createCheckoutSession({
      ...checkout,
      attemptId: "persisted-attempt",
    });
    const thirdHeaders = (fetchMock.mock.calls[2]?.[1] as RequestInit)
      .headers as Record<string, string>;
    const fourthHeaders = (fetchMock.mock.calls[3]?.[1] as RequestInit)
      .headers as Record<string, string>;
    expect(thirdHeaders["Idempotency-Key"]).toBe(
      "checkout-session:persisted-attempt",
    );
    expect(fourthHeaders["Idempotency-Key"]).toBe(
      thirdHeaders["Idempotency-Key"],
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining("customer=cus_123"),
    });
  });

  it("locks display currency once Stripe owns the plan and normalizes webhook currency", () => {
    expect(
      isBillingCurrencyLocked({
        stripeCustomerId: null,
        planStatus: "trialing",
      }),
    ).toBe(false);
    expect(
      isBillingCurrencyLocked({ stripeCustomerId: null, planStatus: "paused" }),
    ).toBe(false);
    expect(
      isBillingCurrencyLocked({
        stripeCustomerId: "cus_123",
        planStatus: "trialing",
      }),
    ).toBe(false);
    expect(
      isBillingCurrencyLocked({
        stripeCustomerId: "cus_123",
        stripeCheckoutAttemptId: "attempt",
        stripeCheckoutAttemptAt: new Date(),
        planStatus: "trialing",
      }),
    ).toBe(true);
    expect(
      isBillingCurrencyLocked({ stripeCustomerId: null, planStatus: "active" }),
    ).toBe(true);
    expect(
      isBillingCurrencyLocked({
        stripeCustomerId: null,
        planStatus: "past_due",
      }),
    ).toBe(true);
    expect(
      isBillingCurrencyLocked({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_cancelled",
        planStatus: "cancelled",
      }),
    ).toBe(false);
    expect(
      isBillingCurrencyLocked({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_cancelled",
        stripeHasManageableSubscription: true,
        planStatus: "cancelled",
      }),
    ).toBe(true);
    expect(stripeCurrencyCode("usd")).toBe("USD");
    expect(stripeCurrencyCode("Aud")).toBe("AUD");
    expect(stripeCurrencyCode("cad")).toBeUndefined();
  });

  it("never falls back to a different Stripe currency price", async () => {
    vi.stubEnv("STRIPE_PRICE_GBP", "price_gbp");
    vi.stubEnv("STRIPE_PRICE_USD", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createCheckoutSession({
        ownerId: "owner-123",
        customerId: "cus_123",
        currency: "USD",
        baseUrl: "https://booktimewith.com",
      }),
    ).rejects.toThrow("No Stripe USD price is configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs expiring sessions and permits only same-site redirect paths", async () => {
    const issued = new Date("2026-07-11T12:00:00Z");
    const session = await createSession("owner-123", issued);
    await expect(verifySession(session, issued)).resolves.toBe("owner-123");
    const rotated = await createSession("owner-123", issued, 3);
    await expect(verifySessionDetails(rotated, issued)).resolves.toEqual({
      ownerId: "owner-123",
      sessionVersion: 3,
    });
    await expect(
      verifySession(session, new Date("2026-08-11T12:00:00Z")),
    ).resolves.toBeNull();
    expect(safeNextPath("/app/settings?billing=done")).toBe(
      "/app/settings?billing=done",
    );
    expect(safeNextPath("//evil.example")).toBe("/app");
    expect(safeNextPath("/\\evil.example")).toBe("/app");
    expect(safeNextPath("/\r/evil.example")).toBe("/app");
    expect(safeNextPath("/\n/evil.example")).toBe("/app");
    expect(safeNextPath("/\t/evil.example")).toBe("/app");
    expect(safeNextPath("/\u0000/evil.example")).toBe("/app");
    expect(safeNextPath("https://evil.example/path")).toBe("/app");
    expect(
      safeNextUrl("/app/bookings?day=today", "https://booktimewith.com").href,
    ).toBe("https://booktimewith.com/app/bookings?day=today");
    expect(
      safeNextUrl("/\n/evil.example", "https://booktimewith.com").href,
    ).toBe("https://booktimewith.com/app");
    expect(
      safeNextUrl("//evil.example", "https://booktimewith.com").href,
    ).toBe("https://booktimewith.com/app");
  });

  it("binds identity links to the session generation", () => {
    const token = generateIdentityToken(7);
    expect(identityTokenVersion(token)).toBe(7);
    expect(identityTokenVersion("legacy-token")).toBe(0);
    expect(identityTokenVersion("token.not-a-version")).toBeNull();
  });

  it("uses configured canonical origins and only falls back to request origins on loopback", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test/some/path");
    vi.stubEnv("NEXT_PUBLIC_BOOKING_URL", "https://book.example.test/ignored");
    expect(canonicalAppUrl("https://attacker.example/api/auth/signin")).toBe(
      "https://app.example.test",
    );
    expect(canonicalBookingUrl("https://attacker.example/api/bookings")).toBe(
      "https://book.example.test",
    );

    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_BOOKING_URL", "");
    expect(canonicalAppUrl("http://localhost:3123/api/auth/signin")).toBe(
      "http://localhost:3123",
    );
    expect(canonicalBookingUrl("https://attacker.example/api/bookings")).toBe(
      "https://booktimewith.link",
    );
  });

  it("keeps calendar credentials retryable until provider revocation succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream error", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_token" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const connection = {
      provider: "google",
      accessToken: "already-plain-migration-token",
    };

    await expect(revokeCalendarConnection(connection)).resolves.toBe(false);
    await expect(revokeCalendarConnection(connection)).resolves.toBe(true);
  });

  it("accepts only http and https links for owner-configured meeting URLs", () => {
    expect(isHttpUrl("https://meet.example/session")).toBe(true);
    expect(isHttpUrl("http://localhost:3001/call")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,phish")).toBe(false);
    expect(isHttpUrl("ftp://files.example/call")).toBe(false);
  });

  it("escapes calendar text and keeps a stable booking UID", () => {
    const ics = buildIcs({
      uid: "booking-123@booktimewith.com",
      title: "Therapy, review; follow-up",
      description: "Line one\nLine two",
      start: new Date("2026-07-14T09:00:00Z"),
      end: new Date("2026-07-14T09:50:00Z"),
    });
    expect(ics).toContain("UID:booking-123@booktimewith.com");
    expect(ics).toContain("SUMMARY:Therapy\\, review\\; follow-up");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
  });

  it("fails closed when Google returns a per-calendar free/busy error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            calendars: {
              primary: {
                errors: [{ domain: "global", reason: "internalError" }],
                busy: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      calendarBusy(
        { provider: "google", accessToken: "test-token" },
        new Date("2026-07-11T00:00:00Z"),
        new Date("2026-07-12T00:00:00Z"),
      ),
    ).rejects.toBeInstanceOf(CalendarUnavailableError);
  });

  it("pages through Graph and blocks every event that is not explicitly free", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                start: { dateTime: "2026-07-11T09:00:00.0000000" },
                end: { dateTime: "2026-07-11T10:00:00.0000000" },
                showAs: "free",
              },
              {
                start: { dateTime: "2026-07-11T10:00:00.0000000" },
                end: { dateTime: "2026-07-11T11:00:00.0000000" },
                showAs: "tentative",
              },
            ],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=next",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                start: { dateTime: "2026-07-11T12:00:00.0000000" },
                end: { dateTime: "2026-07-11T13:00:00.0000000" },
                showAs: "unknown",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const busy = await calendarBusy(
      { provider: "outlook", accessToken: "test-token" },
      new Date("2026-07-11T00:00:00Z"),
      new Date("2026-07-12T00:00:00Z"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(busy.map((span) => span.start.toISOString())).toEqual([
      "2026-07-11T10:00:00.000Z",
      "2026-07-11T12:00:00.000Z",
    ]);
  });

  it("fails closed on an invalid Graph busy instant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            value: [
              {
                start: { dateTime: "not-a-date" },
                end: { dateTime: "2026-07-11T13:00:00" },
                showAs: "busy",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      calendarBusy(
        { provider: "outlook", accessToken: "test-token" },
        new Date("2026-07-11T00:00:00Z"),
        new Date("2026-07-12T00:00:00Z"),
      ),
    ).rejects.toBeInstanceOf(CalendarUnavailableError);
  });

  it("polls a pending Google conference and returns the eventual Meet link", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "bookingevent123",
            conferenceData: {
              createRequest: { status: { statusCode: "pending" } },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "bookingevent123",
            conferenceData: {
              createRequest: { status: { statusCode: "success" } },
              entryPoints: [
                {
                  entryPointType: "video",
                  uri: "https://meet.google.com/abc-defg-hij",
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createBookingCalendarEvent(
      { provider: "google", accessToken: "test-token" },
      {
        title: "Consultation · Client",
        start: new Date("2026-07-11T10:00:00Z"),
        end: new Date("2026-07-11T11:00:00Z"),
        location: "10 High Street, London",
        idempotencyKey: "bookingevent123",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const createBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { location?: string };
    expect(createBody.location).toBe("10 High Street, London");
    expect(result).toMatchObject({
      ok: true,
      eventId: "bookingevent123",
      meetingLink: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("resolves service settings into immutable booking presentation", () => {
    expect(
      snapshotBookingService(
        {
          name: " Consultation ",
          locationMode: "mine",
          ownerAddress: " 20 Market Road ",
        },
        "10 High Street",
      ),
    ).toEqual({
      serviceNameSnapshot: "Consultation",
      locationModeSnapshot: "mine",
      locationSnapshot: "20 Market Road",
      meetingLinkSnapshot: null,
    });
    expect(
      snapshotBookingService(
        {
          name: "Consultation",
          locationMode: "theirs",
          ownerAddress: "20 Market Road",
        },
        " 10 High Street ",
      ),
    ).toEqual({
      serviceNameSnapshot: "Consultation",
      locationModeSnapshot: "theirs",
      locationSnapshot: "10 High Street",
      meetingLinkSnapshot: null,
    });
  });

  it("restores the immutable static link when provider state is cleared", () => {
    const booking = {
      meetingLink: "https://meet.google.com/stale-provider-link",
      meetingLinkSnapshot: "https://zoom.example/static-room",
    };
    expect(
      effectiveBookingMeetingLink(booking, "cancel", { ok: true }),
    ).toBe("https://zoom.example/static-room");
    expect(
      effectiveBookingMeetingLink(booking, "upsert", { ok: true }),
    ).toBe("https://zoom.example/static-room");
    expect(
      effectiveBookingMeetingLink(booking, "upsert", {
        ok: true,
        meetingLink: "https://meet.google.com/new-provider-link",
      }),
    ).toBe("https://meet.google.com/new-provider-link");
    expect(
      effectiveBookingMeetingLink(booking, "upsert", { ok: false }),
    ).toBe("https://meet.google.com/stale-provider-link");
  });

  it("passes only the snapshotted address to calendar events", () => {
    expect(
      bookingCalendarLocation({ locationSnapshot: " 10 High Street " }),
    ).toBe("10 High Street");
    expect(
      bookingCalendarLocation({ locationSnapshot: null }),
    ).toBeUndefined();
    expect(
      bookingCalendarEvent(
        { handle: "dana" },
        {
          id: "booking-123",
          serviceNameSnapshot: "Original consultation",
          clientName: "Alex Martin",
          startsAt: new Date("2026-08-12T09:00:00Z"),
          endsAt: new Date("2026-08-12T10:00:00Z"),
          locationSnapshot: "10 High Street",
          calendarRevision: 2,
        },
      ),
    ).toMatchObject({
      title: "Original consultation · Alex Martin",
      location: "10 High Street",
      idempotencyKey: "booking-123-2",
    });
  });

  it("replaces a failed Google conference request with a fresh request id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "bookingevent456",
            conferenceData: {
              createRequest: {
                requestId: "bookingevent456",
                status: { statusCode: "failure" },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "bookingevent456",
            conferenceData: {
              createRequest: { status: { statusCode: "pending" } },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "bookingevent456",
            conferenceData: {
              createRequest: { status: { statusCode: "success" } },
              entryPoints: [
                {
                  entryPointType: "video",
                  uri: "https://meet.google.com/new-link",
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createBookingCalendarEvent(
      { provider: "google", accessToken: "test-token" },
      {
        title: "Consultation · Client",
        start: new Date("2026-07-11T10:00:00Z"),
        end: new Date("2026-07-11T11:00:00Z"),
        idempotencyKey: "bookingevent456",
      },
    );

    const recoveryBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body),
    ) as { conferenceData: { createRequest: { requestId: string } } };
    expect(recoveryBody.conferenceData.createRequest.requestId).not.toBe(
      "bookingevent456",
    );
    expect(result).toMatchObject({
      ok: true,
      eventId: "bookingevent456",
      meetingLink: "https://meet.google.com/new-link",
    });
  });
});
