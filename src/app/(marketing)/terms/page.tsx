import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/ui";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for Book Time With, the appointment booking service.",
};

const LAST_UPDATED = "5 September 2026";

export default function TermsPage() {
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
          <Link href="/privacy" className="inline-flex min-h-[44px] items-center text-body">
            Privacy
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
        {/* <!-- NOTE: These Terms of Service are a starting template. They should be
             reviewed by legal counsel before relying on them. --> */}
        <h1 className="font-serif text-[32px] font-normal leading-[1.2] tracking-[-.01em] md:text-[40px]">
          Terms of Service
        </h1>
        <p className="mt-3 font-sans text-[13px] text-faint">
          Last updated: {LAST_UPDATED}
        </p>

        <Section title="Agreement to terms">
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your use of Book Time With,
            an appointment booking service operated by Ryan Johnson trading as Book Time
            With (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) from the United Kingdom.
            {/* TODO: If Ryan incorporates, replace with registered company name. */}
          </p>
          <p>
            By creating an account or using the service, you agree to be bound by these
            Terms. If you do not agree, do not use the service.
          </p>
        </Section>

        <Section title="The service">
          <p>
            Book Time With provides a booking link for solo service professionals. You get:
          </p>
          <ul>
            <li>A public booking page at booktimewith.link/your-handle</li>
            <li>Client booking management with email notifications</li>
            <li>Optional calendar synchronisation with Google Calendar or Microsoft Outlook</li>
            <li>Automatic reminders for upcoming appointments</li>
          </ul>
          <p>
            The service is designed for individual service providers. It does not support
            staff scheduling, multiple team members, or shared calendars.
          </p>
        </Section>

        <Section title="Accounts">
          <h3>Owner accounts</h3>
          <p>
            To use the service, you must create an owner account with a valid email
            address. We use passwordless sign-in via email magic links. You are
            responsible for maintaining access to your email account.
          </p>
          <p>
            You may only create one account per person or business entity. Accounts are
            not transferable.
          </p>

          <h3>Client bookings</h3>
          <p>
            Clients who book through your page do not need to create an account. They
            receive a secure link to manage their booking (reschedule or cancel) without
            signing in.
          </p>
        </Section>

        <Section title="Pricing and payment">
          <p>
            Book Time With is a paid subscription service. Current pricing:
          </p>
          <ul>
            <li>£6 per month (GBP)</li>
            <li>$8 per month (USD)</li>
            <li>€7 per month (EUR)</li>
            <li>$12 per month (AUD)</li>
          </ul>
          <p>
            Prices are subject to change. We will notify existing subscribers at least
            30 days before any price increase takes effect on their subscription.
          </p>

          <h3>Free trial</h3>
          <p>
            New accounts start with a 30-day free trial. No credit card is required to
            start the trial. If you do not add a payment method before the trial ends,
            your booking page will be paused (no new bookings accepted), but your account
            and settings remain intact.
          </p>

          <h3>Billing</h3>
          <p>
            Payments are processed by Stripe. By subscribing, you authorise us to charge
            your payment method on a monthly recurring basis. You can update your payment
            method or cancel your subscription at any time through your account settings.
          </p>

          <h3>Cancellation</h3>
          <p>
            You may cancel your subscription at any time. When you cancel:
          </p>
          <ul>
            <li>Your booking page continues to work until the end of your paid period</li>
            <li>Existing appointments proceed normally with reminders</li>
            <li>After the paid period ends, your page pauses and no new bookings are accepted</li>
            <li>
              Your account, settings, and booking history are retained for 90 days,
              allowing you to reactivate
            </li>
            <li>After 90 days, your account and data are permanently deleted</li>
          </ul>

          <h3>Payment failures</h3>
          <p>
            If a payment fails, we will retry according to Stripe&apos;s recovery schedule
            and notify you by email. Your booking page remains active during a 14-day
            grace period. If payment is not recovered, your page will be paused.
          </p>

          <h3>Refunds</h3>
          <p>
            We do not offer refunds for partial months. If you believe you have been
            charged in error, contact us at{" "}
            <a href="mailto:support@booktimewith.com">support@booktimewith.com</a>.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>You agree not to use Book Time With to:</p>
          <ul>
            <li>
              Offer services that are illegal in the United Kingdom or your jurisdiction
            </li>
            <li>Send spam, phishing, or misleading communications</li>
            <li>Impersonate another person or business</li>
            <li>
              Collect client data for purposes unrelated to the booked service
            </li>
            <li>
              Interfere with the service&apos;s operation or attempt to access other
              users&apos; data
            </li>
            <li>
              Use automated tools to create accounts, make bookings, or extract data
            </li>
            <li>
              Post content that is defamatory, obscene, or infringes intellectual
              property rights
            </li>
          </ul>
          <p>
            We may suspend or terminate accounts that violate these terms without notice.
          </p>
        </Section>

        <Section title="Calendar connections">
          <p>
            You may optionally connect Google Calendar or Microsoft Outlook to:
          </p>
          <ul>
            <li>Automatically block busy times on your booking page</li>
            <li>Create calendar events for new bookings</li>
          </ul>
          <p>
            Calendar connections require OAuth authorisation. We request only the minimum
            permissions needed (calendar read/write). You can disconnect your calendar at
            any time from your settings.
          </p>
          <p>
            We are not responsible for calendar synchronisation delays or failures caused
            by the calendar provider. If your calendar connection is degraded or revoked,
            we will notify you by email.
          </p>
        </Section>

        <Section title="Booking management">
          <h3>Booking conflicts</h3>
          <p>
            The service prevents double-booking by checking slot availability at the
            moment of confirmation. However, near-simultaneous bookings or calendar sync
            delays may occasionally result in conflicts. You are responsible for resolving
            any scheduling conflicts with your clients.
          </p>

          <h3>Client changes</h3>
          <p>
            Clients can reschedule or cancel their bookings using their secure manage
            link. You can set a cutoff time before which changes are no longer allowed.
            You can also reschedule or cancel bookings from your dashboard.
          </p>

          <h3>Notifications</h3>
          <p>
            We send transactional emails for booking confirmations, reminders, changes,
            and billing. These cannot be disabled as they are essential to the service.
            You can opt out of morning summary emails in your notification settings.
          </p>
        </Section>

        <Section title="Your responsibilities">
          <p>As an owner, you are responsible for:</p>
          <ul>
            <li>Providing accurate information in your profile and service description</li>
            <li>Maintaining accurate availability on your booking page</li>
            <li>Honouring confirmed appointments or communicating changes promptly</li>
            <li>
              Complying with data protection law for your clients&apos; personal data
              (you act as a data controller for your clients&apos; booking information)
            </li>
            <li>
              Having appropriate insurance and qualifications for the services you offer
            </li>
            <li>Paying applicable taxes on your business income</li>
          </ul>
        </Section>

        <Section title="Intellectual property">
          <p>
            The Book Time With service, including its design, code, and branding, is owned
            by us and protected by intellectual property laws. You may not copy, modify,
            or distribute any part of the service without permission.
          </p>
          <p>
            You retain ownership of any content you provide (service descriptions, profile
            information). By using the service, you grant us a licence to display this
            content on your public booking page and in transactional emails.
          </p>
        </Section>

        <Section title="Availability and support">
          <p>
            We aim to keep the service available at all times but do not guarantee
            uninterrupted access. We may perform maintenance that temporarily affects
            availability.
          </p>
          <p>
            Support is available by email at{" "}
            <a href="mailto:support@booktimewith.com">support@booktimewith.com</a>. We
            respond to enquiries during UK business hours.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the maximum extent permitted by law:
          </p>
          <ul>
            <li>
              The service is provided &quot;as is&quot; without warranties of any kind,
              whether express or implied
            </li>
            <li>
              We are not liable for any indirect, incidental, or consequential damages
              arising from your use of the service
            </li>
            <li>
              Our total liability for any claim related to the service is limited to the
              amount you paid us in the 12 months before the claim arose
            </li>
          </ul>
          <p>
            Nothing in these Terms excludes or limits our liability for death or personal
            injury caused by negligence, fraud, or any other liability that cannot be
            excluded by law.
          </p>

          <h3>Consumer rights</h3>
          <p>
            If you are using the service as a consumer (an individual acting outside your
            trade, business, or profession), you have statutory rights under UK consumer
            law that are not affected by these Terms. Nothing in these Terms is intended
            to limit those rights.
          </p>
        </Section>

        <Section title="Indemnification">
          <p>
            You agree to indemnify and hold us harmless from any claims, losses, or
            expenses (including legal fees) arising from:
          </p>
          <ul>
            <li>Your breach of these Terms</li>
            <li>Your violation of any law or third-party rights</li>
            <li>The services you offer through your booking page</li>
            <li>Disputes between you and your clients</li>
          </ul>
        </Section>

        <Section title="Suspension and termination">
          <p>
            We may suspend or terminate your account immediately if you:
          </p>
          <ul>
            <li>Breach these Terms</li>
            <li>Use the service for illegal activities</li>
            <li>Engage in conduct that harms the service or other users</li>
          </ul>
          <p>
            We may also terminate the service entirely with 30 days&apos; notice. If we
            terminate your account without cause, you will receive a pro-rata refund for
            any prepaid period.
          </p>
        </Section>

        <Section title="Changes to terms">
          <p>
            We may update these Terms from time to time. Material changes will be
            communicated by email at least 30 days before they take effect. Continued use
            of the service after changes take effect constitutes acceptance of the new
            Terms.
          </p>
        </Section>

        <Section title="Governing law and disputes">
          <p>
            These Terms are governed by the laws of England and Wales. Any disputes
            arising from these Terms or your use of the service will be subject to the
            exclusive jurisdiction of the courts of England and Wales.
          </p>
          <p>
            If you are a consumer resident in another part of the UK, you may also bring
            proceedings in the courts of your country of residence.
          </p>
        </Section>

        <Section title="Severability">
          <p>
            If any provision of these Terms is found to be unenforceable, the remaining
            provisions will continue in effect.
          </p>
        </Section>

        <Section title="Entire agreement">
          <p>
            These Terms, together with our{" "}
            <Link href="/privacy">Privacy Notice</Link>, constitute the entire agreement
            between you and Book Time With regarding the service.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these Terms? Contact us at{" "}
            <a href="mailto:support@booktimewith.com">support@booktimewith.com</a>.
          </p>
          <p className="mt-4">
            Ryan Johnson trading as Book Time With
            <br />
            United Kingdom
            {/* TODO: Add registered office address if Ryan incorporates. */}
          </p>
        </Section>

        <footer className="mt-16 border-t border-line-soft pt-6">
          <div className="flex flex-col gap-3 font-sans text-[12px] text-faint sm:flex-row sm:items-center sm:justify-between">
            <div>© 2026 booktimewith.com</div>
            <div className="flex gap-5">
              <Link href="/privacy" className="text-faint">
                Privacy Notice
              </Link>
              <Link href="/terms" className="text-faint underline">
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
