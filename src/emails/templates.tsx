import { Section } from "react-email";
import {
  Btn,
  ButtonRow,
  CardLine,
  CardTitle,
  DetailCard,
  EmailLayout,
  FinePrint,
  Headline,
  Lead,
  SANS,
} from "./components";

/**
 * The transactional email set. 1–8 are the designed emails (4 booking +
 * 4 billing); 9–12 are written in the same voice per the handoff spec.
 * Sample data mirrors the design files (Dana / Alex / Therapy session).
 */

const bold = { color: "#26221c", fontWeight: 600 } as const;

/**
 * Link targets. Every client email carries the magic manage link (README) — a
 * signed single-use token URL minted per send (src/lib/auth-tokens.ts); the
 * send layer passes the real one via props, previews use this sample. The
 * confirmation email also gets a `.ics` attachment built with
 * src/lib/ics.ts#buildIcs at send time.
 */
const MANAGE_URL = "https://booktimewith.link/manage/tok_sample-preview";
const BOOKINGS_APP_URL = "https://booktimewith.com/app/bookings";
const SETTINGS_URL = "https://booktimewith.com/app/settings";
const CALENDAR_URL =
  "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Therapy+session+with+Dana+Whitfield&dates=20260714T090000Z/20260714T095000Z";

/* ── Booking set ─────────────────────────────────────────────── */

// 1 · Client confirmation (on booking) — sent with a .ics attachment
export function ClientConfirmation({
  manageUrl = MANAGE_URL,
  calendarUrl = CALENDAR_URL,
  clientFirst = "Alex",
  cardTitle = "Therapy session with Dana Whitfield",
  whenBold = "Tuesday, July 14",
  whenTimes = "10:00 – 10:50",
  whereLine = "Video call — the link arrives with your reminder",
  handle = "dana",
}: {
  manageUrl?: string;
  calendarUrl?: string;
  clientFirst?: string;
  cardTitle?: string;
  whenBold?: string;
  whenTimes?: string;
  whereLine?: string;
  handle?: string;
} = {}) {
  return (
    <EmailLayout
      preview={`You're booked — ${whenBold} at ${whenTimes.split(" ")[0]}`}
      footer={`Booked at booktimewith.link/${handle} · powered by booktimewith.com`}
    >
      <Headline>You&apos;re booked, {clientFirst}.</Headline>
      <DetailCard>
        <CardTitle>{cardTitle}</CardTitle>
        <CardLine>
          <span style={bold}>{whenBold}</span> · {whenTimes}
        </CardLine>
        <CardLine>{whereLine}</CardLine>
      </DetailCard>
      <ButtonRow>
        <Btn kind="ink" href={calendarUrl}>Add to calendar</Btn>
        <span style={{ display: "inline-block", width: 10 }} />
        <Btn kind="outline" href={manageUrl}>Change or cancel</Btn>
      </ButtonRow>
      <FinePrint>
        Plans change — the button above lets you pick a new time or cancel in two
        taps. No account, no phone call needed.
      </FinePrint>
    </EmailLayout>
  );
}

// 2 · Client reminder (the first scheduled run within 25h of the appointment)
export function ClientReminder({
  manageUrl = MANAGE_URL,
  joinUrl = "https://meet.google.com/xyz-demo" as string | null,
  timingLabel = "on Tuesday, July 14 at 10:00 am",
  changeLine = "Changes are available until 24 hours before.",
  changesAllowed = true,
  cardTitle = "Therapy session with Dana Whitfield",
  whenBold = "Tuesday, July 14",
  whenTimes = "10:00 – 10:50",
  handle = "dana",
}: {
  manageUrl?: string;
  /** null hides the Join button (in-person sessions) */
  joinUrl?: string | null;
  timingLabel?: string;
  changeLine?: string;
  changesAllowed?: boolean;
  cardTitle?: string;
  whenBold?: string;
  whenTimes?: string;
  handle?: string;
} = {}) {
  return (
    <EmailLayout
      preview={`Reminder — ${timingLabel}`}
      footer={`Booked at booktimewith.link/${handle} · powered by booktimewith.com`}
    >
      <Headline>See you {timingLabel}.</Headline>
      <DetailCard>
        <CardTitle>{cardTitle}</CardTitle>
        <CardLine>
          <span style={bold}>{whenBold}</span> · {whenTimes}
        </CardLine>
        {joinUrl && (
          <Section style={{ marginTop: 14 }}>
            <Btn kind="bronze-block" href={joinUrl}>Join video call</Btn>
          </Section>
        )}
      </DetailCard>
      <ButtonRow>
        <Btn kind="outline" href={manageUrl}>
          {changesAllowed ? "Change or cancel" : "View booking"}
        </Btn>
        <span
          style={{ marginLeft: 12, fontFamily: SANS, fontSize: 12, color: "#71695d" }}
        >
          {changeLine}
        </span>
      </ButtonRow>
    </EmailLayout>
  );
}

