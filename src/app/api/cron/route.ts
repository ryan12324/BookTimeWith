import { NextResponse } from "next/server";
import {
  and,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
} from "drizzle-orm";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import * as schema from "@/db/schema";
import { getDb, type Db } from "@/db/client";
import { mintManageToken } from "@/db/repo";
import {
  bookingMailStateKey,
  cleanupEmailOutbox,
  ownerBillingMailStateKey,
  ownerMorningSummaryStateKey,
  retryEmailOutbox,
  spool,
} from "@/emails/send";
import { ClientReminder, OwnerMorningSummary, TrialEnding } from "@/emails/templates";
import { retryCalendarSync } from "@/lib/booking-calendar";
import {
  appOwnedStripeSubscriptions,
  aggregateStripeEntitlement,
  deleteStripeCustomer,
  listOpenStripeCheckoutSessions,
  listStripeSubscriptions,
  stripeOwnerReference,
  stripeResourceId,
  stripeSubscriptionAnomalies,
  stripeSubscriptionCanUsePortal,
  StripeResourceMissingError,
} from "@/lib/billing";
import { canonicalBookingUrl } from "@/lib/urls";
import { withOwnerMutex } from "@/lib/keyed-mutex";
import { PRICES, type CurrencyCode } from "@/lib/format";
import { anonymizeExpiredClientPii } from "@/lib/data-retention";
import {
  OWNER_REMINDER_BATCH_SIZE,
  OWNER_SUMMARY_BATCH_SIZE,
  ownerLocalDayRange,
  runScheduledOwnerBatch,
} from "@/lib/scheduled-work";

export const dynamic = "force-dynamic";

/**
 * The scheduled jobs (README "Cron"): client reminders at T-24h, owner morning
 * summary at 7am owner-local, trial-ending at T-7d, grace expiry → paused, and
 * the 90-day hard delete. Run this every five minutes so a transient sign-in
 * email failure retries before its 15-minute link expires; slower jobs are
 * time-gated and every send dedupes. `?force=summary` skips the 7am gate.
 */
