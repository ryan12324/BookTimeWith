/**
 * Stripe billing (README "Billing rules"): one product, multi-currency prices,
 * 30-day card-less trial, Smart Retries mapped to a 14-day grace, Customer
 * Portal, webhooks driving emails + page state.
 *
 * Plain REST via fetch — no SDK to keep the image small. Checkout/Portal are
 * gated on STRIPE_SECRET_KEY, and webhooks always require their own signing
 * secret; an unconfigured environment fails closed.
 */

export const stripeConfigured = () =>
  Boolean(process.env.STRIPE_SECRET_KEY?.trim());

type BillingCurrencyOwner = {
  stripeCustomerId: string | null;
  stripeSubscriptionId?: string | null;
  stripeHasManageableSubscription?: boolean;
  stripeCheckoutAttemptId?: string | null;
  stripeCheckoutAttemptAt?: Date | null;
  planStatus: "trialing" | "active" | "past_due" | "paused" | "cancelled";
};

/**
 * Currency is a Checkout preference until an attempt or subscription exists.
 * A bare pre-created customer does not lock it; a live Checkout or subscription
 * does, because changing only the database label would not change Stripe's price.
 */
export function isBillingCurrencyLocked(
  owner: BillingCurrencyOwner,
  now = new Date(),
): boolean {
  const liveCheckoutAttempt =
    Boolean(owner.stripeCheckoutAttemptId) &&
    Boolean(owner.stripeCheckoutAttemptAt) &&
    owner.stripeCheckoutAttemptAt!.getTime() > now.getTime() - 24 * 60 * 60_000;
  return (
    Boolean(owner.stripeHasManageableSubscription) ||
    (Boolean(owner.stripeSubscriptionId) && owner.planStatus !== "cancelled") ||
    liveCheckoutAttempt ||
    owner.planStatus === "active" ||
    owner.planStatus === "past_due"
  );
}

export function stripeCurrencyCode(
  value: string | null | undefined,
): "GBP" | "USD" | "EUR" | "AUD" | undefined {
  const normalized = value?.toUpperCase();
  return normalized === "GBP" ||
    normalized === "USD" ||
    normalized === "EUR" ||
    normalized === "AUD"
    ? normalized
    : undefined;
}

const DAY_MS = 86_400_000;
const GRACE_DAYS = 14;
const RETENTION_DAYS = 90;

type JsonRecord = Record<string, unknown>;

export interface StripeSubscriptionSnapshot extends JsonRecord {
  id?: string;
  object?: string;
  created?: number;
  customer?: unknown;
  metadata?: { owner_id?: string };
  status?: string;
  currency?: string;
  current_period_end?: number;
  ended_at?: number | null;
  canceled_at?: number | null;
  cancel_at?: number | null;
  trial_end?: number | null;
  items?: {
    data?: Array<{ current_period_end?: number }>;
  };
}

export interface SubscriptionEntitlementPatch {
  planStatus: "trialing" | "active" | "past_due" | "paused" | "cancelled";
  trialEndsAt?: Date | null;
  accessEndsAt: Date | null;
  graceUntil: Date | null;
  purgeAfter: Date | null;
  currency?: "GBP" | "USD" | "EUR" | "AUD";
}

const asRecord = (value: unknown): JsonRecord | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;

/** Return an id from either a Stripe id string or an expanded resource. */
export function stripeResourceId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  const id = asRecord(value)?.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/**
 * Find the subscription represented by each webhook object shape. Recent
 * invoice payloads put subscription data below `parent`; legacy payloads use
 * the top-level `subscription` field.
 */
