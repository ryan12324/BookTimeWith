import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Data model (README "Data model"). Postgres via Drizzle — swap the driver for
 * Cloudflare D1 if staying all-Cloudflare. This is the phase-2 persistence layer;
 * the current UI runs off the in-memory/localStorage mock.
 */

export const locationMode = pgEnum("location_mode", ["mine", "theirs"]);
export const bookingStatus = pgEnum("booking_status", ["confirmed", "moved", "cancelled"]);
export const bookingActor = pgEnum("booking_actor", ["owner", "client"]);
export const planStatus = pgEnum("plan_status", ["trialing", "active", "past_due", "paused", "cancelled"]);
export const calendarProvider = pgEnum("calendar_provider", ["google", "outlook", "apple"]);
export const tokenKind = pgEnum("token_kind", ["owner_signin", "client_manage"]);

export const owners = pgTable("owners", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  handle: text("handle").notNull().unique(),
  timezone: text("timezone").notNull().default("Europe/London"),
  // notification prefs
  notifyOnChange: boolean("notify_on_change").notNull().default(true),
  notifyMorningSummary: boolean("notify_morning_summary").notNull().default(true),
  // billing
  stripeCustomerId: text("stripe_customer_id"),
  planStatus: planStatus("plan_status").notNull().default("trialing"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // 90-day retention timer after cancellation; hard-deleted past this.
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
});

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
    clientName: text("client_name").notNull(),
    clientEmail: text("client_email").notNull(),
    clientAddress: text("client_address"),
    status: bookingStatus("status").notNull().default("confirmed"),
    lastActionBy: bookingActor("last_action_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Race protection: one confirmed booking per owner per start time.
  (t) => ({ uniqSlot: unique().on(t.ownerId, t.startsAt) }),
);

export const calendarConnections = pgTable("calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => owners.id, { onDelete: "cascade" }),
  provider: calendarProvider("provider").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  syncState: text("sync_state"), // provider sync/delta token
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

/** Hashed, single-use, expiring tokens: owner sign-in (15m) + client manage links. */
export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: tokenKind("kind").notNull(),
  ownerId: uuid("owner_id").references(() => owners.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});
