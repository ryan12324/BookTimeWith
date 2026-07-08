import { Section, Text } from "@react-email/components";
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

/* ── Booking set ─────────────────────────────────────────────── */

// 1 · Client confirmation (on booking)
export function ClientConfirmation() {
  return (
    <EmailLayout
      preview="You're booked — Tuesday, July 14 at 10:00"
      footer="Booked at booktimewith.link/dana · powered by booktimewith.com"
    >
      <Headline>You&apos;re booked, Alex.</Headline>
      <DetailCard>
        <CardTitle>Therapy session with Dana Whitfield</CardTitle>
        <CardLine>
          <span style={bold}>Tuesday, July 14</span> · 10:00 – 10:50
        </CardLine>
        <CardLine>Video call — the link arrives with your reminder</CardLine>
      </DetailCard>
      <ButtonRow>
        <Btn kind="ink">Add to calendar</Btn>
        <span style={{ display: "inline-block", width: 10 }} />
        <Btn kind="outline">Change or cancel</Btn>
      </ButtonRow>
      <FinePrint>
        Plans change — the button above lets you pick a new time or cancel in two
        taps. No account, no phone call needed.
      </FinePrint>
    </EmailLayout>
  );
}

// 2 · Client reminder (24h before)
export function ClientReminder() {
  return (
    <EmailLayout
      preview="Tomorrow at 10:00 — your session with Dana"
      footer="Booked at booktimewith.link/dana · powered by booktimewith.com"
    >
      <Headline>See you tomorrow at 10:00.</Headline>
      <DetailCard>
        <CardTitle>Therapy session with Dana Whitfield</CardTitle>
        <CardLine>
          <span style={bold}>Tuesday, July 14</span> · 10:00 – 10:50
        </CardLine>
        <Section style={{ marginTop: 14 }}>
          <Btn kind="bronze-block">Join video call</Btn>
        </Section>
      </DetailCard>
      <ButtonRow>
        <Btn kind="outline">Change or cancel</Btn>
        <span
          style={{ marginLeft: 12, fontFamily: SANS, fontSize: 12, color: "#a89f90" }}
        >
          Free until 24 hours before
        </span>
      </ButtonRow>
    </EmailLayout>
  );
}

// 3 · Owner new booking
export function OwnerNewBooking() {
  return (
    <EmailLayout
      preview="New booking — Alex Martin, Tue Jul 14 at 10:00"
      footer="booktimewith.link/dana · notification settings"
    >
      <Headline>Alex Martin booked you.</Headline>
      <DetailCard>
        <CardTitle>Therapy session · 50 min</CardTitle>
        <CardLine>
          <span style={bold}>Tuesday, July 14</span> · 10:00 – 10:50
        </CardLine>
        <CardLine>Alex Martin · alex@example.com</CardLine>
      </DetailCard>
      <ButtonRow>
        <Btn kind="outline">Reschedule</Btn>
        <span style={{ display: "inline-block", width: 10 }} />
        <Btn kind="outline">Cancel</Btn>
      </ButtonRow>
      <FinePrint>
        It&apos;s already on your calendar. If you reschedule or cancel, Alex gets
        a polite email with your available times — you never have to write it.
      </FinePrint>
    </EmailLayout>
  );
}

// 4 · Owner morning summary
export function OwnerMorningSummary() {
  const rows = [
    { time: "10:00", name: "Alex Martin" },
    { time: "1:00", name: "Priya Shah" },
    { time: "3:30", name: "Sam Reed" },
  ];
  return (
    <EmailLayout
      preview="Today: 3 sessions, first at 10:00"
      footer="booktimewith.link/dana · notification settings"
    >
      <Headline>Tuesday: three sessions.</Headline>
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
                    color: "#a89f90",
                  }}
                >
                  Therapy session
                </td>
              </tr>
            </tbody>
          </table>
        ))}
      </Section>
      <ButtonRow>
        <Btn kind="outline">Open your day</Btn>
        <span style={{ marginLeft: 12, fontFamily: SANS, fontSize: 12, color: "#a89f90" }}>
          Everyone&apos;s been reminded already
        </span>
      </ButtonRow>
    </EmailLayout>
  );
}

/* ── Billing set ─────────────────────────────────────────────── */

// 5 · Trial ending (7 days before)
export function TrialEnding() {
  return (
    <EmailLayout
      preview="Your free month ends Monday, August 3"
      footer="booktimewith.link/dana · billing settings"
    >
      <Headline>Your free month ends Monday.</Headline>
      <Lead>
        Since July 3 your link has taken <span style={bold}>14 bookings</span>. If
        that&apos;s been useful, keeping it is £6 a month — add a card and nothing
        changes.
      </Lead>
      <ButtonRow>
        <Btn kind="ink">Add a card — £6/mo</Btn>
      </ButtonRow>
      <FinePrint>
        If you do nothing, your booking page pauses on August 3. Your link and
        settings are kept for 90 days, so you can pick up where you left off.
      </FinePrint>
    </EmailLayout>
  );
}