export function stripeSubscriptionId(
  eventType: string,
  value: unknown,
): string | undefined {
  const object = asRecord(value);
  if (!object) return undefined;

  const direct = stripeResourceId(object.subscription);
  if (direct) return direct;

  const parentDetails = asRecord(asRecord(object.parent)?.subscription_details);
  const parentSubscription = stripeResourceId(parentDetails?.subscription);
  if (parentSubscription) return parentSubscription;

  const legacyDetails = asRecord(object.subscription_details);
  const legacySubscription = stripeResourceId(legacyDetails?.subscription);
  if (legacySubscription) return legacySubscription;

  return eventType.startsWith("customer.subscription.")
    ? stripeResourceId(object.id)
    : undefined;
}

/** Resolve the tenant reference from Checkout, Subscription, or Invoice data. */
export function stripeOwnerReference(value: unknown): string | undefined {
  const object = asRecord(value);
  if (!object) return undefined;
  const candidates = [
    object.client_reference_id,
    asRecord(object.metadata)?.owner_id,
    asRecord(asRecord(object.subscription_details)?.metadata)?.owner_id,
    asRecord(asRecord(asRecord(object.parent)?.subscription_details)?.metadata)
      ?.owner_id,
  ];
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.length > 0,
  );
}

/** Only subscriptions created by this app for this tenant may grant access. */
export function appOwnedStripeSubscriptions(
  subscriptions: StripeSubscriptionSnapshot[],
  ownerId: string,
): StripeSubscriptionSnapshot[] {
  return subscriptions.filter(
    (subscription) => stripeOwnerReference(subscription) === ownerId,
  );
}

/** A new Checkout attempt must not replay a completed or expired Session. */
export function checkoutIdempotencyKey(
  attemptId = crypto.randomUUID(),
): string {
  return `checkout-session:${attemptId}`;
}

/** One stable remote customer per local owner, including concurrent requests. */
export function customerIdempotencyKey(ownerId: string): string {
  return `billing-customer:${ownerId}`;
}

/** Fetch current subscription state instead of trusting webhook delivery order. */
export async function retrieveStripeSubscription(
  subscriptionId: string,
): Promise<StripeSubscriptionSnapshot | null> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Stripe is not configured");

  const response = await fetch(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const data = (await response
    .json()
    .catch(() => ({}))) as StripeSubscriptionSnapshot & {
    error?: { code?: string; message?: string };
  };
  if (response.status === 404 && data.error?.code === "resource_missing")
    return null;
  if (!response.ok) {
    throw new Error(
      data.error?.message ?? "Stripe subscription retrieval failed",
    );
  }
  if (
    data.object !== "subscription" ||
    stripeResourceId(data.id) !== subscriptionId
  ) {
    throw new Error("Stripe returned an invalid subscription");
  }
  return data;
}

interface StripeSubscriptionList {
  object?: string;
  data?: unknown;
  has_more?: boolean;
  error?: { code?: string; message?: string };
}

export class StripeResourceMissingError extends Error {
  constructor(message = "Stripe resource is missing") {
    super(message);
    this.name = "StripeResourceMissingError";
  }
}

export interface StripeCheckoutSessionSnapshot extends JsonRecord {
  id?: string;
  object?: string;
  customer?: unknown;
  metadata?: { owner_id?: string };
  mode?: string;
  status?: string;
  created?: number;
  expires_at?: number;
  url?: string | null;
}

/**
 * Fetch every subscription for one dedicated customer. `status=all` is
 * important: a delayed cancellation for subscription A must be reconciled
 * against a newer active subscription B before local entitlement changes.
 */