// 3 · Owner new booking
export function OwnerNewBooking({
  clientName = "Alex Martin",
  clientEmail = "alex@example.com",
  cardTitle = "Therapy session · 50 min",
  whenBold = "Tuesday, July 14",
  whenTimes = "10:00 – 10:50",
  handle = "dana",
}: {
  clientName?: string;
  clientEmail?: string;
  cardTitle?: string;
  whenBold?: string;
  whenTimes?: string;
  handle?: string;
} = {}) {
  return (
    <EmailLayout
      preview={`New booking — ${clientName}`}
      footer={`booktimewith.link/${handle} · notification settings`}
    >
      <Headline>{clientName} booked you.</Headline>
      <DetailCard>
        <CardTitle>{cardTitle}</CardTitle>
        <CardLine>
          <span style={bold}>{whenBold}</span> · {whenTimes}
        </CardLine>
        <CardLine>
          {clientName} · {clientEmail}
        </CardLine>
      </DetailCard>
      <ButtonRow>
        <Btn kind="outline" href={BOOKINGS_APP_URL}>Reschedule</Btn>
        <span style={{ display: "inline-block", width: 10 }} />
        <Btn kind="outline" href={BOOKINGS_APP_URL}>Cancel</Btn>
      </ButtonRow>
      <FinePrint>
        If you reschedule or cancel, we&apos;ll queue a polite update automatically.
      </FinePrint>
    </EmailLayout>
  );
}

