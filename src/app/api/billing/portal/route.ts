import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/db/client";
import * as schema from "@/db/schema";
import { sessionOwner } from "@/lib/authz";
import {
  appOwnedStripeSubscriptions,
  aggregateStripeEntitlement,
  createCheckoutSession,
  stripeBillingPortalUrl,
  createStripeCustomer,
  deleteStripeCustomer,
  listOpenStripeCheckoutSessions,
  listStripeSubscriptions,
  openStripeCheckoutUrl,
  stripeConfigured,
  stripeOwnerReference,
  stripeResourceId,
  stripeSubscriptionAnomalies,
  stripeSubscriptionCanUsePortal,
} from "@/lib/billing";
import { canonicalAppUrl } from "@/lib/urls";
import { withOwnerMutex } from "@/lib/keyed-mutex";

export const dynamic = "force-dynamic";

const CHECKOUT_ATTEMPT_MS = 24 * 60 * 60_000;

/**
 * Bind the remote customer before any Checkout session can exist. Creation is
 * idempotent per owner. The caller holds the owner mutex across the provider
 * operation so account deletion and webhooks cannot race the binding.
 */
async function ensureStripeCustomerLocked(
  db: Db,
  owner: typeof schema.owners.$inferSelect,
): Promise<string> {
  const current = await db.query.owners.findFirst({
    where: eq(schema.owners.id, owner.id),
  });
  if (!current || current.sessionVersion !== owner.sessionVersion) {
    throw new Error("OWNER_GONE");
  }
  if (current.stripeCustomerId) return current.stripeCustomerId;

  const candidateId = await createStripeCustomer({
    ownerId: current.id,
    email: current.email,
  });
  try {
    const [bound] = await db
      .update(schema.owners)
      .set({ stripeCustomerId: candidateId })
      .where(eq(schema.owners.id, current.id))
      .returning({ id: schema.owners.id });
    if (!bound) throw new Error("OWNER_GONE");
  } catch (error) {
    // If deletion won the row race, do not leave a billable remote identity
    // whose local account no longer exists.
    await deleteStripeCustomer(candidateId).catch((cleanupError) => {
      console.error("Unbound Stripe customer cleanup failed", cleanupError);
    });
    throw error;
  }
  return candidateId;
}

type BillingDecision =
  | { kind: "portal"; customerId: string }
  | { kind: "checkout_url"; url: string }
  | {
      kind: "checkout";
      customerId: string;
      ownerId: string;
      currency: string;
      trialEndsAt: Date | null;
      attemptId: string;
    };