export async function listStripeSubscriptions(
  customerId: string,
): Promise<StripeSubscriptionSnapshot[]> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Stripe is not configured");

  const subscriptions: StripeSubscriptionSnapshot[] = [];
  let startingAfter: string | undefined;
  const seenCursors = new Set<string>();
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://api.stripe.com/v1/subscriptions");
    url.searchParams.set("customer", customerId);
    url.searchParams.set("status", "all");
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response
      .json()
      .catch(() => ({}))) as StripeSubscriptionList;
    if (!response.ok) {
      if (response.status === 404 && body.error?.code === "resource_missing") {
        throw new StripeResourceMissingError(body.error.message);
      }
      throw new Error(
        body.error?.message ?? "Stripe subscription listing failed",
      );
    }
    if (body.object !== "list" || !Array.isArray(body.data)) {
      throw new Error("Stripe returned an invalid subscription list");
    }

    const pageSubscriptions = body.data as StripeSubscriptionSnapshot[];
    for (const subscription of pageSubscriptions) {
      const id = stripeResourceId(subscription.id);
      const subscriptionCustomerId = stripeResourceId(subscription.customer);
      if (
        subscription.object !== "subscription" ||
        !id ||
        subscriptionCustomerId !== customerId
      ) {
        throw new Error("Stripe returned an invalid customer subscription");
      }
      subscriptions.push(subscription);
    }
    if (!body.has_more) return subscriptions;

    const nextCursor = stripeResourceId(pageSubscriptions.at(-1)?.id);
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error("Stripe subscription pagination did not advance");
    }
    seenCursors.add(nextCursor);
    startingAfter = nextCursor;
  }
  throw new Error("Stripe returned too many subscription pages");
}

/** List open subscription Checkouts so retries return one existing payment flow. */
export async function listOpenStripeCheckoutSessions(
  customerId: string,
  ownerId: string,
): Promise<StripeCheckoutSessionSnapshot[]> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Stripe is not configured");

  const sessions: StripeCheckoutSessionSnapshot[] = [];
  let startingAfter: string | undefined;
  const seenCursors = new Set<string>();
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://api.stripe.com/v1/checkout/sessions");
    url.searchParams.set("customer", customerId);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response
      .json()
      .catch(() => ({}))) as StripeSubscriptionList;
    if (!response.ok) {
      if (response.status === 404 && body.error?.code === "resource_missing") {
        throw new StripeResourceMissingError(body.error.message);
      }
      throw new Error(body.error?.message ?? "Stripe Checkout listing failed");
    }
    if (body.object !== "list" || !Array.isArray(body.data)) {
      throw new Error("Stripe returned an invalid Checkout list");
    }

    const pageSessions = body.data as StripeCheckoutSessionSnapshot[];
    for (const session of pageSessions) {
      const id = stripeResourceId(session.id);
      const sessionCustomerId = stripeResourceId(session.customer);
      if (
        session.object !== "checkout.session" ||
        !id ||
        sessionCustomerId !== customerId
      ) {
        throw new Error("Stripe returned an invalid customer Checkout session");
      }
      if (
        session.mode === "subscription" &&
        session.status === "open" &&
        stripeOwnerReference(session) === ownerId
      ) {
        sessions.push(session);
      }
    }
    if (!body.has_more) {
      return sessions.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    }

    const nextCursor = stripeResourceId(pageSessions.at(-1)?.id);
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error("Stripe Checkout pagination did not advance");
    }
    seenCursors.add(nextCursor);
    startingAfter = nextCursor;
  }
  throw new Error("Stripe returned too many Checkout pages");
}

export function openStripeCheckoutUrl(
  sessions: StripeCheckoutSessionSnapshot[],
  now = new Date(),
): string | null {
  const session = sessions.find(
    (candidate) =>
      typeof candidate.url === "string" &&
      /^https:\/\//.test(candidate.url) &&
      typeof candidate.expires_at === "number" &&
      candidate.expires_at * 1000 > now.getTime(),
  );
  return typeof session?.url === "string" ? session.url : null;
}

const SUBSCRIPTION_PRIORITY: Record<string, number> = {
  active: 60,
  trialing: 50,
  past_due: 40,
  canceled: 30,
  paused: 20,
  unpaid: 20,
  incomplete: 20,
  incomplete_expired: 10,
};

