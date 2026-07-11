import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import * as schema from "@/db/schema";
import { getDb, type Db } from "@/db/client";
import {
  appOwnedStripeSubscriptions,
  aggregateStripeEntitlement,
  listStripeSubscriptions,
  retrieveStripeSubscription,
  stripeCancellationNoticeKey,
  stripeCurrencyCode,
  stripeOwnerReference,
  stripePaymentFailureTiming,
  stripeResourceId,
  stripeSubscriptionId,
  stripeSubscriptionAnomalies,
  stripeSubscriptionCanUsePortal,
  verifyStripeSignature,
  type StripeSubscriptionSnapshot,
} from "@/lib/billing";
import { withOwnerMutex } from "@/lib/keyed-mutex";
import { canonicalAppUrl } from "@/lib/urls";
import {
  deliverQueuedEmail,
  ownerBillingMailStateKey,
  spool,
} from "@/emails/send";
import { Cancelled, PaymentFailed, Receipt } from "@/emails/templates";

export const dynamic = "force-dynamic";

const SYSTEM_FROM = "booktimewith.com";
const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

interface StripeEvent {
  id?: string;
  created?: number;
  type: string;
  data: {
    object: {
      id?: string;
      customer?: unknown;
      subscription?: unknown;
      client_reference_id?: string;
      metadata?: { owner_id?: string };
      subscription_details?: {
        subscription?: unknown;
        metadata?: { owner_id?: string };
      };
      parent?: {
        subscription_details?: {
          subscription?: unknown;
          metadata?: { owner_id?: string };
        };
      };
      total?: number;
      amount_paid?: number;
      currency?: string;
      current_period_end?: number;
      ended_at?: number | null;
      canceled_at?: number | null;
      cancel_at?: number | null;
      trial_end?: number | null;
      items?: { data?: Array<{ current_period_end?: number }> };
      next_payment_attempt?: number | null;
      status?: string;
      invoice_pdf?: string;
      hosted_invoice_url?: string;
    };
  };
}

class LostStripeEventLeaseError extends Error {}

const money = (total: number | undefined, currency: string | undefined) => {
  const code = stripeCurrencyCode(currency);
  if (
    code === undefined ||
    typeof total !== "number" ||
    !Number.isFinite(total) ||
    total < 0
  ) {
    return null;
  }
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: code,
  }).format(total / 100);
};

/**
 * Stripe webhooks → plan state + billing emails (README: checkout.session.completed,
 * invoice.paid, invoice.payment_failed, customer.subscription.deleted/updated).
 * STRIPE_WEBHOOK_SECRET is required and every event is signature-verified —
 * an unconfigured environment refuses events rather than trusting them.
 * (For local testing, run `stripe listen --forward-to localhost:3000/api/billing/webhook`
 * and use the whsec it prints.)
 */