export async function GET(request: Request) {
  // In production the secret is mandatory — an unset secret must not mean
  // "no auth" (that would let anyone drive emails and billing/retention state).
  // Locally it stays optional so `curl` testing works.
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (
    process.env.NODE_ENV === "production" &&
    (!cronSecret || cronSecret.length < 32)
  ) {
    return NextResponse.json(
      { error: "service configuration error" },
      { status: 503 },
    );
  }
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const db = await getDb();
  const url = new URL(request.url);
  const force = url.searchParams.get("force");
  const bookingBaseUrl = canonicalBookingUrl(request.url);
  const now = new Date();
  const sent: string[] = [];

  // Calendar intent comes first so crash-recovered confirmations do not wait
  // behind a large general-mail retry batch for their final meeting link.
  const calendarRetry = await retryCalendarSync(db);
  if (calendarRetry.attempted) {
    sent.push(`calendar-retry:${calendarRetry.synced}/${calendarRetry.attempted}`);
  }
  const mailRetry = await retryEmailOutbox(db, now);
  if (mailRetry.attempted) {
    sent.push(`email-retry:${mailRetry.delivered}/${mailRetry.attempted}`);
  }

  const ownerBatch = await runScheduledOwnerBatch(
    db,
    now,
    (owner) => runOwnerJobs(db, owner, now, force, bookingBaseUrl, sent),
    (owner, error, phase) => {
      console.error(`Scheduled owner ${phase} failed`, {
        ownerId: owner.id,
        error,
      });
      sent.push(`owner-${phase}-failed:${owner.handle}`);
    },
  );
  if (ownerBatch.processed) {
    sent.push(`owners-checked:${ownerBatch.processed}`);
  }

  try {
    const retention = await anonymizeExpiredClientPii(db, now);
    if (retention.anonymized) {
      sent.push(`client-pii-anonymized:${retention.anonymized}`);
    }
  } catch (error) {
    console.error("Scheduled client PII anonymization failed", error);
    sent.push("client-pii-anonymization-failed");
  }

  /* 5 · 90-day retention over → hard delete (cascades) */
  const purgeable = await db.query.owners.findMany({
    where: and(isNotNull(schema.owners.purgeAfter), lte(schema.owners.purgeAfter, now)),
    orderBy: (owner, { asc }) => [asc(owner.purgeAfter)],
    limit: 2,
  });
  for (const o of purgeable) {
    const result = await purgeOwner(db, o.id, now);
    if (result === "purged") sent.push(`purged:${o.handle}`);
    if (result === "failed") sent.push(`purge-failed:${o.handle}`);
  }

  const outboxRemoved = await cleanupEmailOutbox(db, now);
  if (outboxRemoved) sent.push(`outbox-cleaned:${outboxRemoved}`);
  const maintenanceCutoff = new Date(now.getTime() - 2 * 86_400_000);
  const stripeEventCutoff = new Date(now.getTime() - 90 * 86_400_000);
  const [rateLimitsRemoved, tokensRemoved, redirectsRemoved, stripeEventsRemoved] =
    await Promise.all([
    db
      .delete(schema.rateLimits)
      .where(lt(schema.rateLimits.updatedAt, maintenanceCutoff))
      .returning({ key: schema.rateLimits.key }),
    db
      .delete(schema.authTokens)
      .where(lt(schema.authTokens.expiresAt, now))
      .returning({ id: schema.authTokens.id }),
    db
      .delete(schema.handleRedirects)
      .where(lt(schema.handleRedirects.expiresAt, now))
      .returning({ id: schema.handleRedirects.id }),
    db
      .delete(schema.stripeEvents)
      .where(lt(schema.stripeEvents.receivedAt, stripeEventCutoff))
      .returning({ id: schema.stripeEvents.eventId }),
  ]);
  const maintenanceRemoved =
    rateLimitsRemoved.length +
    tokensRemoved.length +
    redirectsRemoved.length +
    stripeEventsRemoved.length;
  if (maintenanceRemoved) sent.push(`maintenance-cleaned:${maintenanceRemoved}`);

  return NextResponse.json({ ran: new Date().toISOString(), sent });
}

type Owner = typeof schema.owners.$inferSelect;