/** Choose the one subscription whose state should drive local entitlement. */
export function authoritativeStripeSubscription(
  subscriptions: StripeSubscriptionSnapshot[],
): StripeSubscriptionSnapshot | null {
  return (
    subscriptions
      .filter(
        (subscription) =>
          SUBSCRIPTION_PRIORITY[subscription.status ?? ""] !== undefined,
      )
      .sort((a, b) => {
        const priority =
          SUBSCRIPTION_PRIORITY[b.status ?? ""] -
          SUBSCRIPTION_PRIORITY[a.status ?? ""];
        if (priority !== 0) return priority;
        const paidThrough =
          subscriptionPaidThrough(b, new Date(0)).getTime() -
          subscriptionPaidThrough(a, new Date(0)).getTime();
        if (paidThrough !== 0) return paidThrough;
        const created = (b.created ?? 0) - (a.created ?? 0);
        if (created !== 0) return created;
        return (stripeResourceId(b.id) ?? "").localeCompare(
          stripeResourceId(a.id) ?? "",
        );
      })[0] ?? null
  );
}

export function stripeSubscriptionCanUsePortal(
  subscription: StripeSubscriptionSnapshot,
): boolean {
  return [
    "active",
    "trialing",
    "past_due",
    "paused",
    "unpaid",
    "incomplete",
  ].includes(subscription.status ?? "");
}

export function stripeSubscriptionAnomalies(
  subscriptions: StripeSubscriptionSnapshot[],
): { multipleManageable: boolean; conflictingCurrencies: boolean } {
  const manageable = subscriptions.filter(stripeSubscriptionCanUsePortal);
  const currencies = new Set(
    manageable.map((subscription) =>
      typeof subscription.currency === "string" && subscription.currency.trim()
        ? subscription.currency.trim().toUpperCase()
        : "__MISSING__",
    ),
  );
  return {
    multipleManageable: manageable.length > 1,
    conflictingCurrencies: currencies.size > 1,
  };
}

const stripeDate = (seconds: unknown): Date | null => {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return null;
  }
  return new Date(seconds * 1000);
};

export interface StripePaymentFailureTiming {
  graceExpired: boolean;
  retryAt: Date | null;
  retryBeforeGrace: boolean;
}

/** Keep late failure mail from presenting elapsed grace or retry dates as future. */
export function stripePaymentFailureTiming(
  graceUntil: Date,
  nextPaymentAttempt: number | null | undefined,
  now = new Date(),
): StripePaymentFailureTiming {
  const scheduledRetry = stripeDate(nextPaymentAttempt);
  const retryAt =
    scheduledRetry && scheduledRetry.getTime() > now.getTime()
      ? scheduledRetry
      : null;
  return {
    graceExpired: graceUntil.getTime() <= now.getTime(),
    retryAt,
    retryBeforeGrace:
      retryAt !== null && retryAt.getTime() <= graceUntil.getTime(),
  };
}

/** One logical cancellation notice, independent of webhook delivery order. */
export function stripeCancellationNoticeKey(
  ownerId: string,
  subscriptionId: string | null | undefined,
  paidThrough: Date,
): string {
  return `cancelled:${ownerId}:${subscriptionId ?? "aggregate"}:${Math.floor(
    paidThrough.getTime() / 1000,
  )}`;
}

/** The last paid-through instant, including item-level period fields. */
export function subscriptionPaidThrough(
  subscription: StripeSubscriptionSnapshot,
  now = new Date(),
): Date {
  const periodEnds = [
    stripeDate(subscription.current_period_end),
    ...(subscription.items?.data ?? []).map((item) =>
      stripeDate(item.current_period_end),
    ),
  ].filter((date): date is Date => date !== null);
  if (periodEnds.length > 0) {
    return new Date(Math.max(...periodEnds.map((date) => date.getTime())));
  }
  return (
    stripeDate(subscription.ended_at) ??
    stripeDate(subscription.canceled_at) ??
    stripeDate(subscription.cancel_at) ??
    stripeDate(subscription.trial_end) ??
    now
  );
}

