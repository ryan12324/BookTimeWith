import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Application data model. The runtime uses Drizzle over pooled PostgreSQL;
 * tests may exercise the same PostgreSQL dialect through an isolated adapter.
 */

export const locationMode = pgEnum("location_mode", ["mine", "theirs"]);
export const bookingStatus = pgEnum("booking_status", ["confirmed", "moved", "cancelled"]);
export const bookingActor = pgEnum("booking_actor", ["owner", "client"]);
export const planStatus = pgEnum("plan_status", ["trialing", "active", "past_due", "paused", "cancelled"]);
export const calendarProvider = pgEnum("calendar_provider", ["google", "outlook", "apple"]);
export const tokenKind = pgEnum("token_kind", ["owner_signin", "client_manage", "email_verify"]);

export const owners = pgTable(
  "owners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    // A requested identity change does not replace the trusted recipient until
    // the confirmation link sent to this exact address is consumed.
    pendingEmail: text("pending_email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    name: text("name").notNull(),
    handle: text("handle").notNull().unique(),
    timezone: text("timezone").notNull().default("Europe/London"),
    // Incremented by every settings transaction. Booking confirmation locks the
    // owner row so it validates against one coherent configuration revision.
    configVersion: integer("config_version").notNull().default(0),
    // Included in signed sessions and incremented when identity changes. Route
    // authorization checks it against the live row, revoking all older cookies.
    sessionVersion: integer("session_version").notNull().default(0),
    // Incremented when OAuth consent starts and again on disconnect. A callback
    // may install tokens only for the exact still-current calendar intent.
    calendarGeneration: integer("calendar_generation").notNull().default(0),
    // Rotating cursor for bounded scheduled owner work.
    cronCheckedAt: timestamp("cron_checked_at", { withTimezone: true }),
    // Null until the owner finishes onboarding; gates the Bookings/Settings nav.
    setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
    // notification prefs
    notifyOnChange: boolean("notify_on_change").notNull().default(true),
    notifyMorningSummary: boolean("notify_morning_summary").notNull().default(true),
    // Furthest into the future a client can choose a slot.
    bookingHorizonDays: smallint("booking_horizon_days").notNull().default(60),
    // billing
    // The remote customer is created and bound before Checkout. This lets
    // account deletion cancel even a Checkout session that has not completed.
    stripeCustomerId: text("stripe_customer_id").unique(),
    // The subscription currently supplying entitlement after reconciling every
    // subscription attached to the customer (old cancellation events must not
    // override a newer active subscription).
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    // True when any app-owned subscription can still be managed in Portal, even
    // if entitlement temporarily comes from a paid-through cancelled sibling.
    stripeHasManageableSubscription: boolean("stripe_has_manageable_subscription")
      .notNull()
      .default(false),
    // Reuse one Checkout idempotency key for its <=24h lifetime. Concurrent
    // "Manage billing" clicks therefore cannot create multiple subscriptions.
    stripeCheckoutAttemptId: text("stripe_checkout_attempt_id"),
    stripeCheckoutAttemptAt: timestamp("stripe_checkout_attempt_at", {
      withTimezone: true,
    }),
    currency: text("currency").notNull().default("GBP"),
    planStatus: planStatus("plan_status").notNull().default("trialing"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    // The instant this account loses booking entitlement. Kept separate from the
    // 90-day data-retention deadline so cancellation never means immediate loss.
    accessEndsAt: timestamp("access_ends_at", { withTimezone: true }),
    // Failed payment → 14-day grace; the page pauses only after this passes.
    graceUntil: timestamp("grace_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // 90-day retention timer after cancellation; hard-deleted past this.
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (t) => ({ cronDue: index("owners_cron_checked_at_idx").on(t.cronCheckedAt) }),
);

/** Old handles keep a 301 for 90 days after a change. */
export const handleRedirects = pgTable("handle_redirects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => owners.id, { onDelete: "cascade" }),
  fromHandle: text("from_handle").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => owners.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  durationMinutes: smallint("duration_minutes").notNull(), // 15–240, step 5
  locationMode: locationMode("location_mode").notNull().default("mine"),
  ownerAddress: text("owner_address"),
  meetingLink: text("meeting_link"), // static Zoom/Meet URL when not using Google Meet
});

/** Painted half-hour availability. One row per open half-hour block. */
export const availability = pgTable(
  "availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull().references(() => owners.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(), // 0–6 (Mon–Sun)
    startMinute: smallint("start_minute").notNull(), // minutes from midnight, 30-min granular
    endMinute: smallint("end_minute").notNull(),
  },
  (t) => ({ uniqBlock: unique().on(t.ownerId, t.weekday, t.startMinute) }),
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull().references(() => owners.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => services.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), // stored UTC
    // End instant, snapshotted from the service duration at write time (so a
    // later duration change doesn't retroactively move existing bookings).
    // Backs the GiST exclusion constraint below.
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // Authoritative expiry for the booking's single stable manage capability.
    // Updated in the same transaction as every lifecycle transition.
    manageExpiresAt: timestamp("manage_expires_at", { withTimezone: true }).notNull(),
    // Immutable appointment presentation. Existing bookings must not be
    // rewritten when the owner later renames the service or changes where new
    // appointments happen.
    serviceNameSnapshot: text("service_name_snapshot").notNull(),
    locationModeSnapshot: locationMode("location_mode_snapshot").notNull(),
    // Resolved address for this appointment: the client's submitted address for
    // `theirs`, or the owner's address at booking time for `mine`.
    locationSnapshot: text("location_snapshot"),
    // Immutable non-provider fallback. `meetingLink` below is the effective
    // link and may temporarily be replaced by Google Meet; disconnecting or
    // switching providers restores this snapshot instead of retaining a stale
    // provider URL.
    meetingLinkSnapshot: text("meeting_link_snapshot"),
    clientName: text("client_name").notNull(),
    clientEmail: text("client_email").notNull(),
    // Zone in which the client chose the instant. Client-facing mail keeps
    // using this zone even when the owner is elsewhere; null is legacy data.
    clientTimezone: text("client_timezone"),
    clientAddress: text("client_address"),
    status: bookingStatus("status").notNull().default("confirmed"),
    lastActionBy: bookingActor("last_action_by"),
    // Exact committed action intent; avoids timestamp/UUID tie-breaking when a
    // client retries a response after later actions have already happened.
    lastActionKey: text("last_action_key"),
    // Auto Google Meet when calendar-connected; else the service's static link.
    meetingLink: text("meeting_link"),
    // Browser-generated idempotency key. A retried confirm returns this booking
    // instead of creating a second appointment or surfacing a misleading 409.
    clientRequestKey: text("client_request_key"),
    // SHA-256 of the normalized initial POST payload. Booking lifecycle changes
    // mutate startsAt/clientTimezone, so replay must not compare against those
    // mutable columns.
    initialIntentHash: text("initial_intent_hash"),
    // Provider state required to keep create/move/cancel/restore in sync.
    calendarProvider: calendarProvider("calendar_provider"),
    calendarEventId: text("calendar_event_id"),
    // Stable generation for provider-side create idempotency. Increment when a
    // cancel/restore boundary may require a fresh provider event identity.
    calendarRevision: integer("calendar_revision").notNull().default(0),
    calendarSyncStatus: text("calendar_sync_status").notNull().default("none"),
    calendarSyncError: text("calendar_sync_error"),
    calendarUpdatedAt: timestamp("calendar_updated_at", { withTimezone: true }),
    // Rotating cursor for bounded crash-recovery scans; prevents a fixed batch
    // of already-complete rows from starving newer missing mail.
    mailRecoveryCheckedAt: timestamp("mail_recovery_checked_at", {
      withTimezone: true,
    }),
    // Old appointments retain anonymous operational history, not a client's
    // identity/contact/location, after the documented retention period.
    clientPiiAnonymizedAt: timestamp("client_pii_anonymized_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Race protection: one *confirmed* booking per owner per start time (fast
  // exact-match guard). Overlap of *different* start times is enforced by the
  // GiST exclusion constraint `bookings_no_overlap` — an EXCLUDE that Drizzle
  // can't express, added in migration 0003. Partial predicates on both mean
  // cancelled/moved rows never block a legitimate rebooking of the slot.
  (t) => ({
    uniqSlot: uniqueIndex("bookings_owner_start_confirmed_uniq")
      .on(t.ownerId, t.startsAt)
      .where(sql`${t.status} = 'confirmed'`),
    uniqClientRequest: uniqueIndex("bookings_client_request_key_uniq")
      .on(t.clientRequestKey)
      .where(sql`${t.clientRequestKey} is not null`),
    calendarSyncDue: index("bookings_calendar_sync_status_idx").on(t.calendarSyncStatus),
    clientPiiRetentionDue: index("bookings_client_pii_retention_idx").on(
      t.clientPiiAnonymizedAt,
      t.endsAt,
    ),
  }),
);

export const calendarConnections = pgTable("calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => owners.id, { onDelete: "cascade" }),
  provider: calendarProvider("provider").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  syncState: text("sync_state"), // provider sync/delta token
  syncStatus: text("sync_status").notNull().default("connected"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

/** "I'm away 3–10 Aug" — one control, blocks all slots in the range. */
export const awayPeriods = pgTable("away_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => owners.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
});

/** Idempotency ledger for cron sends (reminders, summaries, trial notices). */
export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").references(() => owners.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    template: text("template").notNull(), // e.g. "client-reminder"
    dedupeKey: text("dedupe_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqSend: unique().on(t.dedupeKey) }),
);

/** Durable outbound-mail spool; production delivers from here and local runs
 * retain the same rows for inspection at /emails. */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").references(() => owners.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    // Mail containing an owner recipient/reply-to identity is valid only for
    // the exact identity revision that queued it. Email changes increment
    // sessionVersion.
    ownerRecipientVersion: integer("owner_recipient_version"),
    // Template-specific state fingerprint for owner billing/summary mail.
    // Delivery recomputes it and suppresses stale retries.
    ownerStateKey: text("owner_state_key"),
    // Exact auth capability embedded in sign-in/verification mail. Delivery
    // verifies that the token row still exists, is unused, and is unexpired.
    authTokenId: uuid("auth_token_id"),
    // Snapshot of the booking state this message describes. Delivery locks the
    // booking and suppresses the row if a newer action has superseded it.
    bookingStateKey: text("booking_state_key"),
    dedupeKey: text("dedupe_key"),
    toEmail: text("to_email").notNull(),
    fromLine: text("from_line").notNull(),
    replyTo: text("reply_to"),
    subject: text("subject").notNull(),
    template: text("template").notNull(),
    html: text("html").notNull(),
    // JSON [{filename, contentType, content}] — the confirmation's .ics lives here.
    attachments: text("attachments"),
    delivery: text("delivery").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqDedupe: uniqueIndex("email_outbox_dedupe_key_uniq")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    retryDue: index("email_outbox_retry_due_idx").on(t.delivery, t.nextAttemptAt),
  }),
);