async function runOwnerJobs(
  db: Db,
  owner: Owner,
  now: Date,
  force: string | null,
  bookingBaseUrl: string,
  sent: string[],
) {
  const tz = owner.timezone;
  const ownerFrom = `${owner.name.split(",")[0]} via booktimewith.com`;

  // The usual send lands around T-24h. A booking created inside that window is
  // picked up by the next scheduled run instead of missing its reminder.
  const from = now;
  const to = new Date(now.getTime() + 25 * 3_600_000);
  const upcoming = await db.query.bookings.findMany({
    where: and(
      eq(schema.bookings.ownerId, owner.id),
      eq(schema.bookings.status, "confirmed"),
      gte(schema.bookings.startsAt, from),
      lt(schema.bookings.startsAt, to),
    ),
    orderBy: (booking, { asc }) => [
      asc(booking.startsAt),
      asc(booking.id),
    ],
    limit: OWNER_REMINDER_BATCH_SIZE,
  });
  for (const booking of upcoming) {
    const dedupeKey = `reminder:${booking.id}:${booking.startsAt.toISOString()}`;
    const alreadyQueued = await db.query.emailOutbox.findFirst({
      where: eq(schema.emailOutbox.dedupeKey, dedupeKey),
    });
    if (alreadyQueued && alreadyQueued.delivery !== "expired") continue;
    const clientTz = booking.clientTimezone ?? owner.timezone;
    const changesAllowed =
      booking.startsAt.getTime() - now.getTime() >= 24 * 3_600_000;
    const timeLabel = formatInTimeZone(booking.startsAt, clientTz, "h:mm a");
    const dayLabel = formatInTimeZone(
      booking.startsAt,
      clientTz,
      "EEEE, MMMM d",
    );
    const manageToken = await mintManageToken(db, booking.id);
    const ok = await spool(db, {
      to: booking.clientEmail,
      from: ownerFrom,
      replyTo: owner.email,
      subject: `Reminder — ${booking.serviceNameSnapshot} on ${dayLabel} at ${timeLabel}`,
      template: "client-reminder",
      ownerId: owner.id,
      ownerRecipientVersion: owner.sessionVersion,
      bookingId: booking.id,
      bookingStateKey: bookingMailStateKey(booking),
      dedupeKey,
      element: ClientReminder({
        timingLabel: `on ${dayLabel} at ${timeLabel}`,
        changesAllowed,
        changeLine:
          changesAllowed
            ? "Changes are available until 24 hours before."
            : "Changes are now locked; reply to your confirmation email if needed.",
        cardTitle: `${booking.serviceNameSnapshot} with ${owner.name.split(",")[0]}`,
        whenBold: dayLabel,
        whenTimes: `${timeLabel} – ${formatInTimeZone(booking.endsAt, clientTz, "h:mm a")} ${formatInTimeZone(booking.startsAt, clientTz, "zzz")}`,
        joinUrl: booking.meetingLink,
        manageUrl: `${bookingBaseUrl}/manage/${manageToken}`,
        handle: owner.handle,
      }),
    }, { deferDelivery: true });
    if (ok) sent.push(`reminder:${owner.handle}:${booking.id}`);
  }

  const localHour = toZonedTime(now, tz).getHours();
  if (
    owner.emailVerifiedAt &&
    owner.notifyMorningSummary &&
    (localHour === 7 || force === "summary")
  ) {
    const dayKey = formatInTimeZone(now, tz, "yyyy-MM-dd");
    const todays = await todaysBookings(db, owner.id, tz, now);
    if (todays.length) {
      const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
      const count = todays.length < 10 ? words[todays.length] : String(todays.length);
      const ok = await spool(db, {
        to: owner.email,
        from: "booktimewith.com",
        subject: `Today: ${todays.length} session${todays.length === 1 ? "" : "s"}, first at ${fmtLocal(todays[0].startsAt, tz)}`,
        template: "owner-morning-summary",
        ownerId: owner.id,
        ownerRecipientVersion: owner.sessionVersion,
        ownerStateKey: ownerMorningSummaryStateKey(owner, dayKey, todays),
        dedupeKey: `summary:${owner.id}:${dayKey}`,
        element: OwnerMorningSummary({
          headline: `${formatInTimeZone(now, tz, "EEEE")}: ${count} session${todays.length === 1 ? "" : "s"}.`,
          rows: todays.map((booking) => ({
            time: fmtLocal(booking.startsAt, tz),
            name: booking.clientName,
            serviceName: booking.serviceNameSnapshot,
          })),
          handle: owner.handle,
        }),
      }, { deferDelivery: true });
      if (ok) sent.push(`morning-summary:${owner.handle}`);
    }
  }

  if (
    owner.emailVerifiedAt &&
    owner.planStatus === "trialing" &&
    owner.trialEndsAt &&
    (owner.trialEndsAt.getTime() - now.getTime() <= 7 * 86_400_000 || force === "trial") &&
    owner.trialEndsAt > now
  ) {
    const [bookingTotal] = await db
      .select({ value: count() })
      .from(schema.bookings)
      .where(eq(schema.bookings.ownerId, owner.id));
    const bookingCount = bookingTotal?.value ?? 0;
    const ok = await spool(db, {
      to: owner.email,
      from: "booktimewith.com",
      subject: `Your free month ends ${formatInTimeZone(owner.trialEndsAt, tz, "EEEE, MMMM d")}`,
      template: "trial-ending",
      ownerId: owner.id,
      ownerRecipientVersion: owner.sessionVersion,
      ownerStateKey: ownerBillingMailStateKey(owner),
      dedupeKey: `trial-ending:${owner.id}:${owner.trialEndsAt.toISOString()}`,
      element: TrialEnding({
        endsShort: formatInTimeZone(owner.trialEndsAt, tz, "EEEE"),
        endsLong: formatInTimeZone(owner.trialEndsAt, tz, "MMMM d"),
        since: formatInTimeZone(owner.createdAt, tz, "MMMM d"),
        bookings: bookingCount,
        price: PRICES[owner.currency as CurrencyCode] ?? PRICES.GBP,
        handle: owner.handle,
      }),
    }, { deferDelivery: true });
    if (ok) sent.push(`trial-ending:${owner.handle}`);
  }

  if (
    owner.planStatus === "trialing" &&
    owner.trialEndsAt &&
    owner.trialEndsAt < now &&
    !owner.stripeHasManageableSubscription
  ) {
    const [paused] = await withOwnerMutex(owner.id, () =>
      db
        .update(schema.owners)
        .set({ planStatus: "paused" })
        .where(
          and(
            eq(schema.owners.id, owner.id),
            eq(schema.owners.planStatus, "trialing"),
            lte(schema.owners.trialEndsAt, now),
            eq(schema.owners.stripeHasManageableSubscription, false),
          ),
        )
        .returning({ id: schema.owners.id }),
    );
    if (paused) sent.push(`trial-expired→paused:${owner.handle}`);
  }

  if (owner.planStatus === "past_due" && owner.graceUntil && owner.graceUntil < now) {
    const [paused] = await withOwnerMutex(owner.id, () =>
      db
        .update(schema.owners)
        .set({ planStatus: "paused" })
        .where(
          and(
            eq(schema.owners.id, owner.id),
            eq(schema.owners.planStatus, "past_due"),
            lte(schema.owners.graceUntil, now),
          ),
        )
        .returning({ id: schema.owners.id }),
    );
    if (paused) sent.push(`grace-expired→paused:${owner.handle}`);
  }
}