/** Map one authoritative Stripe snapshot to the local entitlement columns. */
export function subscriptionEntitlementPatch(
  subscription: StripeSubscriptionSnapshot,
  current: { graceUntil: Date | null },
  now = new Date(),
): SubscriptionEntitlementPatch | null {
  const currency = stripeCurrencyCode(subscription.currency);
  const withCurrency = currency ? { currency } : {};

  switch (subscription.status) {
    case "active":
      return {
        planStatus: "active",
        accessEndsAt: null,
        graceUntil: null,
        purgeAfter: null,
        ...withCurrency,
      };
    case "trialing":
      return {
        planStatus: "trialing",
        trialEndsAt: stripeDate(subscription.trial_end),
        accessEndsAt: null,
        graceUntil: null,
        purgeAfter: null,
        ...withCurrency,
      };
    case "past_due":
      return {
        planStatus: "past_due",
        accessEndsAt: null,
        graceUntil:
          current.graceUntil ?? new Date(now.getTime() + GRACE_DAYS * DAY_MS),
        purgeAfter: null,
        ...withCurrency,
      };
    case "paused":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
      return {
        planStatus: "paused",
        accessEndsAt: null,
        graceUntil: null,
        purgeAfter: null,
        ...withCurrency,
      };
    case "canceled": {
      const accessEndsAt = subscriptionPaidThrough(subscription, now);
      return {
        planStatus: "cancelled",
        accessEndsAt,
        graceUntil: null,
        purgeAfter: new Date(accessEndsAt.getTime() + RETENTION_DAYS * DAY_MS),
        ...withCurrency,
      };
    }
    default:
      return null;
  }
}

export interface StripeEntitlementAggregate {
  subscription: StripeSubscriptionSnapshot | null;
  patch: SubscriptionEntitlementPatch | null;
  hasManageableSubscription: boolean;
}

/**
 * Reconcile customer-wide entitlement without letting one sibling revoke what
 * another still grants. The representative subscription is diagnostic only;
 * the patch aggregates paid-through/grace and never schedules purge while any
 * subscription remains manageable in Portal.
 */