// 4 · Owner morning summary
export function OwnerMorningSummary({
  headline = "Tuesday: three sessions.",
  rows = [
    { time: "10:00", name: "Alex Martin", serviceName: "Therapy session" },
    { time: "1:00", name: "Priya Shah", serviceName: "Therapy session" },
    { time: "3:30", name: "Sam Reed", serviceName: "Therapy session" },
  ],
  serviceName = "Therapy session",
  handle = "dana",
}: {
  headline?: string;
  rows?: { time: string; name: string; serviceName?: string }[];
  serviceName?: string;
  handle?: string;
} = {}) {
  return (
    <EmailLayout
      preview={`Today: ${rows.length} session${rows.length === 1 ? "" : "s"}${rows.length ? `, first at ${rows[0].time}` : ""}`}
      footer={`booktimewith.link/${handle} · notification settings`}
    >
      <Headline>{headline}</Headline>
      <Section
        style={{
          marginTop: 20,
          backgroundColor: "#ffffff",
          border: "1px solid #e6dfd3",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {rows.map((r, i) => (
          <table
            key={r.time}
            width="100%"
            cellPadding={0}
            cellSpacing={0}
            style={{ borderBottom: i < rows.length - 1 ? "1px solid #efe9de" : "none" }}
          >
            <tbody>
              <tr>
                <td style={{ padding: "15px 24px", fontFamily: SANS, fontSize: 14 }}>
                  <span style={bold}>{r.time}</span>{" "}
                  <span style={{ color: "#6b6357" }}>· {r.name}</span>
                </td>
                <td
                  style={{
                    padding: "15px 24px",
                    textAlign: "right",
                    fontFamily: SANS,
                    fontSize: 12,
                    color: "#71695d",
                  }}
                >
                  {r.serviceName ?? serviceName}
                </td>
              </tr>
            </tbody>
          </table>
        ))}
      </Section>
      <ButtonRow>
        <Btn kind="outline" href={BOOKINGS_APP_URL}>Open your day</Btn>
        <span style={{ marginLeft: 12, fontFamily: SANS, fontSize: 12, color: "#71695d" }}>
          Open your day for the latest details
        </span>
      </ButtonRow>
    </EmailLayout>
  );
}

/* ── Billing set ─────────────────────────────────────────────── */

// 5 · Trial ending (7 days before)
export function TrialEnding({
  endsShort = "Monday",
  endsLong = "August 3",
  since = "July 3",
  bookings = 14,
  price = "£6",
  handle = "dana",
}: {
  endsShort?: string;
  endsLong?: string;
  since?: string;
  bookings?: number;
  price?: string;
  handle?: string;
} = {}) {
  return (
    <EmailLayout
      preview={`Your free month ends ${endsShort}, ${endsLong}`}
      footer={`booktimewith.link/${handle} · billing settings`}
    >
      <Headline>Your free month ends {endsShort}.</Headline>
      <Lead>
        Since {since} your link has taken{" "}
        <span style={bold}>{bookings} booking{bookings === 1 ? "" : "s"}</span>. If
        that&apos;s been useful, keeping it is {price} a month; add a card and nothing
        changes.
      </Lead>
      <ButtonRow>
        {/* Production href: a Stripe Checkout session minted per owner. */}
        <Btn kind="ink" href={SETTINGS_URL}>Add a card, {price}/mo</Btn>
      </ButtonRow>
      <FinePrint>
        If you do nothing, your booking page pauses on {endsLong}. Your settings
        remain in place so you can add a card and restart later.
      </FinePrint>
    </EmailLayout>
  );
}

// 6 · Receipt (monthly)
export function Receipt({
  period = "August 2026",
  amount = "£6.00",
  cardLine = "Visa ending 4242 · August 3",
  handle = "dana",
  invoiceUrl = SETTINGS_URL,
}: {
  period?: string;
  amount?: string;
  cardLine?: string;
  handle?: string;
  invoiceUrl?: string;
} = {}) {
  return (
    <EmailLayout
      preview={`Receipt — ${amount}, ${period.split(" ")[0]}`}
      footer={`booktimewith.link/${handle} · billing settings`}
    >
      <Headline>Paid. Nothing to do.</Headline>
      <DetailCard>
        <table width="100%" cellPadding={0} cellSpacing={0}>
          <tbody>
            <tr>
              <td style={{ fontFamily: SANS, fontSize: 14, color: "#6b6357" }}>
                booktimewith · {period}
              </td>
              <td style={{ fontFamily: SANS, fontSize: 14, textAlign: "right", ...bold }}>
                {amount}
              </td>
            </tr>
            <tr>
              <td style={{ paddingTop: 8, fontFamily: SANS, fontSize: 12.5, color: "#71695d" }}>
                {cardLine}
              </td>
            </tr>
          </tbody>
        </table>
      </DetailCard>
      <ButtonRow>
        <Btn kind="outline" href={invoiceUrl}>Download invoice (PDF)</Btn>
        <span style={{ marginLeft: 14, fontFamily: SANS, fontSize: 12, color: "#71695d" }}>
          For your accountant
        </span>
      </ButtonRow>
    </EmailLayout>
  );
}

// 7 · Payment failed
export function PaymentFailed({
  pageStatus = "It happens. Your booking page keeps working while we retry, so clients can still book.",
  retryLine = "We'll retry on August 6 and August 10. If it still fails, your page pauses — nothing is deleted.",
  handle = "dana",
}: {
  pageStatus?: string;
  retryLine?: string;
  handle?: string;
} = {}) {
  return (
    <EmailLayout
      preview="Your card didn't go through — no rush"
      footer={`booktimewith.link/${handle} · billing settings`}
    >
      <Headline>Your card didn&apos;t go through.</Headline>
      <Lead>{pageStatus}</Lead>
      <ButtonRow>
        {/* Production href: the Stripe Customer Portal payment-method page. */}
        <Btn kind="ink" href={SETTINGS_URL}>Update card</Btn>
      </ButtonRow>
      <FinePrint>{retryLine}</FinePrint>
    </EmailLayout>
  );
}

// 8 · Cancelled
export function Cancelled({
  paidThrough = "September 3",
  handle = "dana",
  exportUrl = "https://booktimewith.com/app/export/bookings",
}: {
  paidThrough?: string;
  handle?: string;
  exportUrl?: string;
} = {}) {
  return (
    <EmailLayout
      preview={`Cancelled — your page runs until ${paidThrough}`}
      footer={`booktimewith.link/${handle} · come back anytime`}
    >
      <Headline>Done — you&apos;re cancelled.</Headline>
      <Lead>
        No wind-down tricks: you&apos;ve paid to {paidThrough}, so your page works
        until then. Booked appointments still happen and reminders still go out.
      </Lead>
      <ButtonRow>
        <Btn kind="outline" href={exportUrl}>Export your bookings (CSV)</Btn>
      </ButtonRow>
      <FinePrint>
        We keep your link and settings for 90 days in case you change your mind.
        After that, everything is deleted — properly.
      </FinePrint>
    </EmailLayout>
  );
}

/* ── Written in the same voice (not designed — README 9–12) ─────── */

// 9 · Owner sign-in magic link (single-use, 15-minute expiry — src/lib/auth-tokens.ts)
export function OwnerSignIn({
  signInUrl = "https://booktimewith.com/signin/tok_sample-preview",
}: {
  signInUrl?: string;
} = {}) {
  return (
    <EmailLayout preview="Here's your sign-in link" footer="booktimewith.com · you have no password — this is the login">
      <Headline>Here&apos;s your sign-in link.</Headline>
      <Lead>
        No password to remember — tap the button and you&apos;re in. It works once
        and expires in 15 minutes.
      </Lead>
      <ButtonRow>
        <Btn kind="ink" href={signInUrl}>Sign in to booktimewith.com</Btn>
      </ButtonRow>
      <FinePrint>
        Didn&apos;t ask for this? You can ignore it — nothing happens until the link
        is opened, and it stops working shortly.
      </FinePrint>
    </EmailLayout>
  );
}

// 10 · Owner: client rescheduled / cancelled (variant of #3)
export function OwnerClientChanged({
  headline = "Alex moved to Thursday at 2:00.",
  cardTitle = "Therapy session · 50 min",
  wasLine = "Tuesday, July 14 · 10:00",
  nowLine = "Thursday, July 16 · 2:00 – 2:50" as string | null,
  finePrint = "Your calendar's already updated. Nothing for you to do — we told Alex it's confirmed.",
  handle = "dana",
}: {
  headline?: string;
  cardTitle?: string;
  wasLine?: string;
  /** null for the cancelled variant — there is no new time */
  nowLine?: string | null;
  finePrint?: string;
  handle?: string;
} = {}) {
  return (
    <EmailLayout
      preview={headline}
      footer={`booktimewith.link/${handle} · notification settings`}
    >
      <Headline>{headline}</Headline>
      <DetailCard>
        <CardTitle>{cardTitle}</CardTitle>
        <CardLine>
          Was <span style={bold}>{wasLine}</span>
        </CardLine>
        {nowLine && (
          <CardLine>
            Now <span style={bold}>{nowLine}</span>
          </CardLine>
        )}
      </DetailCard>
      <FinePrint>{finePrint}</FinePrint>
    </EmailLayout>
  );
}

// 11 · Client: owner moved / cancelled your booking (the "polite email")
export function ClientOwnerChanged({
  headline = "Dana had to move Tuesday.",
  lead = "Something came up on Dana's side and your 10:00 on Tuesday won't work — sorry for the shuffle. Here are times that are open this week; pick whichever suits.",
  manageUrl = MANAGE_URL,
  handle = "dana",
}: {
  headline?: string;
  lead?: string;
  manageUrl?: string;
  handle?: string;
} = {}) {
  return (
    <EmailLayout
      preview={headline}
      footer={`booktimewith.link/${handle} · powered by booktimewith.com`}
    >
      <Headline>{headline}</Headline>
      <Lead>{lead}</Lead>
      <ButtonRow>
        {/* Live availability: the manage page reschedule picker. */}
        <Btn kind="ink" href={manageUrl}>Pick a new time</Btn>
      </ButtonRow>
      <FinePrint>
        Prefer to leave it for now? No need to do anything — the old time is
        already released.
      </FinePrint>
    </EmailLayout>
  );
}

// 12 · Welcome (on signup)
export function Welcome({ handle = "dana" }: { handle?: string } = {}) {
  return (
    <EmailLayout
      preview="You're set up — here's your link"
      footer={`booktimewith.link/${handle} · powered by booktimewith.com`}
    >
      <Headline>You&apos;re set up.</Headline>
      <Lead>
        Three things and you&apos;re taking bookings: your link is live at
        booktimewith.link/{handle}, your hours are painted, and clients book in
        three taps with no account. That&apos;s the whole thing.
      </Lead>
      <ButtonRow>
        <Btn kind="ink" href={`https://booktimewith.link/${handle}`}>Open your page</Btn>
      </ButtonRow>
      <FinePrint>
        Your 30-day trial is running — no card needed yet. We&apos;ll send one
        honest reminder before it ends, and that&apos;s the only drip you&apos;ll
        get from us.
      </FinePrint>
    </EmailLayout>
  );
}

// 13 · Owner email verification (booking alerts go here — prove it's yours)
export function OwnerVerifyEmail({
  verifyUrl = "https://booktimewith.com/api/verify-email?token=tok_sample-preview",
  email = "dana@example.com",
}: {
  verifyUrl?: string;
  email?: string;
} = {}) {
  return (
    <EmailLayout
      preview="Confirm your email — one click"
      footer="booktimewith.com · sent once, because we have to"
    >
      <Headline>Confirm your email.</Headline>
      <Lead>
        Booking alerts and your morning summary go to{" "}
        <span style={bold}>{email}</span>. Click once so we know it&apos;s really
        yours — that&apos;s the whole job of this email.
      </Lead>
      <ButtonRow>
        <Btn kind="ink" href={verifyUrl}>Yes, this is my email</Btn>
      </ButtonRow>
      <FinePrint>
        Didn&apos;t sign up for Book Time With? Ignore this and nothing else will
        ever arrive.
      </FinePrint>
    </EmailLayout>
  );
}
