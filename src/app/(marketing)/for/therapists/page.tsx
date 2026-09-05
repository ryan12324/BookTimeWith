import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/ui";
import { PricingCard } from "@/components/landing/PricingCard";

export const metadata: Metadata = {
  title: "Book Time With — Booking for Therapists & Counsellors",
  description:
    "A booking link therapists can actually send. Paint your session hours, clients pick a slot. No client accounts, no CRM bloat. £6/mo after 30 days free.",
  openGraph: {
    title: "Book Time With — Booking for Therapists",
    description:
      "One link. Clients book. You don't chase. Paint your session hours, share your link, done.",
    type: "website",
  },
};

const FEATURES = [
  "One link in your email signature or directory bio",
  "Clients book without signing up",
  "Control your week on a calendar, not a maze",
  "£6/mo after 30 days free — no card needed",
];

export default function TherapistsPage() {
  return (
    <main id="main-content" className="bg-paper">
      {/* NAV */}
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-6 pt-[26px] md:px-10">
        <Link
          href="/"
          className="min-w-0 max-w-[158px] sm:max-w-none [&_img]:max-w-full"
        >
          <Wordmark />
        </Link>
        <nav
          aria-label="Main navigation"
          className="flex items-center gap-4 font-sans text-[13.5px] font-medium text-body sm:gap-[26px]"
        >
          <Link
            href="/#pricing"
            className="hidden min-h-[44px] items-center text-body sm:inline-flex"
          >
            Pricing
          </Link>
          <Link
            href="/signin?next=/app/setup"
            className="inline-flex min-h-[44px] items-center rounded-[5px] bg-ink px-[18px] py-[9px] font-semibold text-paper hover:text-paper"
          >
            Start free
          </Link>
        </nav>
      </header>

      {/* HERO */}
      <div className="mx-auto max-w-[1080px] px-6 pb-[72px] pt-14 md:px-10 md:pt-[88px]">
        <div className="max-w-[600px]">
          <h1 className="font-serif text-[40px] font-normal leading-[1.1] tracking-[-.015em] text-balance md:text-[54px]">
            A booking link therapists can actually send.
          </h1>
          <p className="mt-5 max-w-[480px] font-sans text-[16.5px] leading-[1.65] text-body text-pretty">
            Paint your session hours. Clients pick a slot. No client accounts,
            no CRM bloat.
          </p>
          <ul className="mt-8 space-y-3 font-sans text-[15px] leading-[1.6] text-body">
            {FEATURES.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-[2px] text-bronze">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-10">
            <Link
              href="/signin?next=/app/setup"
              className="inline-flex min-h-[44px] items-center rounded-[5px] bg-ink px-[22px] py-[14px] font-sans text-[15px] font-semibold text-paper hover:bg-ink-soft"
            >
              Start free
            </Link>
          </div>
        </div>
      </div>

      {/* PITCH */}
      <div className="bg-ink text-paper">
        <div className="mx-auto max-w-[1080px] px-6 py-[72px] md:px-10">
          <h2 className="max-w-[540px] font-serif text-[26px] font-normal leading-[1.2] tracking-[-.01em] text-balance md:text-[32px]">
            One link. Clients book. You don&apos;t chase.
          </h2>
          <p className="mt-5 max-w-[480px] font-sans text-[15px] leading-[1.7] text-paper-muted text-pretty">
            Paint your week. Share booktimewith.link/you. Done.
            <br />
            <br />
            No client portals to explain. No intake forms that scare people off.
            Just a link that works the way you&apos;d hope a link would work.
          </p>
        </div>
      </div>

      {/* PRICING */}
      <div className="border-y border-line-soft bg-tint">
        <div className="mx-auto max-w-[1080px] px-6 py-[72px] md:px-10">
          <h2 className="font-serif text-[26px] font-normal leading-[1.2] tracking-[-.01em] md:text-[32px]">
            Booking without the CRM tax.
          </h2>
          <PricingCard />
          <div className="mt-5 font-sans text-[12.5px] text-faint">
            30 days free, no credit card. No &ldquo;talk to sales&rdquo; — there
            aren&apos;t enough features to warrant a call.
          </div>
        </div>
      </div>

      {/* SOFT FOOTER */}
      <div className="mx-auto max-w-[1080px] px-6 pb-20 pt-14 md:px-10">
        <p className="max-w-[480px] font-sans text-[14px] leading-[1.65] text-body">
          Built for solo practitioners. Calendar sync when you connect Google or
          Outlook.
        </p>
      </div>

      {/* FOOTER */}
      <footer className="mx-auto max-w-[1080px] px-6 pb-[52px] md:px-10">
        <div className="flex flex-col items-start justify-between gap-3 border-t border-line-soft pt-6 font-sans text-[12px] text-faint sm:flex-row sm:items-center">
          <div>© 2026 booktimewith.com</div>
          <div className="flex gap-5">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center text-faint"
            >
              Home
            </Link>
            <Link
              href="https://booktimewith.com/privacy"
              className="inline-flex min-h-[44px] items-center text-faint"
            >
              Privacy
            </Link>
            <Link
              href="https://booktimewith.com/terms"
              className="inline-flex min-h-[44px] items-center text-faint"
            >
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