/** Hashed, single-use, expiring tokens: owner sign-in (15m) + client manage links. */
export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: tokenKind("kind").notNull(),
  ownerId: uuid("owner_id").references(() => owners.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
  // Exact active/pending owner address this identity capability was sent to.
  // This prevents a later settings change from reinterpreting an old link.
  identityEmail: text("identity_email"),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/** Immutable audit and idempotency ledger for booking state transitions. */
export const bookingActions = pgTable("booking_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => owners.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  actionKey: text("action_key").notNull().unique(),
  action: text("action").notNull(),
  actor: bookingActor("actor").notNull(),
  reason: text("reason"),
  fromStartsAt: timestamp("from_starts_at", { withTimezone: true }),
  toStartsAt: timestamp("to_starts_at", { withTimezone: true }),
  // Empty string means the client deliberately omitted the optional timezone;
  // null is reserved for pre-migration and owner-authored action rows.
  clientTimezoneIntent: text("client_timezone_intent"),
  mailRecoveryCheckedAt: timestamp("mail_recovery_checked_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Stripe event receipt ledger: every event is matched and applied at most once. */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    eventId: text("event_id").primaryKey(),
    ownerId: uuid("owner_id").references(() => owners.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    eventCreatedAt: timestamp("event_created_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("processing"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => ({ ownerCreated: index("stripe_events_owner_created_idx").on(t.ownerId, t.eventCreatedAt) }),
);

/** Fixed-window counters for booking, sign-in and expensive public reads. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ updated: index("rate_limits_updated_at_idx").on(t.updatedAt) }),
);