// 6 · Receipt (monthly)
export function Receipt() {
  return (
    <EmailLayout preview="Receipt — £6.00, August" footer="booktimewith.link/dana · billing settings">
      <Headline>Paid. Nothing to do.</Headline>
      <DetailCard>
        <table width="100%" cellPadding={0} cellSpacing={0}>
          <tbody>
            <tr>
              <td style={{ fontFamily: SANS, fontSize: 14, color: "#6b6357" }}>
                booktimewith · August 2026
              </td>
              <td style={{ fontFamily: SANS, fontSize: 14, textAlign: "right", ...bold }}>
                £6.00
              </td>
            </tr>
            <tr>
              <td style={{ paddingTop: 8, fontFamily: SANS, fontSize: 12.5, color: "#a89f90" }}>
                Visa ending 4242 · August 3
              </td>
              <td
                style={{
                  paddingTop: 8,
                  fontFamily: SANS,
                  fontSize: 12.5,
                  textAlign: "right",
                  color: "#a89f90",
                }}
              >
                VAT included
              </td>
            </tr>
          </tbody>
        </table>
      </DetailCard>
      <ButtonRow>
        <Btn kind="outline">Download invoice (PDF)</Btn>
        <span style={{ marginLeft: 14, fontFamily: SANS, fontSize: 12, color: "#a89f90" }}>
          For your accountant
        </span>
      </ButtonRow>
    </EmailLayout>
  );
}

// 7 · Payment failed
export function PaymentFailed() {
  return (
    <EmailLayout
      preview="Your card didn't go through — no rush"
      footer="booktimewith.link/dana · billing settings"
    >
      <Headline>Your card didn&apos;t go through.</Headline>
      <Lead>
        It happens — expired card, new bank.{" "}
        <span style={bold}>Your booking page keeps working for 14 days</span> while
        we retry, so no client will notice anything.
      </Lead>
      <ButtonRow>
        <Btn kind="ink">Update card</Btn>
      </ButtonRow>
      <FinePrint>
        We&apos;ll retry on August 6 and August 10. If it still fails, your page
        pauses — nothing is deleted.
      </FinePrint>
    </EmailLayout>
  );
}

// 8 · Cancelled
export function Cancelled() {
  return (
    <EmailLayout
      preview="Cancelled — your page runs until September 3"
      footer="booktimewith.link/dana · come back anytime"
    >
      <Headline>Done — you&apos;re cancelled.</Headline>
      <Lead>
        No wind-down tricks: you&apos;ve paid to September 3, so your page works
        until then. Booked appointments still happen and reminders still go out.
      </Lead>
      <ButtonRow>
        <Btn kind="outline">Export your bookings (CSV)</Btn>
      </ButtonRow>
      <FinePrint>
        We keep your link and settings for 90 days in case you change your mind.
        After that, everything is deleted — properly.
      </FinePrint>
    </EmailLayout>
  );
}

/* ── Written in the same voice (not designed — README 9–12) ─────── */

// 9 · Owner sign-in magic link
export function OwnerSignIn() {
  return (
    <EmailLayout preview="Here's your sign-in link" footer="booktimewith.com · you have no password — this is the login">
      <Headline>Here&apos;s your sign-in link.</Headline>
      <Lead>
        No password to remember — tap the button and you&apos;re in. It works once
        and expires in 15 minutes.
      </Lead>
      <ButtonRow>
        <Btn kind="ink">Sign in to booktimewith.com</Btn>
      </ButtonRow>
      <FinePrint>
        Didn&apos;t ask for this? You can ignore it — nothing happens until the link
        is opened, and it stops working shortly.
      </FinePrint>
    </EmailLayout>
  );
}

// 10 · Owner: client rescheduled / cancelled (variant of #3)
export function OwnerClientChanged() {
  return (
    <EmailLayout
      preview="Alex Martin moved to Thursday at 2:00"
      footer="booktimewith.link/dana · notification settings"
    >
      <Headline>Alex moved to Thursday at 2:00.</Headline>
      <DetailCard>
        <CardTitle>Therapy session · 50 min</CardTitle>
        <CardLine>
          Was <span style={bold}>Tuesday, July 14 · 10:00</span>
        </CardLine>
        <CardLine>
          Now <span style={bold}>Thursday, July 16 · 2:00 – 2:50</span>
        </CardLine>
      </DetailCard>
      <FinePrint>
        Your calendar&apos;s already updated. Nothing for you to do — we told Alex
        it&apos;s confirmed.
      </FinePrint>
    </EmailLayout>
  );
}

// 11 · Client: owner moved / cancelled your booking (the "polite email")
export function ClientOwnerChanged() {
  return (
    <EmailLayout
      preview="Dana had to move your Tuesday session"
      footer="booktimewith.link/dana · powered by booktimewith.com"
    >
      <Headline>Dana had to move Tuesday.</Headline>
      <Lead>
        Something came up on Dana&apos;s side and your 10:00 on Tuesday won&apos;t
        work — sorry for the shuffle. Here are times that are open this week; pick
        whichever suits.
      </Lead>
      <ButtonRow>
        <Btn kind="ink">Pick a new time</Btn>
      </ButtonRow>
      <FinePrint>
        Prefer to leave it for now? No need to do anything — the old time is
        already released.
      </FinePrint>
    </EmailLayout>
  );
}

// 12 · Welcome (on signup)
export function Welcome() {
  return (
    <EmailLayout preview="You're set up — here's your link" footer="booktimewith.link/dana · powered by booktimewith.com">
      <Headline>You&apos;re set up.</Headline>
      <Lead>
        Three things and you&apos;re taking bookings: your link is live at
        booktimewith.link/dana, your hours are painted, and clients book in three
        taps with no account. That&apos;s the whole thing.
      </Lead>
      <ButtonRow>
        <Btn kind="ink">Open your page</Btn>
      </ButtonRow>
      <FinePrint>
        Your 30-day trial is running — no card needed yet. We&apos;ll send one
        honest reminder before it ends, and that&apos;s the only drip you&apos;ll
        get from us.
      </FinePrint>
    </EmailLayout>
  );
}
