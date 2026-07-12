import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";
import PublicLayout from "@/app/(public)/layout";
import { DurationStepper } from "@/components/DurationStepper";
import { outboxDeliveryLabel } from "@/components/app/Outbox";
import { PlanSection, VerificationBanner } from "@/components/app/Settings";
import { CardShell } from "@/components/client/CardShell";
import { DatePager, DayTabs, SlotGrid } from "@/components/client/Picker";
import { RouteError } from "@/components/RouteError";
import {
  CalendarDownloadLinks,
  UnverifiedBookingPage,
} from "@/components/client/BookingFlow";
import { PricingCard } from "@/components/landing/PricingCard";
import { DEFAULT_OWNER } from "@/lib/mock";
import { reconcileBillingCurrencyConflict } from "@/lib/store";
import { T } from "@/lib/tokens";
import { EMAILS } from "@/emails/registry";
import {
  ClientConfirmation,
  OwnerMorningSummary,
  OwnerNewBooking,
  PaymentFailed,
  Receipt,
  TrialEnding,
} from "@/emails/templates";

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("UI accessibility contracts", () => {
  it("keeps text and control tokens above WCAG AA contrast thresholds", () => {
    const lightSurfaces = [T.paper, T.paperDim, "#ffffff"];
    for (const surface of lightSurfaces) {
      expect(contrast(T.faint, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(T.bronze, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(T.line, surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(T.toggleOff, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(T.paper, T.bronze)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(T.paper, T.bronzeHover)).toBeGreaterThanOrEqual(4.5);
  });

  it("disables duration controls at their supported boundaries", () => {
    const atMinimum = renderToStaticMarkup(
      <DurationStepper minutes={15} onChange={vi.fn()} />,
    );
    const atMaximum = renderToStaticMarkup(
      <DurationStepper minutes={240} onChange={vi.fn()} />,
    );

    expect(atMinimum).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Decrease length by 5 minutes"/,
    );
    expect(atMinimum).not.toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Increase length by 5 minutes"/,
    );
    expect(atMaximum).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Increase length by 5 minutes"/,
    );
  });

  it("renders picker choices as pressed-state buttons with touch-sized targets", () => {
    const days = renderToStaticMarkup(
      <DayTabs
        days={[{ dow: "TUE", date: "14 Jul" }, { dow: "WED", date: "15 Jul" }]}
        selected={1}
        onPick={vi.fn()}
      />,
    );
    const slots = renderToStaticMarkup(
      <SlotGrid slots={["9:00am", "1:00pm"]} selected={0} onPick={vi.fn()} />,
    );

    expect(days).toContain('aria-pressed="true"');
    expect(days).toContain("min-h-[44px]");
    expect(slots).toContain('aria-pressed="true"');
    expect(slots).toContain("min-h-[44px]");
  });

  it("keeps virtual meeting choices and links explicit", () => {
    const settings = readFileSync(
      `${process.cwd()}/src/components/app/Settings.tsx`,
      "utf8",
    );
    const confirmation = renderToStaticMarkup(
      <ClientConfirmation meetingLink="https://meet.example/client-room" />,
    );

    expect(settings).toContain("We meet virtually");
    expect(settings).toContain("Default meeting link");
    expect(settings).toContain("add a different link to each booking later");
    expect(confirmation).toContain("Open meeting link");
    expect(confirmation).toContain("https://meet.example/client-room");
  });

  it("makes the full booking window reachable with accessible date paging", () => {
    const firstPage = renderToStaticMarkup(
      <DatePager
        hasEarlier={false}
        hasMore
        onEarlier={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    const laterPage = renderToStaticMarkup(
      <DatePager
        hasEarlier
        hasMore={false}
        onEarlier={vi.fn()}
        onMore={vi.fn()}
      />,
    );

    expect(firstPage).toContain('aria-label="Available date pages"');
    expect(firstPage).toContain("More dates");
    expect(laterPage).toContain("Earlier dates");
    expect(firstPage).toContain("min-h-[44px]");
  });

  it("locks the active subscription currency and explains why", () => {
    const locked = renderToStaticMarkup(
      <PlanSection
        planStatus="active"
        trialEndsAt={null}
        graceUntil={null}
        currency="GBP"
        billingCurrencyLocked
        timezone="Europe/London"
        onCurrencyChange={vi.fn()}
      />,
    );

    expect(locked.match(/disabled=""/g)).toHaveLength(4);
    expect(locked).toContain("Currency is fixed for this Stripe subscription");
    expect(locked).toContain('aria-describedby="');
    expect(locked.match(/min-w-\[44px\]/g)).toHaveLength(4);
  });

  it("keeps every currency choice at least 44 by 44 pixels", () => {
    const pricing = renderToStaticMarkup(<PricingCard />);
    expect(pricing.match(/min-h-\[44px\]/g)).toHaveLength(4);
    expect(pricing.match(/min-w-\[44px\]/g)).toHaveLength(4);
  });

  it("keeps the mobile landing header compact without shrinking touch targets", () => {
    const source = readFileSync(
      `${process.cwd()}/src/app/(marketing)/page.tsx`,
      "utf8",
    );
    expect(source).toContain('max-w-[158px] sm:max-w-none');
    expect(source.match(/hidden min-h-\[44px\][^\n]*sm:inline-flex/g)).toHaveLength(2);
    expect(source).toContain('inline-flex min-h-[44px] items-center');
  });

  it("gives every booking calendar action a touch-sized target", () => {
    const links = renderToStaticMarkup(
      <CalendarDownloadLinks
        event={{
          title: "Consultation",
          start: new Date("2026-08-12T09:00:00Z"),
          end: new Date("2026-08-12T10:00:00Z"),
        }}
      />,
    );
    expect(links.match(/min-h-\[44px\]/g)).toHaveLength(3);
    expect(links).toContain("Google");
    expect(links).toContain("Outlook");
    expect(links).toContain(".ics file");
  });

  it("makes unpublished email-verification state explicit to owners and visitors", () => {
    const ownerBanner = renderToStaticMarkup(
      <VerificationBanner
        email="dana@example.test"
        busy={false}
        note={null}
        onResend={vi.fn()}
      />,
    );
    const publicPage = renderToStaticMarkup(
      <UnverifiedBookingPage
        ownerName="Dana Whitfield"
        serviceLine="Therapy · 50 min"
      />,
    );

    expect(ownerBanner).toContain('role="alert"');
    expect(ownerBanner).toContain("Verify your email to publish your booking page");
    expect(ownerBanner).toContain("nobody can see or book them");
    expect(ownerBanner).toContain("Resend verification");
    expect(ownerBanner).toContain("min-h-[44px]");
    expect(publicPage).toContain("This booking page isn&#x27;t live yet");
    expect(publicPage).toContain("verify their email before anyone can book");
  });

  it("rolls back Stripe-owned currency without losing a newer unrelated edit", () => {
    const sent = {
      ...DEFAULT_OWNER,
      setupComplete: true,
      service: "Therapy",
      currency: "EUR" as const,
    };
    const current = {
      ...sent,
      service: "Coaching",
      currency: "AUD" as const,
    };
    const canonical = {
      ...sent,
      currency: "GBP" as const,
      billingCurrencyLocked: true,
    };

    expect(reconcileBillingCurrencyConflict(canonical, sent, current)).toMatchObject({
      service: "Coaching",
      currency: "GBP",
      billingCurrencyLocked: true,
    });
  });

  it("keeps booking identity and route failures semantically discoverable", () => {
    const shell = renderToStaticMarkup(
      <CardShell ownerName="Dana Whitfield" serviceLine="Therapy · 50 min">
        <h1>Choose a time</h1>
      </CardShell>,
    );
    const recovery = renderToStaticMarkup(
      <RouteError error={new Error("private detail")} reset={vi.fn()} />,
    );

    expect(shell).toContain("<header");
    expect(shell).toContain("<h1>Choose a time</h1>");
    expect(recovery).toContain('role="alert"');
    expect(recovery).toContain("<h1");
    expect(recovery).toContain("Try again");
    expect(recovery).not.toContain("private detail");
  });

  it("provides a skip link and one public main landmark", () => {
    const root = renderToStaticMarkup(
      <RootLayout>
        <main id="main-content">Content</main>
      </RootLayout>,
    );
    const publicRoute = renderToStaticMarkup(
      <PublicLayout>
        <h1>Book a time</h1>
      </PublicLayout>,
    );

    expect(root).toContain('href="#main-content"');
    expect(root).toContain("Skip to content");
    expect(publicRoute.match(/<main/g)).toHaveLength(1);
    expect(publicRoute).toContain('id="main-content"');
  });

  it("describes every persisted outbox state truthfully", () => {
    expect(outboxDeliveryLabel("delivered")).toBeNull();
    expect(outboxDeliveryLabel("pending")).toBe("queued for delivery");
    expect(outboxDeliveryLabel("processing")).toBe("delivery in progress");
    expect(outboxDeliveryLabel("failed")).toBe("✗ delivery failed");
    expect(outboxDeliveryLabel("skipped")).toBe(
      "not delivered — no transport configured",
    );
    expect(outboxDeliveryLabel("expired")).toBe(
      "expired or superseded before delivery",
    );
    expect(EMAILS).toHaveLength(13);
  });

  it("keeps each morning-summary row on its booking's service snapshot", () => {
    const summary = renderToStaticMarkup(
      <OwnerMorningSummary
        rows={[
          { time: "9:00", name: "Alex", serviceName: "Original consultation" },
          { time: "11:00", name: "Priya", serviceName: "Renamed service" },
        ]}
      />,
    );

    expect(summary).toContain("Original consultation");
    expect(summary).toContain("Renamed service");
  });

  it("keeps live email copy aligned with billing and delivery state", () => {
    const trial = renderToStaticMarkup(
      <TrialEnding price="$8" endsLong="August 3" />,
    );
    const receipt = renderToStaticMarkup(<Receipt />);
    const failed = renderToStaticMarkup(
      <PaymentFailed pageStatus="Your booking page is paused while billing is overdue." />,
    );
    const ownerBooking = renderToStaticMarkup(<OwnerNewBooking />);
    const summary = renderToStaticMarkup(<OwnerMorningSummary />);

    expect(trial).toContain("$8 a month");
    expect(trial).toContain("Add a card, $8/mo");
    expect(trial).not.toContain("£6 a month");
    expect(trial).not.toContain("90 days");
    expect(receipt).not.toContain("VAT included");
    expect(failed).toContain("Your booking page is paused while billing is overdue.");
    expect(failed).not.toContain("working for 14 days");
    expect(ownerBooking).not.toContain("already on your calendar");
    expect(summary).not.toContain("Everyone&#x27;s been reminded");
  });
});
