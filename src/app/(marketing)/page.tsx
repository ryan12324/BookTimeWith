import Link from "next/link";
import { Wordmark } from "@/components/ui";
import { ClaimInput } from "@/components/landing/ClaimInput";
import { HeroBookingCard } from "@/components/landing/HeroBookingCard";
import { PricingCard } from "@/components/landing/PricingCard";

const SAID_NO_TO = [
  "CRM pipelines",
  "AI receptionists",
  "Lead routing",
  "Marketing automations",
  "Gift cards & memberships",
  "40-question intake forms",
];

const STEPS = [
  {
    n: "01",
    title: "Claim your link",
    body: "booktimewith.link/you — your own page, on its own domain. Name your service, set the length. That's the “onboarding.”",
  },
  {
    n: "02",
    title: "Mark when you work",
    body: "Paint your weekly hours on one screen. Connect Google or Outlook so busy time blocks itself.",
  },
  {
    n: "03",
    title: "Send the link",
    body: "Text it, put it in your email signature, tape it to your door. Clients book in three taps, no account.",
  },
];

export default function LandingPage() {
  return (
    <main className="bg-paper">
      {/* NAV */}
      <div className="mx-auto flex max-w-[1080px] items-center justify-between px-6 pt-[26px] md:px-10">
        <Wordmark />
        <div className="flex items-center gap-4 font-sans text-[13.5px] font-medium text-body sm:gap-[26px]">
          <Link href="#how" className="hidden text-body sm:inline">
            How it works
          </Link>
          <Link href="#pricing" className="hidden text-body sm:inline">
            Pricing
          </Link>
          <Link
            href="#claim"
            className="rounded-[5px] bg-ink px-[18px] py-[9px] font-semibold text-paper hover:text-paper"
          >
            Get your link
          </Link>
        </div>
      </div>

      {/* HERO */}
      <div className="mx-auto grid max-w-[1080px] items-center gap-12 px-6 pb-[72px] pt-14 md:grid-cols-[1.1fr_.9fr] md:gap-16 md:px-10 md:pt-[88px]">
        <div>
          <h1 className="font-serif text-[40px] font-normal leading-[1.1] tracking-[-.015em] text-balance md:text-[54px]">
            The un-software for booking clients.
          </h1>
          <p className="mt-5 max-w-[440px] font-sans text-[16.5px] leading-[1.65] text-body text-pretty">
            One link. Your availability. Clients pick a time and you show up. We
            deleted everything else on purpose.
          </p>
          <div id="claim" className="mt-8 scroll-mt-24">
            <ClaimInput />
          </div>
          <div className="mt-[10px] font-sans text-[12px] text-faint">
            Live in 5 minutes · 30 days free, no card needed
          </div>
          <div className="mt-10 max-w-[420px] border-t border-line-soft pt-[22px] font-serif text-[19px] leading-[1.75] text-body text-pretty">
            <span className="font-semibold text-ink">Five</span> minutes to set
            up. <span className="font-semibold text-ink">One</span> settings
            page. <span className="font-semibold text-ink">Zero</span> accounts
            for your clients — and zero features you&apos;ll never use.
          </div>
        </div>
        <HeroBookingCard />
      </div>

      {/* WHAT WE DELETED */}
      <div className="bg-ink text-paper">
        <div className="mx-auto max-w-[1080px] px-6 py-[72px] md:px-10">
          <h2 className="max-w-[540px] font-serif text-[26px] font-normal leading-[1.2] tracking-[-.01em] text-balance md:text-[32px]">
            Everything we said no to, so you don&apos;t have to.
          </h2>
          <div className="mt-9 grid grid-cols-1 gap-x-10 gap-y-[2px] font-sans text-[14.5px] leading-[2.2] text-faint sm:grid-cols-2 md:grid-cols-3">
            {SAID_NO_TO.map((item) => (
              <div key={item}>
                <span className="text-body">✕</span> {item}
              </div>
            ))}
          </div>
          <div className="mt-9 grid grid-cols-1 gap-x-10 gap-y-[2px] border-t border-ink-soft pt-7 font-sans text-[14.5px] font-medium leading-[2.2] text-paper sm:grid-cols-2 md:grid-cols-3">
            <div>
              <span className="text-bronze">✓</span> Clients book time slots
            </div>
            <div>
              <span className="text-bronze">✓</span> Calendar sync, both ways
            </div>
            <div>
              <span className="text-bronze">✓</span> Reminders that stop no-shows
            </div>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div id="how" className="mx-auto max-w-[1080px] scroll-mt-8 px-6 py-20 md:px-10">
        <h2 className="font-serif text-[26px] font-normal leading-[1.2] tracking-[-.01em] md:text-[32px]">
          Set up in less time than a coffee break.
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n}>
              <div className="mb-3 font-sans text-[12px] font-semibold tracking-wider text-bronze">
                {s.n}
              </div>
              <div className="font-serif text-[17px] font-semibold">{s.title}</div>
              <p className="mt-2 font-sans text-[14px] leading-[1.6] text-body text-pretty">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* QUOTE */}
      <div className="mx-auto max-w-[1080px] px-6 pb-20 md:px-10">
        <div className="max-w-[680px] border-t border-line-soft pt-14">
          <blockquote className="font-serif text-[25px] font-normal leading-[1.45] tracking-[-.005em] text-pretty">
            &ldquo;I spent a weekend trying to configure the last one. This took
            the time between two clients.&rdquo;
          </blockquote>
          <div className="mt-4 font-sans text-[13px] font-medium text-body">
            Marcus Okafor · Leadership coach
          </div>
        </div>
      </div>

      {/* PRICING */}
      <div
        id="pricing"
        className="scroll-mt-8 border-y border-line-soft bg-tint"
      >
        <div className="mx-auto max-w-[1080px] px-6 py-[72px] md:px-10">
          <h2 className="font-serif text-[26px] font-normal leading-[1.2] tracking-[-.01em] md:text-[32px]">
            One price. Obviously.
          </h2>
          <PricingCard />
          <div className="mt-5 font-sans text-[12.5px] text-faint">
            Starts with 30 days free. No credit card, no &ldquo;talk to
            sales,&rdquo; no feature grid — there aren&apos;t enough features to
            make a grid.
          </div>
        </div>
      </div>

      {/* FOOTER CTA */}
      <div className="mx-auto max-w-[1080px] px-6 pb-[72px] pt-20 text-center md:px-10">
        <h2 className="font-serif text-[30px] font-normal leading-[1.15] tracking-[-.015em] text-balance md:text-[38px]">
          Boring software that just works.
        </h2>
        <div className="mt-6">
          <ClaimInput center />
        </div>
        <div className="mt-[52px] flex flex-col items-center justify-between gap-3 border-t border-line-soft pt-6 font-sans text-[12px] text-faint sm:flex-row">
          <div>© 2026 booktimewith.com</div>
          <div className="flex gap-5">
            <Link href="#pricing" className="text-faint">
              Pricing
            </Link>
            <Link href="#how" className="text-faint">
              How it works
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
