import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/ui";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description:
    "How Book Time With collects, uses, and protects your personal data under UK data protection law.",
};

const LAST_UPDATED = "5 September 2026";

export default function PrivacyPage() {
  return (
    <main id="main-content" className="bg-paper">
      <header className="mx-auto flex max-w-[760px] items-center justify-between px-6 pt-[26px] md:px-10">
        <Link href="/" className="min-w-0 max-w-[158px] sm:max-w-none [&_img]:max-w-full">
          <Wordmark />
        </Link>
        <nav
          aria-label="Legal navigation"
          className="flex items-center gap-4 font-sans text-[13.5px] font-medium text-body sm:gap-[26px]"
        >
          <Link href="/terms" className="inline-flex min-h-[44px] items-center text-body">
            Terms
          </Link>
          <Link
            href="/signin"
            className="inline-flex min-h-[44px] items-center rounded-[5px] bg-ink px-[18px] py-[9px] font-semibold text-paper hover:text-paper"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <article className="prose-legal mx-auto max-w-[760px] px-6 pb-20 pt-14 md:px-10">
        {/* <!-- NOTE: This Privacy Notice is a starting template based on the product's
             actual data practices. It should be reviewed by legal counsel before
             relying on it. --> */}
        <h1 className="font-serif text-[32px] font-normal leading-[1.2] tracking-[-.01em] md:text-[40px]">
          Privacy Notice
        </h1>
        <p className="mt-3 font-sans text-[13px] text-faint">
          Last updated: {LAST_UPDATED}
        </p>

        <Section title="Who we are">
          <p>
            Book Time With is operated by Ryan Johnson trading as Book Time With, based in the
            United Kingdom.{" "}
            {/* TODO: If Ryan incorporates, replace the above with the registered company name
                and Companies House number. */}
            We are the data controller for personal data collected through{" "}
            <a href="https://booktimewith.com">booktimewith.com</a> (the owner
            application) and <a href="https://booktimewith.link">booktimewith.link</a>{" "}
            (the public booking pages).
          </p>
          <p>
            <strong>Contact:</strong>{" "}
            <a href="mailto:privacy@booktimewith.com">privacy@booktimewith.com</a>
          </p>
        </Section>

        <Section title="What data we collect">
          <h3>Owner account data</h3>
          <p>
            When you sign up as an owner, we collect and process:
          </p>
          <ul>
            <li>Email address (used for passwordless sign-in, billing, and notifications)</li>
            <li>Display name and booking handle (public on your booking page)</li>
            <li>Service name, duration, and location settings</li>
            <li>Weekly availability and time-off periods</li>
            <li>Timezone preference</li>
            <li>Notification preferences</li>
            <li>Billing currency preference</li>
          </ul>

          <h3>Client booking data</h3>
          <p>
            When someone books through your page, we collect:
          </p>
          <ul>
            <li>Client name and email address</li>
            <li>Preferred timezone</li>
            <li>Address (for in-person appointments, if required by the service)</li>
            <li>Booking date, time, and service selected</li>
            <li>Booking status and history (confirmed, moved, cancelled)</li>
          </ul>

          <h3>Calendar connection data</h3>
          <p>
            If you connect Google Calendar or Microsoft Outlook:
          </p>
          <ul>
            <li>OAuth access and refresh tokens (encrypted at rest with a dedicated key)</li>
            <li>Calendar free/busy information (used to block unavailable slots)</li>
            <li>Calendar event IDs (to sync booking events)</li>
          </ul>

          <h3>Billing data</h3>
          <p>
            For paid subscriptions, we store references to your Stripe account:
          </p>
          <ul>
            <li>Stripe customer ID</li>
            <li>Stripe subscription ID and status</li>
          </ul>
          <p>
            Payment card details are held directly by Stripe; we do not store card numbers.
          </p>

          <h3>Technical and security data</h3>
          <ul>
            <li>IP address and request metadata (for rate limiting and abuse prevention)</li>
            <li>Cloudflare Turnstile challenge tokens (to prevent automated abuse on booking forms)</li>
            <li>Email delivery status and logs (stored temporarily)</li>
            <li>Session tokens (signed, stateless cookies for owner authentication)</li>
            <li>Email verification tokens (single-use links to confirm owner email addresses)</li>
          </ul>
        </Section>

        <Section title="How we use your data">
          <p>We process personal data for these purposes:</p>

          <h3>To provide the booking service (contract)</h3>
          <ul>
            <li>Creating and managing owner accounts</li>
            <li>
              Verifying owner email addresses — we send a verification link when you
              publish your booking page and when you change your email address; your
              public booking page does not accept client bookings until your email is
              verified (you can resend the verification link from Settings)
            </li>
            <li>Publishing booking pages and handling appointments</li>
            <li>Sending confirmation emails, reminders, and schedule change notifications</li>
            <li>Syncing with connected calendars</li>
            <li>Processing subscription payments through Stripe</li>
          </ul>

          <h3>To protect against abuse (legitimate interests)</h3>
          <ul>
            <li>Rate limiting booking and sign-in requests</li>
            <li>Detecting and preventing fraudulent bookings</li>
            <li>Maintaining security logs</li>
          </ul>

          <h3>To communicate essential service information (legitimate interests)</h3>
          <ul>
            <li>Trial expiry notices and billing reminders</li>
            <li>Service updates affecting your account</li>
          </ul>
          <p>
            We do not send marketing emails. The only scheduled messages are booking
            notifications, morning summaries (opt-in), and billing notices.
          </p>
        </Section>

        <Section title="Lawful basis">
          <p>
            We rely on the following lawful bases under UK GDPR:
          </p>
          <ul>
            <li>
              <strong>Contract:</strong> Processing necessary to provide the booking
              service you signed up for.
            </li>
            <li>
              <strong>Legitimate interests:</strong> Abuse prevention, security logging,
              and essential service communications. We have assessed that these interests
              do not override your rights.
            </li>
          </ul>
        </Section>

        <Section title="Data retention">
          <h3>Owner account data</h3>
          <p>
            Your account data is retained while your subscription is active. If you cancel,
            your account settings and booking history are retained for{" "}
            <strong>90 days</strong> after your paid access ends, allowing you to reactivate
            if you change your mind. After this period, your account is permanently deleted.
          </p>

          <h3>Client booking data</h3>
          <p>
            Client personal data (name, email, address, timezone, and manage tokens) is
            retained for <strong>730 days</strong> (two years) after each appointment ends.
            After this period, client-identifying information is automatically removed while
            anonymous booking history (service, date, time, status) is retained for the
            owner&apos;s business records.
          </p>

          <h3>Technical logs</h3>
          <p>
            Rate-limit counters expire within days. Email delivery logs are retained only
            as long as needed for troubleshooting and are removed with the related booking
            data.
          </p>

          <h3>Backups</h3>
          <p>
            Database backups follow the same retention schedule. Deleted data may persist
            in backups for up to 30 days beyond the stated retention periods.
          </p>
        </Section>

        <Section title="Who we share data with">
          <p>
            We use the following service providers (sub-processors) to operate Book Time With:
          </p>

          <h3>Stripe</h3>
          <p>
            Processes subscription payments. Receives owner email and payment information.
            Stripe is a US company with EU/UK standard contractual clauses in place.{" "}
            <a href="https://stripe.com/gb/privacy" target="_blank" rel="noopener noreferrer">
              Stripe Privacy Policy
            </a>
          </p>

          <h3>Cloudflare</h3>
          <p>
            Provides CDN, email sending infrastructure, and Turnstile bot protection.
            Receives request metadata and email content for delivery.{" "}
            <a href="https://www.cloudflare.com/en-gb/privacypolicy/" target="_blank" rel="noopener noreferrer">
              Cloudflare Privacy Policy
            </a>
          </p>

          <h3>Google (when calendar connected)</h3>
          <p>
            Syncs booking events to Google Calendar and reads free/busy information.
            Receives appointment details for connected owners only.{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
              Google Privacy Policy
            </a>
          </p>

          <h3>Microsoft (when calendar connected)</h3>
          <p>
            Syncs booking events to Outlook Calendar and reads free/busy information.
            Receives appointment details for connected owners only.{" "}
            <a href="https://privacy.microsoft.com/en-gb/privacystatement" target="_blank" rel="noopener noreferrer">
              Microsoft Privacy Statement
            </a>
          </p>

          <h3>Hosting provider</h3>
          <p>
            The application and database are hosted on infrastructure in the EU/UK.
            The hosting provider has access to server logs and database backups as
            part of infrastructure management.
          </p>

          <p className="mt-6">
            We do not sell personal data or share it with advertisers.
          </p>
        </Section>

        <Section title="International transfers">
          <p>
            Some of our sub-processors (Stripe, Google, Microsoft, Cloudflare) are US-based
            companies. For transfers of personal data outside the UK, we rely on:
          </p>
          <ul>
            <li>UK adequacy decisions where applicable</li>
            <li>
              Standard Contractual Clauses (SCCs) approved by the UK Information
              Commissioner&apos;s Office
            </li>
          </ul>
        </Section>

        <Section title="Cookies and local storage">
          <p>
            Book Time With uses only essential cookies required for the service to function:
          </p>
          <ul>
            <li>
              <strong>Session cookie</strong> (booktimewith.com only): A signed token that
              keeps you signed in as an owner. Contains no personal data beyond a session
              identifier.
            </li>
            <li>
              <strong>Turnstile cookies</strong> (booktimewith.link): Cloudflare Turnstile
              may set cookies when presenting a challenge to verify a booking request is
              not automated.
            </li>
          </ul>
          <p>
            We do not use analytics cookies, advertising trackers, or third-party marketing
            cookies.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            Under UK data protection law, you have the right to:
          </p>
          <ul>
            <li>
              <strong>Access:</strong> Request a copy of the personal data we hold about you.
            </li>
            <li>
              <strong>Rectification:</strong> Ask us to correct inaccurate data.
            </li>
            <li>
              <strong>Erasure:</strong> Ask us to delete your data where there is no
              compelling reason to keep it.
            </li>
            <li>
              <strong>Restriction:</strong> Ask us to restrict processing in certain
              circumstances.
            </li>
            <li>
              <strong>Portability:</strong> Request your data in a structured, machine-readable
              format. Owners can export bookings as CSV from the app.
            </li>
            <li>
              <strong>Objection:</strong> Object to processing based on legitimate interests.
            </li>
          </ul>
          <p>
            To exercise any of these rights, email{" "}
            <a href="mailto:privacy@booktimewith.com">privacy@booktimewith.com</a>.
          </p>
        </Section>

        <Section title="Data controller and processor roles">
          <p>
            <strong>For owner accounts:</strong> Book Time With is the data controller.
          </p>
          <p>
            <strong>For client booking data:</strong> The owner (service provider) is
            typically the data controller for their clients&apos; booking information,
            determining why and how client data is used for their business. Book Time With
            acts as a data processor, processing client data on the owner&apos;s behalf
            to deliver the booking service.
          </p>
          <p>
            Owners requiring a formal Data Processing Agreement should contact{" "}
            <a href="mailto:privacy@booktimewith.com">privacy@booktimewith.com</a>.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Book Time With is not directed at children under 16. We do not knowingly
            collect personal data from children. If you believe we have inadvertently
            collected such data, please contact us to have it removed.
          </p>
        </Section>

        <Section title="Complaints">
          <p>
            If you are unhappy with how we handle your data, please contact us first at{" "}
            <a href="mailto:privacy@booktimewith.com">privacy@booktimewith.com</a>.
          </p>
          <p>
            You also have the right to lodge a complaint with the UK Information
            Commissioner&apos;s Office (ICO):
          </p>
          <p>
            <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer">
              ico.org.uk/make-a-complaint
            </a>
            <br />
            Helpline: 0303 123 1113
          </p>
        </Section>

        <Section title="Changes to this notice">
          <p>
            We may update this Privacy Notice from time to time. Material changes will be
            communicated to account holders by email. The &quot;last updated&quot; date at
            the top indicates when this notice was last revised.
          </p>
        </Section>

        <footer className="mt-16 border-t border-line-soft pt-6">
          <div className="flex flex-col gap-3 font-sans text-[12px] text-faint sm:flex-row sm:items-center sm:justify-between">
            <div>© 2026 booktimewith.com</div>
            <div className="flex gap-5">
              <Link href="/privacy" className="text-faint underline">
                Privacy Notice
              </Link>
              <Link href="/terms" className="text-faint">
                Terms of Service
              </Link>
            </div>
          </div>
        </footer>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-[22px] font-semibold leading-[1.3] tracking-[-.005em]">
        {title}
      </h2>
      <div className="prose-section mt-4 space-y-4 font-sans text-[15px] leading-[1.7] text-body [&_h3]:mt-6 [&_h3]:font-sans [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:text-ink [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-bronze [&_a]:underline">
        {children}
      </div>
    </section>
  );
}
