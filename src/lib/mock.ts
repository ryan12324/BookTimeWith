import type { Cells } from "./availability";
import type { CurrencyCode } from "./format";

/** Shared owner-config contract for the API-backed owner and public surfaces. */

export type LocationMode = "mine" | "theirs" | "virtual";

/** "Away 3–10 Aug" — one control on the bookings page, blocks all slots. */
export interface AwayPeriod {
  start: string; // ISO date, inclusive
  end: string; // ISO date, inclusive
}

export interface OwnerConfig {
  handle: string;
  name: string; // the owner — shown on the booking page and in email From lines
  service: string;
  duration: number; // minutes, 15–240 step 5
  location: LocationMode;
  ownerAddress: string;
  // Optional static Zoom/Meet URL — used in reminders when there's no
  // calendar-created Google Meet link.
  meetingLink: string;
  cells: Cells;
  startHour: number;
  endHour: number;
  weekends: boolean;
  calendar: string | null; // provider name once connected
  calendarStatus?: "connected" | "degraded";
  calendarError?: string | null;
  calendarLastSyncedAt?: string | null;
  notifyBook: boolean;
  notifyMorning: boolean;
  bookingHorizonDays: number; // 1–730 days from now
  timezone: string; // IANA; availability is painted in this zone
  currency: CurrencyCode; // plan display + Stripe price selection
  // True once Stripe owns the subscription price. The selector becomes display-
  // only; currency changes must happen through a supported billing migration.
  billingCurrencyLocked: boolean;
  away: AwayPeriod | null;
  // Billing-driven page state (grace expired / trial lapsed), set by Stripe
  // webhooks; the booking page renders its paused state from this value.
  paused: boolean;
  entitlementReason?:
    | "email_unverified"
    | "trial_expired"
    | "payment_grace_expired"
    | "subscription_ended"
    | "paused"
    | null;
  // Address displayed in the editor (the pending replacement when one exists).
  email: string;
  // Trusted notification/sign-in identity until `email` is confirmed.
  activeEmail: string;
  pendingEmail: string | null; // untrusted replacement until its link is consumed
  emailVerified: boolean;
  emailDeliveryConfigured: boolean;
  // False until onboarding finishes — gates the Bookings/Settings nav.
  setupComplete: boolean;
  // Billing state (server-derived, read-only on the client)
  planStatus: "trialing" | "active" | "past_due" | "paused" | "cancelled";
  trialEndsAt: string | null; // ISO
  graceUntil: string | null; // ISO
}

/** The demo owner — Dana Whitfield, matching the design files. */
export const OWNER_NAME = "Dana Whitfield, LMFT";

/**
 * A brand-new account: everything blank — signup collects it. The only
 * prefill the setup flow ever gets is the ?handle= from the landing claim.
 */
export const DEFAULT_OWNER: OwnerConfig = {
  handle: "",
  name: "",
  service: "",
  duration: 50,
  location: "mine",
  ownerAddress: "",
  meetingLink: "",
  // Grid defaults to 9am–5pm; the earlier/later buttons extend from there.
  startHour: 9,
  endHour: 17,
  weekends: false,
  calendar: null,
  notifyBook: true,
  notifyMorning: true,
  bookingHorizonDays: 60,
  timezone: "Europe/London",
  currency: "GBP",
  billingCurrencyLocked: false,
  away: null,
  paused: false,
  entitlementReason: null,
  email: "",
  activeEmail: "",
  pendingEmail: null,
  emailVerified: false,
  emailDeliveryConfigured: false,
  setupComplete: false,
  planStatus: "trialing",
  trialEndsAt: null,
  graceUntil: null,
  cells: {},
};

/** "TODAY · TUESDAY 14" / "TOMORROW · WEDNESDAY 15" / "FRIDAY 17" */
export function bookingGroupLabel(start: Date, now: Date): string {
  const label = `${start
    .toLocaleDateString("en-GB", { weekday: "long" })
    .toUpperCase()} ${start.getDate()}`;
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (day(start) === day(now)) return `TODAY · ${label}`;
  if (day(start) === day(tomorrow)) return `TOMORROW · ${label}`;
  return label;
}