export async function POST(request: Request) {
  const whsec = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!whsec) {
    return NextResponse.json(
      { error: "Stripe webhooks aren't configured (STRIPE_WEBHOOK_SECRET)." },
      { status: 501 },
    );
  }
  const payload = await request.text();
  const ok = await verifyStripeSignature(
    payload,
    request.headers.get("stripe-signature"),
    whsec,
  );
  if (!ok)
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const obj = event.data?.object ?? {};
  if (!event.id || !event.created) {
    return NextResponse.json(
      { error: "Invalid Stripe event" },
      { status: 400 },
    );
  }
  const eventCreatedAt = new Date(event.created * 1000);
  const subscriptionId = stripeSubscriptionId(event.type, obj);
  const eventCustomerId = stripeResourceId(obj.customer);
  let referencedOwnerId = stripeOwnerReference(obj);

  const db = await getDb();
  let owner = eventCustomerId
    ? await db.query.owners.findFirst({
        where: eq(schema.owners.stripeCustomerId, eventCustomerId),
      })
    : undefined;
  if (!owner && referencedOwnerId) {
    owner = await db.query.owners.findFirst({
      where: eq(schema.owners.id, referencedOwnerId),
    });
  }
  // Invoice events can beat Checkout completion, before the customer id is
  // locally bound. Resolve the owner from the subscription metadata we set at
  // Checkout, then refetch under the owner lock before applying any state.
  if (
    !owner &&
    !referencedOwnerId &&
    subscriptionId &&
    HANDLED_EVENTS.has(event.type)
  ) {
    const resolutionSubscription =
      await retrieveStripeSubscription(subscriptionId);
    const resolvedCustomerId = stripeResourceId(
      resolutionSubscription?.customer,
    );
    const resolvedOwnerId = resolutionSubscription
      ? stripeOwnerReference(resolutionSubscription)
      : undefined;
    if (
      (eventCustomerId &&
        resolvedCustomerId &&
        eventCustomerId !== resolvedCustomerId) ||
      !resolvedOwnerId
    ) {
      return NextResponse.json({
        received: true,
        ignored: true,
        reason: "owner_mismatch",
      });
    }
    referencedOwnerId = resolvedOwnerId;
    owner = await db.query.owners.findFirst({
      where: eq(schema.owners.id, resolvedOwnerId),
    });
  }
  if (
    owner &&
    ((referencedOwnerId && referencedOwnerId !== owner.id) ||
      (eventCustomerId &&
        owner.stripeCustomerId &&
        eventCustomerId !== owner.stripeCustomerId))
  ) {
    return NextResponse.json({
      received: true,
      ignored: true,
      reason: "owner_mismatch",
    });
  }
  // A valid Stripe event for another product/account is acknowledged but must
  // never mutate whichever owner happens to be first in this database.
  if (!owner) return NextResponse.json({ received: true, ignored: true });

  const ownerId = owner.id;
  const reserveAt = new Date();
  const [reserved] = await db
    .insert(schema.stripeEvents)
    .values({
      eventId: event.id,
      ownerId,
      type: event.type,
      eventCreatedAt,
      receivedAt: reserveAt,
    })
    .onConflictDoNothing()
    .returning();
  let leaseAt: Date;
  if (reserved) {
    leaseAt = reserved.receivedAt;
  } else {
    const existing = await db.query.stripeEvents.findFirst({
      where: eq(schema.stripeEvents.eventId, event.id),
    });
    if (
      !existing ||
      existing.status === "processed" ||
      existing.status === "ignored"
    ) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    const staleClaim = new Date(Date.now() - 5 * 60_000);
    const reclaimAt = new Date();
    const [reclaimed] = await db
      .update(schema.stripeEvents)
      .set({ status: "processing", receivedAt: reclaimAt, lastError: null })
      .where(
        existing.status === "failed"
          ? and(
              eq(schema.stripeEvents.eventId, event.id),
              eq(schema.stripeEvents.status, "failed"),
            )
          : and(
              eq(schema.stripeEvents.eventId, event.id),
              eq(schema.stripeEvents.status, "processing"),
              lt(schema.stripeEvents.receivedAt, staleClaim),
            ),
      )
      .returning();
    if (!reclaimed) {
      // A 2xx tells Stripe the event is finished. Keep the delivery retryable
      // while another worker owns a fresh claim.
      return NextResponse.json(
        { received: false, processing: true },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }
    leaseAt = reclaimed.receivedAt;
  }

  type ProcessingResult =
    | { kind: "response"; response: NextResponse }
    | {
        kind: "outcome";
        outcome: { ignored?: boolean; queuedIds: string[] };
      };
  const lostClaimResponse = async () => {
    const current = await db.query.stripeEvents.findFirst({
      where: eq(schema.stripeEvents.eventId, event.id!),
    });
    return !current ||
      current.status === "processed" ||
      current.status === "ignored"
      ? NextResponse.json({ received: true, duplicate: true })
      : NextResponse.json(
          { received: false, processing: true },
          { status: 503, headers: { "Retry-After": "30" } },
        );
  };
  let processing: ProcessingResult;
  try {
    processing = await withOwnerMutex(ownerId, async () => {
      const refreshedAt = new Date();
      const [refreshed] = await db
        .update(schema.stripeEvents)
        .set({ receivedAt: refreshedAt })
        .where(
          and(
            eq(schema.stripeEvents.eventId, event.id!),
            eq(schema.stripeEvents.status, "processing"),
            eq(schema.stripeEvents.receivedAt, leaseAt),
          ),
        )
        .returning({ receivedAt: schema.stripeEvents.receivedAt });
      if (!refreshed) {
        return { kind: "response", response: await lostClaimResponse() };
      }
      leaseAt = refreshed.receivedAt;

      const ignoreClaim = async () => {
        const [ignored] = await db
          .update(schema.stripeEvents)
          .set({ status: "ignored", processedAt: new Date(), lastError: null })
          .where(
            and(
              eq(schema.stripeEvents.eventId, event.id!),
              eq(schema.stripeEvents.status, "processing"),
              eq(schema.stripeEvents.receivedAt, leaseAt),
            ),
          )
          .returning({ eventId: schema.stripeEvents.eventId });
        if (!ignored) {
          return {
            kind: "response" as const,
            response: await lostClaimResponse(),
          };
        }
        return {
          kind: "outcome" as const,
          outcome: { ignored: true as const, queuedIds: [] as string[] },
        };
      };
      const reconciliationOwner = await db.query.owners.findFirst({
        where: eq(schema.owners.id, ownerId),
      });
      if (!reconciliationOwner) return ignoreClaim();
      if (!HANDLED_EVENTS.has(event.type)) return ignoreClaim();
      if (event.type.startsWith("invoice.") && !subscriptionId) {
        return ignoreClaim();
      }
      if (
        (referencedOwnerId && referencedOwnerId !== reconciliationOwner.id) ||
        (eventCustomerId &&
          reconciliationOwner.stripeCustomerId &&
          eventCustomerId !== reconciliationOwner.stripeCustomerId)
      ) {
        return ignoreClaim();
      }

      let eventSubscription: StripeSubscriptionSnapshot | undefined;
      if (subscriptionId) {
        const current = await retrieveStripeSubscription(subscriptionId);
        // Stripe may no longer expose a deleted resource. In that one case the
        // signed deletion-era period data is the best available terminal state.
        if (!current && event.type !== "customer.subscription.deleted") {
          throw new Error(
            "Stripe subscription was not available for reconciliation",
          );
        }
        eventSubscription =
          current ??
          ({
            object: "subscription",
            id: subscriptionId,
            customer: eventCustomerId,
            metadata: obj.metadata,
            status: "canceled",
            currency: obj.currency,
            current_period_end: obj.current_period_end,
            ended_at: obj.ended_at,
            canceled_at: obj.canceled_at,
            cancel_at: obj.cancel_at,
            trial_end: obj.trial_end,
            items: obj.items,
          } satisfies StripeSubscriptionSnapshot);
      }

      const eventSubscriptionCustomerId = stripeResourceId(
        eventSubscription?.customer,
      );
      const eventSubscriptionOwnerId = eventSubscription
        ? stripeOwnerReference(eventSubscription)
        : undefined;
      if (
        (subscriptionId &&
          eventSubscriptionOwnerId !== reconciliationOwner.id) ||
        (eventSubscriptionCustomerId &&
          eventCustomerId &&
          eventSubscriptionCustomerId !== eventCustomerId) ||
        ((eventSubscriptionCustomerId ?? eventCustomerId) &&
          reconciliationOwner.stripeCustomerId &&
          (eventSubscriptionCustomerId ?? eventCustomerId) !==
            reconciliationOwner.stripeCustomerId)
      ) {
        return ignoreClaim();
      }

      const verifiedCustomerId =
        eventSubscriptionCustomerId ??
        eventCustomerId ??
        reconciliationOwner.stripeCustomerId ??
        undefined;
      const subscriptions = verifiedCustomerId
        ? appOwnedStripeSubscriptions(
            await listStripeSubscriptions(verifiedCustomerId),
            reconciliationOwner.id,
          )
        : [];
      // A just-created subscription can briefly precede list visibility. Fold
      // its individually retrieved snapshot into reconciliation; for a deleted
      // resource this is the signed terminal fallback built above.
      if (
        eventSubscription &&
        stripeOwnerReference(eventSubscription) === reconciliationOwner.id &&
        !subscriptions.some(
          (candidate) =>
            stripeResourceId(candidate.id) ===
            stripeResourceId(eventSubscription?.id),
        )
      ) {
        subscriptions.push(eventSubscription);
      }
      const now = new Date();

      // Provider reads above are serialized per process/owner but deliberately
      // outside PostgreSQL. Only the state/outbox commit below holds a pooled
      // connection and row lock.
      const outcome = await db.transaction(async (tx) => {
        const scoped = tx as unknown as Db;
        const ignoreEvent = async () => {
          const [ignored] = await tx
            .update(schema.stripeEvents)
            .set({
              status: "ignored",
              processedAt: new Date(),
              lastError: null,
            })
            .where(
              and(
                eq(schema.stripeEvents.eventId, event.id!),
                eq(schema.stripeEvents.status, "processing"),
                eq(schema.stripeEvents.receivedAt, leaseAt),
              ),
            )
            .returning({ eventId: schema.stripeEvents.eventId });
          if (!ignored) throw new LostStripeEventLeaseError();
          return { ignored: true as const, queuedIds: [] as string[] };
        };
        const claimedEvent = await tx.query.stripeEvents.findFirst({
          where: eq(schema.stripeEvents.eventId, event.id!),
        });
        if (
          !claimedEvent ||
          claimedEvent.status !== "processing" ||
          claimedEvent.receivedAt.getTime() !== leaseAt.getTime()
        ) {
          throw new LostStripeEventLeaseError();
        }
        const lockedOwner = await tx.query.owners.findFirst({
          where: eq(schema.owners.id, ownerId),
        });
        if (!lockedOwner) return ignoreEvent();
        if (
          (referencedOwnerId && referencedOwnerId !== lockedOwner.id) ||
          (eventCustomerId &&
            lockedOwner.stripeCustomerId &&
            eventCustomerId !== lockedOwner.stripeCustomerId) ||
          (subscriptionId && eventSubscriptionOwnerId !== lockedOwner.id) ||
          ((eventSubscriptionCustomerId ?? eventCustomerId) &&
            lockedOwner.stripeCustomerId &&
            (eventSubscriptionCustomerId ?? eventCustomerId) !==
              lockedOwner.stripeCustomerId)
        ) {
          return ignoreEvent();
        }

        const tz = lockedOwner.timezone;
        const queuedIds: string[] = [];
        const remember = (id: string | false) => {
          if (id) queuedIds.push(id);
        };
        const setOwner = (patch: Partial<typeof schema.owners.$inferInsert>) =>
          tx
            .update(schema.owners)
            .set(patch)
            .where(eq(schema.owners.id, lockedOwner.id));

        const aggregate = aggregateStripeEntitlement(
          subscriptions,
          { graceUntil: lockedOwner.graceUntil },
          now,
        );
        const authoritative = aggregate.subscription;
        const authoritativeId = stripeResourceId(authoritative?.id);
        const authoritativeOwnerId = authoritative
          ? stripeOwnerReference(authoritative)
          : undefined;
        const authoritativeCustomerId = stripeResourceId(
          authoritative?.customer,
        );
        if (
          (authoritativeOwnerId && authoritativeOwnerId !== lockedOwner.id) ||
          (authoritativeCustomerId &&
            verifiedCustomerId &&
            authoritativeCustomerId !== verifiedCustomerId)
        ) {
          return ignoreEvent();
        }

        const entitlementPatch = aggregate.patch;
        const anomalies = stripeSubscriptionAnomalies(subscriptions);
        if (anomalies.multipleManageable) {
          console.error("Multiple manageable Stripe subscriptions", {
            ownerId: lockedOwner.id,
            subscriptionIds: subscriptions
              .filter(stripeSubscriptionCanUsePortal)
              .map((candidate) => stripeResourceId(candidate.id)),
          });
        }
        if (anomalies.conflictingCurrencies && entitlementPatch) {
          delete entitlementPatch.currency;
        }
        const ownerPatch: Partial<typeof schema.owners.$inferInsert> = {
          ...(entitlementPatch ?? {}),
          stripeSubscriptionId: authoritativeId ?? null,
          stripeHasManageableSubscription: aggregate.hasManageableSubscription,
          ...(aggregate.hasManageableSubscription
            ? {
                stripeCheckoutAttemptId: null,
                stripeCheckoutAttemptAt: null,
              }
            : {}),
          ...(!lockedOwner.stripeCustomerId && verifiedCustomerId
            ? { stripeCustomerId: verifiedCustomerId }
            : {}),
        };
        const postReconciliationOwner = { ...lockedOwner, ...ownerPatch };
        const ownerStateKey = ownerBillingMailStateKey(postReconciliationOwner);
        if (Object.keys(ownerPatch).length > 0) await setOwner(ownerPatch);

        switch (event.type) {
          case "checkout.session.completed":
            break;

          case "invoice.paid": {
            const amount = money(obj.amount_paid ?? obj.total, obj.currency);
            if (!amount) {
              console.error(
                "Stripe invoice.paid omitted a valid amount/currency",
                event.id,
              );
              break;
            }
            remember(
              await spool(
                scoped,
                {
                  to: lockedOwner.email,
                  from: SYSTEM_FROM,
                  subject: `Receipt — ${amount}, ${formatInTimeZone(eventCreatedAt, tz, "MMMM")}`,
                  template: "receipt",
                  ownerId: lockedOwner.id,
                  ownerRecipientVersion: lockedOwner.sessionVersion,
                  dedupeKey: `receipt:${event.id}`,
                  element: Receipt({
                    period: formatInTimeZone(eventCreatedAt, tz, "MMMM yyyy"),
                    amount,
                    cardLine: `Charged ${formatInTimeZone(eventCreatedAt, tz, "MMMM d")}`,
                    handle: lockedOwner.handle,
                    invoiceUrl:
                      obj.invoice_pdf ??
                      obj.hosted_invoice_url ??
                      `${canonicalAppUrl()}/app/settings`,
                  }),
                },
                { deferDelivery: true },
              ),
            );
            break;
          }

          case "invoice.payment_failed": {
            if (
              entitlementPatch?.planStatus !== "past_due" ||
              eventSubscription?.status !== "past_due"
            ) {
              break;
            }
            const graceUntil = entitlementPatch.graceUntil;
            if (!graceUntil) break;
            const timing = stripePaymentFailureTiming(
              graceUntil,
              obj.next_payment_attempt,
              now,
            );
            const graceDate = formatInTimeZone(graceUntil, tz, "MMMM d");
            const retryDate = timing.retryAt
              ? formatInTimeZone(timing.retryAt, tz, "MMMM d")
              : null;
            const pageStatus = timing.graceExpired
              ? "Your booking page is paused while billing is overdue. Nothing has been deleted; update your payment details to bring it back."
              : `Your booking page keeps working until ${graceDate} while we retry, so clients can still book.`;
            const retry = timing.graceExpired
              ? retryDate
                ? `Your page is paused while billing is overdue. We'll retry on ${retryDate} — nothing is deleted.`
                : "Your page is paused while billing is overdue — nothing is deleted. Update your payment details in billing to bring it back."
              : retryDate && timing.retryBeforeGrace
                ? `We'll retry on ${retryDate}. If it still fails, your page pauses on ${graceDate} — nothing is deleted.`
                : retryDate
                  ? `Your page works until ${graceDate}, then pauses if payment hasn't recovered. We'll retry on ${retryDate} — nothing is deleted.`
                  : `If it keeps failing, your page pauses on ${graceDate} — nothing is deleted.`;
            remember(
              await spool(
                scoped,
                {
                  to: lockedOwner.email,
                  from: SYSTEM_FROM,
                  subject: timing.graceExpired
                    ? "Your page is paused — update your billing"
                    : "Your card didn't go through — no rush",
                  template: "payment-failed",
                  ownerId: lockedOwner.id,
                  ownerRecipientVersion: lockedOwner.sessionVersion,
                  ownerStateKey,
                  dedupeKey: `payment-failed:${event.id}`,
                  element: PaymentFailed({
                    pageStatus,
                    retryLine: retry,
                    handle: lockedOwner.handle,
                  }),
                },
                { deferDelivery: true },
              ),
            );
            break;
          }

          case "customer.subscription.updated":
            break;

          case "customer.subscription.deleted": {
            // A delayed delete for old subscription A must not tell the owner
            // their account is cancelled when active subscription B now wins.
            if (
              entitlementPatch?.planStatus !== "cancelled" ||
              aggregate.hasManageableSubscription
            ) {
              break;
            }
            const paidThrough = entitlementPatch.accessEndsAt
              ? entitlementPatch.accessEndsAt
              : obj.current_period_end
                ? new Date(obj.current_period_end * 1000)
                : now;
            remember(
              await spool(
                scoped,
                {
                  to: lockedOwner.email,
                  from: SYSTEM_FROM,
                  subject: `Cancelled — your page runs until ${formatInTimeZone(paidThrough, tz, "MMMM d")}`,
                  template: "cancelled",
                  ownerId: lockedOwner.id,
                  ownerRecipientVersion: lockedOwner.sessionVersion,
                  ownerStateKey,
                  dedupeKey: stripeCancellationNoticeKey(
                    lockedOwner.id,
                    authoritativeId,
                    paidThrough,
                  ),
                  element: Cancelled({
                    paidThrough: formatInTimeZone(paidThrough, tz, "MMMM d"),
                    handle: lockedOwner.handle,
                  }),
                },
                { deferDelivery: true },
              ),
            );
            break;
          }

          default:
            return ignoreEvent();
        }

        const [processed] = await tx
          .update(schema.stripeEvents)
          .set({
            status: "processed",
            processedAt: new Date(),
            lastError: null,
          })
          .where(
            and(
              eq(schema.stripeEvents.eventId, event.id!),
              eq(schema.stripeEvents.status, "processing"),
              eq(schema.stripeEvents.receivedAt, leaseAt),
            ),
          )
          .returning({ eventId: schema.stripeEvents.eventId });
        if (!processed) throw new LostStripeEventLeaseError();
        return { queuedIds };
      });
      return { kind: "outcome", outcome };
    });
  } catch (error) {
    if (error instanceof LostStripeEventLeaseError) {
      return lostClaimResponse();
    }
    await db
      .update(schema.stripeEvents)
      .set({
        status: "failed",
        lastError:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Webhook failed",
      })
      .where(
        and(
          eq(schema.stripeEvents.eventId, event.id),
          eq(schema.stripeEvents.status, "processing"),
          eq(schema.stripeEvents.receivedAt, leaseAt),
        ),
      );
    throw error;
  }

  if (processing.kind === "response") return processing.response;
  const outcome = processing.outcome;

  // The transaction durably queues billing mail. Delivery happens only after
  // commit; provider reconciliation above never held that transaction open.
  for (const id of outcome.queuedIds) await deliverQueuedEmail(db, id);

  return NextResponse.json({
    received: true,
    ...(outcome.ignored ? { ignored: true } : {}),
  });
}