export function aggregateStripeEntitlement(
  subscriptions: StripeSubscriptionSnapshot[],
  current: { graceUntil: Date | null },
  now = new Date(),
): StripeEntitlementAggregate {
  const manageable = subscriptions.filter(stripeSubscriptionCanUsePortal);
  const hasManageableSubscription = manageable.length > 0;
  const byStatus = (...statuses: string[]) =>
    authoritativeStripeSubscription(
      subscriptions.filter((subscription) =>
        statuses.includes(subscription.status ?? ""),
      ),
    );
  const canceled = byStatus("canceled");
  const canceledPaidThrough = canceled
    ? subscriptionPaidThrough(canceled, now)
    : null;
  const result = (
    subscription: StripeSubscriptionSnapshot | null,
    patch: SubscriptionEntitlementPatch | null,
  ): StripeEntitlementAggregate => ({
    subscription,
    patch,
    hasManageableSubscription,
  });

  const active = byStatus("active");
  if (active) {
    return result(active, subscriptionEntitlementPatch(active, current, now));
  }

  const trialing = byStatus("trialing");
  const pastDue = byStatus("past_due");
  const candidates: Array<{
    subscription: StripeSubscriptionSnapshot;
    patch: SubscriptionEntitlementPatch;
    until: Date;
    tiePriority: number;
  }> = [];

  if (trialing) {
    const patch = subscriptionEntitlementPatch(trialing, current, now);
    if (patch?.trialEndsAt && patch.trialEndsAt.getTime() > now.getTime()) {
      candidates.push({
        subscription: trialing,
        patch,
        until: patch.trialEndsAt,
        tiePriority: 3,
      });
    }
  }

  if (pastDue) {
    const patch = subscriptionEntitlementPatch(pastDue, current, now);
    if (patch?.graceUntil && patch.graceUntil.getTime() > now.getTime()) {
      candidates.push({
        subscription: pastDue,
        patch,
        until: patch.graceUntil,
        tiePriority: 2,
      });
    }
  }

  if (
    canceled &&
    canceledPaidThrough &&
    canceledPaidThrough.getTime() > now.getTime()
  ) {
    const patch = subscriptionEntitlementPatch(canceled, current, now);
    if (patch) {
      candidates.push({
        subscription: canceled,
        patch,
        until: canceledPaidThrough,
        tiePriority: 1,
      });
    }
  }

  const selectedGrant = candidates.sort(
    (a, b) => b.tiePriority - a.tiePriority,
  )[0];
  if (selectedGrant) {
    const longestUntil = new Date(
      Math.max(...candidates.map((candidate) => candidate.until.getTime())),
    );
    // Keep the existing status priority for stable UI/email semantics, but let
    // that status carry the union of every still-valid limited grant.
    if (selectedGrant.patch.planStatus === "trialing") {
      selectedGrant.patch.trialEndsAt = longestUntil;
    } else if (selectedGrant.patch.planStatus === "past_due") {
      selectedGrant.patch.graceUntil = longestUntil;
    } else {
      selectedGrant.patch.accessEndsAt = longestUntil;
      selectedGrant.patch.purgeAfter = new Date(
        longestUntil.getTime() + RETENTION_DAYS * DAY_MS,
      );
    }
    if (
      selectedGrant.patch.planStatus === "cancelled" &&
      hasManageableSubscription
    ) {
      selectedGrant.patch.purgeAfter = null;
      const manageableCurrencies = new Set(
        manageable
          .map((subscription) => stripeCurrencyCode(subscription.currency))
          .filter(
            (currency): currency is "GBP" | "USD" | "EUR" | "AUD" =>
              currency !== undefined,
          ),
      );
      if (manageableCurrencies.size === 1) {
        selectedGrant.patch.currency = [...manageableCurrencies][0];
      }
    }
    return result(selectedGrant.subscription, selectedGrant.patch);
  }

  const blockedManageable = authoritativeStripeSubscription(manageable);
  if (blockedManageable) {
    const patch = subscriptionEntitlementPatch(blockedManageable, current, now);
    if (patch) patch.purgeAfter = null;
    return result(blockedManageable, patch);
  }

  if (canceled) {
    return result(
      canceled,
      subscriptionEntitlementPatch(canceled, current, now),
    );
  }

  const terminal = byStatus("incomplete_expired");
  return result(
    terminal,
    terminal ? subscriptionEntitlementPatch(terminal, current, now) : null,
  );
}

const configuredPrice = (currency: "GBP" | "USD" | "EUR" | "AUD") => {
  switch (currency) {
    case "GBP":
      return process.env.STRIPE_PRICE_GBP;
    case "USD":
      return process.env.STRIPE_PRICE_USD;
    case "EUR":
      return process.env.STRIPE_PRICE_EUR;
    case "AUD":
      return process.env.STRIPE_PRICE_AUD;
  }
};

