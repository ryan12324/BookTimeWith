import type { ComponentType } from "react";
import {
  Cancelled,
  ClientConfirmation,
  ClientOwnerChanged,
  ClientReminder,
  OwnerClientChanged,
  OwnerMorningSummary,
  OwnerNewBooking,
  OwnerSignIn,
  OwnerVerifyEmail,
  PaymentFailed,
  Receipt,
  TrialEnding,
  Welcome,
} from "./templates";

export type EmailCategory = "booking" | "billing" | "system";

export interface EmailMeta {
  id: string;
  category: EmailCategory;
  tag: string; // the "TO … · WHEN" label from the design
  from: string;
  /**
   * Client-facing emails send From "{Owner} via booktimewith.com" with
   * Reply-To the owner's real address, so replies reach the owner, not us
   * (README "Email deliverability").
   */
  replyTo?: string;
  subject: string;
  designed: boolean; // true for 1–8, false for the in-voice 9–12
  Component: ComponentType;
}

const OWNER_FROM = "Dana Whitfield via booktimewith.com";
const OWNER_REPLY_TO = "dana@example.com"; // the owner's real email
const SYSTEM_FROM = "booktimewith.com";

export const EMAILS: EmailMeta[] = [
  // Booking set (designed)
  {
    id: "client-confirmation",
    category: "booking",
    tag: "TO CLIENT · ON BOOKING",
    from: OWNER_FROM,
    replyTo: OWNER_REPLY_TO,
    subject: "You're booked — Tuesday, July 14 at 10:00",
    designed: true,
    Component: ClientConfirmation,
  },
  {
    id: "client-reminder",
    category: "booking",
    tag: "TO CLIENT · 24H BEFORE",
    from: OWNER_FROM,
    replyTo: OWNER_REPLY_TO,
    subject: "Tomorrow at 10:00 — your session with Dana",
    designed: true,
    Component: ClientReminder,
  },
  {
    id: "owner-new-booking",
    category: "booking",
    tag: "TO OWNER · ON BOOKING",
    from: SYSTEM_FROM,
    subject: "New booking — Alex Martin, Tue Jul 14 at 10:00",
    designed: true,
    Component: OwnerNewBooking,
  },
  {
    id: "owner-morning-summary",
    category: "booking",
    tag: "TO OWNER · MORNING OF",
    from: SYSTEM_FROM,
    subject: "Today: 3 sessions, first at 10:00",
    designed: true,
    Component: OwnerMorningSummary,
  },
  // Billing set (designed)
  {
    id: "trial-ending",
    category: "billing",
    tag: "TO OWNER · 7 DAYS BEFORE TRIAL ENDS",
    from: SYSTEM_FROM,
    subject: "Your free month ends Monday, August 3",
    designed: true,
    Component: TrialEnding,
  },
  {
    id: "receipt",
    category: "billing",
    tag: "TO OWNER · MONTHLY RECEIPT",
    from: SYSTEM_FROM,
    subject: "Receipt — £6.00, August",
    designed: true,
    Component: Receipt,
  },
  {
    id: "payment-failed",
    category: "billing",
    tag: "TO OWNER · PAYMENT FAILED",
    from: SYSTEM_FROM,
    subject: "Your card didn't go through — no rush",
    designed: true,
    Component: PaymentFailed,
  },
  {
    id: "cancelled",
    category: "billing",
    tag: "TO OWNER · ON CANCELLATION",
    from: SYSTEM_FROM,
    subject: "Cancelled — your page runs until September 3",
    designed: true,
    Component: Cancelled,
  },
  // In-voice, not designed (README 9–12)
  {
    id: "owner-sign-in",
    category: "system",
    tag: "TO OWNER · SIGN-IN",
    from: SYSTEM_FROM,
    subject: "Here's your sign-in link",
    designed: false,
    Component: OwnerSignIn,
  },
  {
    id: "owner-client-changed",
    category: "system",
    tag: "TO OWNER · CLIENT RESCHEDULED",
    from: SYSTEM_FROM,
    subject: "Alex Martin moved to Thursday at 2:00",
    designed: false,
    Component: OwnerClientChanged,
  },
  {
    id: "client-owner-changed",
    category: "system",
    tag: "TO CLIENT · OWNER MOVED YOUR BOOKING",
    from: OWNER_FROM,
    replyTo: OWNER_REPLY_TO,
    subject: "Dana had to move your Tuesday session",
    designed: false,
    Component: ClientOwnerChanged,
  },
  {
    id: "welcome",
    category: "system",
    tag: "TO OWNER · ON SIGNUP",
    from: SYSTEM_FROM,
    subject: "You're set up — here's your link",
    designed: false,
    Component: Welcome,
  },
  {
    id: "owner-verify-email",
    category: "system",
    tag: "TO OWNER · CONFIRM EMAIL",
    from: SYSTEM_FROM,
    subject: "Confirm your email — one click",
    designed: false,
    Component: OwnerVerifyEmail,
  },
];