async function purgeOwner(
  db: Db,
  ownerId: string,
  now: Date,
): Promise<"purged" | "skipped" | "failed"> {
  try {
    return await withOwnerMutex(ownerId, async () => {
      const owner = await db.query.owners.findFirst({
        where: eq(schema.owners.id, ownerId),
      });
      if (
        !owner?.purgeAfter ||
        owner.purgeAfter > now ||
        owner.planStatus !== "cancelled"
      ) {
        return "skipped";
      }
      // Give an owner who just opened a resubscription Checkout enough time to
      // complete it; the resulting webhook clears the retention deadline.
      if (
        owner.stripeCheckoutAttemptId &&
        owner.stripeCheckoutAttemptAt &&
        owner.stripeCheckoutAttemptAt > new Date(now.getTime() - 24 * 60 * 60_000)
      ) {
        return "skipped";
      }
      const activeWebhook = await db.query.stripeEvents.findFirst({
        where: and(
          eq(schema.stripeEvents.ownerId, owner.id),
          inArray(schema.stripeEvents.status, ["processing"]),
          gt(
            schema.stripeEvents.receivedAt,
            new Date(now.getTime() - 5 * 60_000),
          ),
        ),
      });
      if (activeWebhook) return "skipped";
      if (owner.stripeCustomerId) {
        try {
          const openSessions = await listOpenStripeCheckoutSessions(
          owner.stripeCustomerId,
          owner.id,
        );
        const openUntil = openSessions.reduce<Date | null>((latest, session) => {
          if (
            typeof session.expires_at !== "number" ||
            session.expires_at * 1000 <= now.getTime()
          ) {
            return latest;
          }
          const expiry = new Date(session.expires_at * 1000 + 60 * 60_000);
          return !latest || expiry > latest ? expiry : latest;
        }, null);
        if (openUntil) {
          await db
            .update(schema.owners)
            .set({ purgeAfter: openUntil })
            .where(eq(schema.owners.id, owner.id));
          return "skipped";
        }
        const subscriptions = appOwnedStripeSubscriptions(
          await listStripeSubscriptions(owner.stripeCustomerId),
          owner.id,
        );
        const aggregate = aggregateStripeEntitlement(
          subscriptions,
          { graceUntil: owner.graceUntil },
          now,
        );
        const authoritative = aggregate.subscription;
        if (authoritative) {
          const subscriptionOwnerId = stripeOwnerReference(authoritative);
          if (subscriptionOwnerId && subscriptionOwnerId !== owner.id) {
            throw new Error("Stripe subscription owner mismatch during purge");
          }
          const patch = aggregate.patch;
          const subscriptionId = stripeResourceId(authoritative.id);
          if (!patch || !subscriptionId) {
            throw new Error("Stripe subscription could not be reconciled during purge");
          }
          const anomalies = stripeSubscriptionAnomalies(subscriptions);
          if (anomalies.multipleManageable) {
            console.error("Multiple manageable Stripe subscriptions during purge", {
              ownerId: owner.id,
              subscriptionIds: subscriptions
                .filter(stripeSubscriptionCanUsePortal)
                .map((candidate) => stripeResourceId(candidate.id)),
            });
          }
          if (anomalies.conflictingCurrencies) delete patch.currency;
          await db
            .update(schema.owners)
            .set({
              ...patch,
              stripeSubscriptionId: subscriptionId,
              stripeHasManageableSubscription:
                aggregate.hasManageableSubscription,
              ...(aggregate.hasManageableSubscription
                ? {
                    stripeCheckoutAttemptId: null,
                    stripeCheckoutAttemptAt: null,
                  }
                : {}),
            })
            .where(eq(schema.owners.id, owner.id));
          if (
            patch.planStatus !== "cancelled" ||
            !patch.purgeAfter ||
            patch.purgeAfter > now
          ) {
            return "skipped";
          }
          } else if (subscriptions.length > 0) {
            throw new Error(
              "Stripe subscriptions could not be reconciled during purge",
            );
          }
        } catch (error) {
          // A prior run can delete the remote customer and then crash before
          // the local cascade. Treat Stripe's resource_missing response as the
          // expected idempotent continuation; every other reconciliation error
          // remains fail-closed.
          if (!(error instanceof StripeResourceMissingError)) throw error;
        }
      }
      // Local credential deletion immediately ends this app's calendar access.
      // Do not revoke Google's user/client-wide grant here: another owner can
      // legitimately connect the same Google account.
      if (owner.stripeCustomerId) {
        await deleteStripeCustomer(owner.stripeCustomerId);
      }
      const [deleted] = await db
        .delete(schema.owners)
        .where(
          and(
            eq(schema.owners.id, owner.id),
            eq(schema.owners.planStatus, "cancelled"),
            lte(schema.owners.purgeAfter, now),
          ),
        )
        .returning({ id: schema.owners.id });
      return deleted ? "purged" : "skipped";
    });
  } catch (error) {
    console.error("Scheduled owner purge failed", error);
    return "failed";
  }
}

const fmtLocal = (d: Date, tz: string) => formatInTimeZone(d, tz, "h:mm a");

async function todaysBookings(db: Db, ownerId: string, tz: string, now: Date) {
  const today = formatInTimeZone(now, tz, "yyyy-MM-dd");
  const range = ownerLocalDayRange(today, tz);
  if (!range) return [];
  return db.query.bookings.findMany({
    where: and(
      eq(schema.bookings.ownerId, ownerId),
      eq(schema.bookings.status, "confirmed"),
      gte(schema.bookings.startsAt, range.startsAt),
      lt(schema.bookings.startsAt, range.endsAt),
    ),
    orderBy: (booking, { asc }) => [
      asc(booking.startsAt),
      asc(booking.id),
    ],
    limit: OWNER_SUMMARY_BATCH_SIZE,
  });
}