async function stripePost(
  path: string,
  params: Record<string, string>,
  idempotencyKey?: string,
) {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Stripe is not configured");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<
    string,
    unknown
  > & {
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe ${path} failed`);
  return data;
}

export async function createStripeCustomer(o: {
  ownerId: string;
  email: string;
}): Promise<string> {
  const customer = await stripePost(
    "customers",
    {
      email: o.email,
      "metadata[owner_id]": o.ownerId,
    },
    customerIdempotencyKey(o.ownerId),
  );
  const customerId = stripeResourceId(customer.id);
  if (customer.object !== "customer" || !customerId) {
    throw new Error("Stripe returned an invalid customer");
  }
  return customerId;
}

/** Checkout for "Add a card" (trial already running; quantity = seats later). */
export async function createCheckoutSession(o: {
  ownerId: string;
  customerId: string;
  currency?: string;
  baseUrl: string;
  trialEndsAt?: Date | null;
  attemptId?: string;
}): Promise<string> {
  const currency = stripeCurrencyCode(o.currency ?? "GBP");
  if (!currency) throw new Error("Unsupported billing currency");
  const price = configuredPrice(currency)?.trim();
  // Never silently charge the GBP price while presenting USD/EUR/AUD in the UI.
  if (!price) throw new Error(`No Stripe ${currency} price is configured`);
  const params: Record<string, string> = {
    mode: "subscription",
    client_reference_id: o.ownerId,
    "metadata[owner_id]": o.ownerId,
    "subscription_data[metadata][owner_id]": o.ownerId,
    customer: o.customerId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${o.baseUrl}/app/settings?billing=done`,
    cancel_url: `${o.baseUrl}/app/settings`,
  };
  if (o.trialEndsAt && o.trialEndsAt.getTime() > Date.now() + 60_000) {
    params["subscription_data[trial_end]"] = String(
      Math.floor(o.trialEndsAt.getTime() / 1000),
    );
  }
  const session = await stripePost(
    "checkout/sessions",
    params,
    checkoutIdempotencyKey(o.attemptId),
  );
  const sessionUrl = typeof session.url === "string" ? session.url : "";
  if (
    session.object !== "checkout.session" ||
    !/^https:\/\//.test(sessionUrl)
  ) {
    throw new Error("Stripe returned an invalid Checkout session");
  }
  return sessionUrl;
}

export async function createPortalSession(o: {
  customerId: string;
  baseUrl: string;
}): Promise<string> {
  const session = await stripePost("billing_portal/sessions", {
    customer: o.customerId,
    return_url: `${o.baseUrl}/app/settings`,
  });
  const sessionUrl = typeof session.url === "string" ? session.url : "";
  if (
    session.object !== "billing_portal.session" ||
    !/^https:\/\//.test(sessionUrl)
  ) {
    throw new Error("Stripe returned an invalid billing portal session");
  }
  return sessionUrl;
}

/**
 * Remove a Stripe customer before local account deletion. Stripe cancels that
 * customer's active subscriptions as part of deletion, preventing an account
 * that no longer exists locally from continuing to be charged.
 */
export async function deleteStripeCustomer(customerId: string): Promise<void> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error(
      "Stripe is not configured; the billing customer was not deleted",
    );
  }
  const response = await fetch(
    `https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const data = (await response.json().catch(() => ({}))) as {
    deleted?: boolean;
    error?: { code?: string; message?: string };
  };
  // A prior successful remote delete followed by a local transient failure is
  // safe to retry: Stripe then reports the customer as missing.
  if (response.status === 404 && data.error?.code === "resource_missing")
    return;
  if (!response.ok || data.deleted !== true) {
    throw new Error(data.error?.message ?? "Stripe customer deletion failed");
  }
}

/**
 * Verify a `Stripe-Signature` header (t=...,v1=...) against the raw payload.
 * Manual HMAC — same scheme the SDK uses.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  now = new Date(),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header) return false;
  const pairs = header.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = pairs.find(([key]) => key === "t")?.[1];
  const signatures = pairs
    .filter(([key]) => key === "v1")
    .map(([, value]) => value);
  if (!timestamp || !signatures.length || !/^\d+$/.test(timestamp))
    return false;
  if (
    Math.abs(now.getTime() - Number(timestamp) * 1000) >
    toleranceSeconds * 1000
  ) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${timestamp}.${payload}`);
  for (const signature of signatures) {
    if (!/^[a-f0-9]{64}$/i.test(signature)) continue;
    const bytes = Uint8Array.from(signature.match(/.{2}/g) ?? [], (value) =>
      Number.parseInt(value, 16),
    );
    if (await crypto.subtle.verify("HMAC", key, bytes, data)) return true;
  }
  return false;
}