async function billingDecisionLocked(
  db: Db,
  ownerId: string,
  customerId: string,
): Promise<BillingDecision> {
  const lockedOwner = await db.query.owners.findFirst({
    where: eq(schema.owners.id, ownerId),
  });
  if (!lockedOwner || lockedOwner.stripeCustomerId !== customerId) {
    throw new Error("OWNER_GONE");
  }

  const subscriptions = appOwnedStripeSubscriptions(
    await listStripeSubscriptions(customerId),
    lockedOwner.id,
  );
  const now = new Date();
  const aggregate = aggregateStripeEntitlement(
    subscriptions,
    { graceUntil: lockedOwner.graceUntil },
    now,
  );
  const current = aggregate.subscription;
  const currentOwnerId = current ? stripeOwnerReference(current) : undefined;
  if (currentOwnerId && currentOwnerId !== lockedOwner.id) {
    throw new Error("Stripe subscription owner mismatch");
  }

  const currentId = stripeResourceId(current?.id);
  const entitlementPatch = aggregate.patch;
  const anomalies = stripeSubscriptionAnomalies(subscriptions);
  if (anomalies.multipleManageable) {
    console.error("Multiple manageable Stripe subscriptions", {
      ownerId: lockedOwner.id,
      subscriptionIds: subscriptions
        .filter(stripeSubscriptionCanUsePortal)
        .map((subscription) => stripeResourceId(subscription.id)),
    });
  }
  if (anomalies.conflictingCurrencies && entitlementPatch) {
    // Never relabel the account based on an arbitrary winner while duplicate
    // live subscriptions disagree. Keep the last coherent local currency.
    delete entitlementPatch.currency;
  }
  if (
    entitlementPatch?.planStatus === "cancelled" &&
    !aggregate.hasManageableSubscription
  ) {
    // A fully ended owner may deliberately choose a new currency before
    // restarting. Reconciliation of the historical plan must not undo it.
    delete entitlementPatch.currency;
  }
  const effectivePlanStatus =
    entitlementPatch?.planStatus ?? lockedOwner.planStatus;
  const effectivePurgeAfter = entitlementPatch
    ? entitlementPatch.purgeAfter
    : lockedOwner.purgeAfter;
  await db
    .update(schema.owners)
    .set({
        ...(entitlementPatch ?? {}),
        stripeSubscriptionId: currentId ?? null,
        stripeHasManageableSubscription:
          aggregate.hasManageableSubscription,
        ...(aggregate.hasManageableSubscription
          ? {
              stripeCheckoutAttemptId: null,
              stripeCheckoutAttemptAt: null,
            }
          : {}),
    })
    .where(eq(schema.owners.id, lockedOwner.id));

  if (aggregate.hasManageableSubscription) {
    return { kind: "portal", customerId };
  }

  const openSessions = await listOpenStripeCheckoutSessions(
    customerId,
    lockedOwner.id,
  );
  const existingCheckoutUrl = openStripeCheckoutUrl(openSessions, now);
  if (existingCheckoutUrl) {
    const session = openSessions.find(
      (candidate) => candidate.url === existingCheckoutUrl,
    );
    const protectedUntil = session?.expires_at
      ? new Date(session.expires_at * 1000 + 60 * 60_000)
      : null;
    await db
      .update(schema.owners)
      .set({
        stripeCheckoutAttemptId: `open:${stripeResourceId(session?.id) ?? crypto.randomUUID()}`,
        stripeCheckoutAttemptAt: now,
        ...(effectivePlanStatus === "cancelled" &&
        protectedUntil &&
        (!effectivePurgeAfter || effectivePurgeAfter < protectedUntil)
          ? { purgeAfter: protectedUntil }
          : {}),
      })
      .where(eq(schema.owners.id, lockedOwner.id));
    return { kind: "checkout_url", url: existingCheckoutUrl };
  }

  const attemptIsFresh =
    lockedOwner.stripeCheckoutAttemptId &&
    lockedOwner.stripeCheckoutAttemptAt &&
    lockedOwner.stripeCheckoutAttemptAt.getTime() >
      now.getTime() - CHECKOUT_ATTEMPT_MS;
  const attemptId = attemptIsFresh
    ? lockedOwner.stripeCheckoutAttemptId!
    : crypto.randomUUID();
  if (!attemptIsFresh) {
    await db
      .update(schema.owners)
      .set({
        stripeCheckoutAttemptId: attemptId,
        stripeCheckoutAttemptAt: now,
      })
      .where(eq(schema.owners.id, lockedOwner.id));
  }
  return {
    kind: "checkout",
    customerId,
    ownerId: lockedOwner.id,
    currency: lockedOwner.currency,
    // Only the original card-less trial can be carried into Checkout. A
    // cancelled subscription starting again does not receive a second trial.
    trialEndsAt:
      effectivePlanStatus === "trialing" ? lockedOwner.trialEndsAt : null,
    attemptId,
  };
}

/**
 * Manage an existing live subscription in Portal. A card-less trial, fully
 * cancelled subscription, or expired/incomplete subscription starts a fresh
 * Checkout against the already-bound customer instead.
 */
export async function POST(request: Request) {
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe isn't connected in this environment." },
      { status: 501 },
    );
  }
  const db = await getDb();
  const owner = await sessionOwner(db);
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const baseUrl = canonicalAppUrl(request.url);
    const url = await withOwnerMutex(owner.id, async () => {
      const customerId = await ensureStripeCustomerLocked(db, owner);
      const decision = await billingDecisionLocked(db, owner.id, customerId);
      return decision.kind === "checkout_url"
        ? decision.url
        : decision.kind === "portal"
          ? stripeBillingPortalUrl()
          : createCheckoutSession({
              ownerId: decision.ownerId,
              customerId: decision.customerId,
              currency: decision.currency,
              trialEndsAt: decision.trialEndsAt,
              attemptId: decision.attemptId,
              baseUrl,
            });
    });
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof Error && error.message === "OWNER_GONE") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    console.error("Billing handoff failed", error);
    return NextResponse.json(
      { error: "Billing could not be opened. Try again shortly." },
      { status: 502 },
    );
  }
}
