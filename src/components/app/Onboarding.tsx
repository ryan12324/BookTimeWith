"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOwnerConfig } from "@/lib/store";
import { openHours } from "@/lib/availability";
import { fmtDuration, fmtHours } from "@/lib/format";
import { DurationStepper } from "@/components/DurationStepper";
import { Toggle } from "@/components/Toggle";
import { AvailabilityGrid, useGridControls } from "@/components/AvailabilityGrid";
import { SectionLabel } from "@/components/ui";
import { browserTimeZone, TimezoneSelect } from "@/components/TimezoneSelect";
import { useHandleCheck } from "@/lib/use-handle-check";
import { T } from "@/lib/tokens";
import type { OwnerConfig } from "@/lib/mock";

type Step = 1 | 2 | 3 | 4;

export function Onboarding() {
  const {
    config,
    update,
    hydrated,
    loadError,
    refresh,
    saveState,
    saveError,
    retrySave,
  } = useOwnerConfig();
  const [step, setStep] = useState<Step>(1);
  const [furthestStep, setFurthestStep] = useState<1 | 2 | 3>(1);
  const [publishing, setPublishing] = useState(false);
  const [retryingLoad, setRetryingLoad] = useState(false);
  const params = useSearchParams();
  const router = useRouter();
  const seeded = useRef(false);
  const zoneSeeded = useRef(false);
  const currencySeeded = useRef(false);
  const previousStep = useRef<Step>(step);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    document.getElementById("setup-step-heading")?.focus();
  }, [step]);

  // Returning owners should resume their work, not re-enter the signup wizard.
  useEffect(() => {
    if (hydrated && !loadError && !publishing && config.setupComplete && step !== 4) {
      router.replace("/app/bookings");
    }
  }, [config.setupComplete, hydrated, loadError, publishing, router, step]);

  // Setup is only live after the server acknowledges the complete config.
  // Until then, keep the owner on the final editable step with honest status.
  useEffect(() => {
    if (publishing && config.setupComplete && saveState === "saved") {
      setStep(4);
      setPublishing(false);
    }
  }, [config.setupComplete, publishing, saveState]);

  // Seed the handle from the landing page's "Claim it" query, once — but only
  // after the store has hydrated, or the localStorage load lands after this
  // write and silently reverts the claimed handle (it did, in dev).
  useEffect(() => {
    if (!hydrated || seeded.current) return;
    seeded.current = true;
    const h = params.get("handle");
    if (h) {
      const clean = h.toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (clean && clean !== "yourname") update({ handle: clean });
    }
  }, [hydrated, params, update]);

  useEffect(() => {
    if (!hydrated || config.setupComplete || zoneSeeded.current) return;
    zoneSeeded.current = true;
    const detected = browserTimeZone();
    if (detected && detected !== config.timezone) update({ timezone: detected });
  }, [config.setupComplete, config.timezone, hydrated, update]);

  useEffect(() => {
    if (!hydrated || config.setupComplete || currencySeeded.current) return;
    currencySeeded.current = true;
    const saved = window.localStorage.getItem("btw-currency");
    if (["GBP", "USD", "EUR", "AUD"].includes(saved ?? "") && saved !== config.currency) {
      update({ currency: saved as OwnerConfig["currency"] });
    }
  }, [config.currency, config.setupComplete, hydrated, update]);

  const advance = (next: Step) => {
    setStep(next);
    if (next <= 3) setFurthestStep((current) => Math.max(current, next) as 1 | 2 | 3);
  };

  const handleShown = (config.handle || "yourname").trim() || "yourname";
  const serviceShown = config.service.trim() || "Session";

  const steps = [
    { num: "01", title: "Claim your link", sub: `booktimewith.link/${handleShown}` },
    { num: "02", title: "Name your service", sub: `${serviceShown} · ${fmtDuration(config.duration)}` },
    { num: "03", title: "Paint your hours", sub: `${fmtHours(openHours(config.cells))} open / week` },
  ];

  if (!hydrated || retryingLoad) {
    return (
      <div role="status" className="mx-auto mt-9 max-w-[680px] rounded-card border border-line-soft bg-white px-6 py-10 text-center font-sans text-[13.5px] text-body shadow-card">
        Loading your setup…
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="mx-auto mt-9 max-w-[680px] rounded-card border border-line-soft bg-white px-6 py-10 text-center shadow-card">
        <h1 className="font-serif text-[24px] tracking-[-.01em]">Your setup couldn&apos;t load.</h1>
        <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setRetryingLoad(true);
            void refresh().finally(() => setRetryingLoad(false));
          }}
          className="mt-3 min-h-[44px] rounded-input px-4 font-sans text-[12.5px] font-semibold text-bronze-ink"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!publishing && config.setupComplete && step !== 4) {
    return (
      <div role="status" className="mx-auto mt-9 max-w-[680px] rounded-card border border-line-soft bg-white px-6 py-10 text-center font-sans text-[13.5px] text-body shadow-card">
        Opening your bookings…
      </div>
    );
  }

  return (
    <div className="mt-9 grid items-start gap-10 md:grid-cols-[220px_1fr]">
      <h1 className="sr-only">Set up your booking page</h1>
      {/* step rail — desktop */}
      <div className="hidden flex-col gap-[2px] md:flex">
        {steps.map((s, i) => {
          const active = step === i + 1;
          return (
            <button
              key={s.num}
              type="button"
              onClick={() => setStep((i + 1) as Step)}
              disabled={i + 1 > furthestStep}
              aria-current={active ? "step" : undefined}
              className="flex min-h-[44px] items-baseline gap-3 rounded-chip px-[14px] py-3 text-left disabled:opacity-50"
              style={{ background: active ? "#fff" : "transparent" }}
            >
              <span className="font-sans text-[12px] font-semibold text-bronze">{s.num}</span>
              <span>
                <span
                  className="block font-sans text-[13.5px] font-semibold"
                  style={{ color: active ? T.ink : T.body }}
                >
                  {s.title}
                </span>
                <span className="mt-[2px] block font-sans text-[11.5px] leading-[1.4] text-faint">
                  {s.sub}
                </span>
              </span>
            </button>
          );
        })}
        <div className="mt-[18px] border-t border-line px-[14px] py-[14px] font-sans text-[12px] leading-[1.6] text-faint text-pretty">
          This is the whole setup. There is no step 4.
        </div>
      </div>

      {/* step rail — mobile progress strip */}
      <div className="flex items-center gap-2 md:hidden">
        {steps.map((s, i) => {
          const active = step === i + 1;
          return (
            <button
              key={s.num}
              type="button"
              onClick={() => setStep((i + 1) as Step)}
              disabled={i + 1 > furthestStep}
              aria-current={active ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${s.title}`}
              className="flex min-h-[44px] items-center gap-2 rounded-chip px-3 py-2 disabled:opacity-50"
              style={{ background: active ? "#fff" : "transparent" }}
            >
              <span className="font-sans text-[12px] font-semibold text-bronze">{s.num}</span>
              {active && (
                <span className="font-sans text-[12.5px] font-semibold text-ink">{s.title}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* panel */}
      <div className="min-h-[380px] rounded-card border border-line-soft bg-white p-5 shadow-card sm:p-8 md:px-9">
        {step === 1 && <StepClaim onNext={() => advance(2)} />}
        {step === 2 && <StepService onNext={() => advance(3)} />}
        {step === 3 && (
          <StepHours
            publishing={publishing}
            publishError={saveState === "error" ? saveError : null}
            onRetry={retrySave}
            onLive={() => {
              // Going live completes setup: Bookings/Settings appear in the
              // nav, and the welcome + email-verification emails go out.
              setPublishing(true);
              update({ setupComplete: true });
            }}
          />
        )}
        {step === 4 && <StepLive handleShown={handleShown} />}
      </div>
    </div>
  );
}

/**
 * Step 1 doubles as the signup — there is no separate registration form.
 * Claiming the link collects the owner's name and email; going live at the
 * end creates the session and sends the welcome + verification emails.
 */
function StepClaim({ onNext }: { onNext: () => void }) {
  const { config, update } = useOwnerConfig();
  const handleShown = (config.handle || "yourname").trim() || "yourname";
  const isDefault = handleShown === "yourname";

  // Live availability check (README: "live endpoint driving the '✓ … is
  // available' hint as the owner types (debounced)").
  const hint = useHandleCheck(isDefault ? "" : handleShown);

  // Email commits on blur — the store autosaves per change, and half-typed
  // addresses shouldn't hit the API.
  const [emailDraft, setEmailDraft] = useState(config.email);
  useEffect(() => setEmailDraft(config.email), [config.email]);
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailDraft.trim());
  const commitEmail = () => {
    const clean = emailDraft.trim();
    if (clean && emailValid && clean !== config.email) update({ email: clean });
  };

  const ready =
    !isDefault &&
    hint?.status === "available" &&
    config.name.trim().length > 0 &&
    emailValid;
  const emailInvalid = emailDraft.trim().length > 0 && !emailValid;

  return (
    <div>
      <h2 id="setup-step-heading" tabIndex={-1} className="font-serif text-[26px] tracking-[-.01em]">Claim your link</h2>
      <p className="mt-2 max-w-[400px] font-sans text-[13.5px] leading-[1.6] text-body">
        This is the address clients will use. It&apos;s yours forever.
      </p>
      <div className="focus-group mt-6 flex max-w-[440px] items-center overflow-hidden rounded-chip border border-line">
        <span className="flex-none py-[14px] pl-4 font-sans text-[15px] text-faint">
          booktimewith.link/
        </span>
        <input
          id="setup-handle"
          value={config.handle}
          onChange={(e) =>
            update({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })
          }
          placeholder="yourname"
          aria-label="Your booking link handle"
          aria-describedby="setup-handle-hint"
          maxLength={30}
          className="min-w-0 flex-1 border-none py-[14px] pl-[2px] pr-4 font-medium text-ink outline-none"
          style={{ fontSize: 15 }}
        />
      </div>
      <div
        id="setup-handle-hint"
        aria-live="polite"
        className="mt-[10px] font-sans text-[12px]"
        style={{
          color:
            isDefault || !hint ? T.body : hint.ok ? T.bronzeHover : T.body,
        }}
      >
        {isDefault
          ? "Letters, numbers and dashes."
          : hint?.msg ?? "Checking availability…"}
        {!isDefault && hint?.status === "error" && (
          <button
            type="button"
            onClick={hint.retry}
            className="ml-2 min-h-[44px] px-1 font-semibold text-bronze-ink"
          >
            Try again
          </button>
        )}
      </div>

      <div className="mt-5 max-w-[440px]">
        <SectionLabel as="label" htmlFor="setup-name" className="mb-2 block">Your name</SectionLabel>
        <input
          id="setup-name"
          value={config.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Dana Whitfield"
          aria-label="Your name"
          autoComplete="name"
          className="w-full rounded-chip border border-line px-4 py-[13px] font-medium text-ink outline-none"
          style={{ fontSize: 15 }}
        />

        <SectionLabel as="label" htmlFor="setup-email" className="mb-2 mt-4 block">Email</SectionLabel>
        <input
          id="setup-email"
          type="email"
          value={emailDraft}
          onChange={(e) => setEmailDraft(e.target.value)}
          onBlur={commitEmail}
          placeholder="you@example.com"
          aria-label="Your email"
          aria-invalid={emailInvalid}
          aria-describedby="setup-email-hint"
          autoComplete="email"
          className="w-full rounded-chip border border-line px-4 py-[13px] font-medium text-ink outline-none"
          style={{ fontSize: 16 }}
        />
        <div
          id="setup-email-hint"
          className="mt-[7px] font-sans text-[11.5px] text-body"
        >
          {emailInvalid
            ? "Enter a complete email address, such as you@example.com."
            : "Booking alerts land here, and it’s how you sign in. No password, ever."}
        </div>
      </div>

      <button
        type="button"
        disabled={!ready}
        onClick={() => {
          commitEmail();
          if (ready) onNext();
        }}
        className="mt-7 rounded-input px-6 py-[13px] font-sans text-[14px] font-semibold text-paper hover:bg-ink-soft"
        style={{ background: ready ? T.ink : T.disabled }}
      >
        Next: what you offer →
      </button>
    </div>
  );
}

function StepService({ onNext }: { onNext: () => void }) {
  const { config, update } = useOwnerConfig();
  const locations = [
    { key: "mine", title: "Clients come to me", sub: "Your address goes in their confirmation" },
    { key: "theirs", title: "I go to clients", sub: "They give their address when booking" },
  ] as const;

  // Every field is required: a named service, and an address when clients come
  // to the owner.
  const ready =
    config.service.trim().length > 0 &&
    (config.location !== "mine" || config.ownerAddress.trim().length > 0);

  return (
    <div>
      <h2 id="setup-step-heading" tabIndex={-1} className="font-serif text-[26px] tracking-[-.01em]">Name your service</h2>
      <p className="mt-2 max-w-[400px] font-sans text-[13.5px] leading-[1.6] text-body">
        One service, deliberately. Name the thing clients come here to book.
      </p>
      <div className="mt-6 max-w-[440px]">
        <SectionLabel as="label" htmlFor="setup-service" className="mb-2 block">Service</SectionLabel>
        <input
          id="setup-service"
          value={config.service}
          onChange={(e) => update({ service: e.target.value })}
          placeholder="Therapy session"
          aria-label="Service name"
          className="w-full rounded-chip border border-line px-4 py-[14px] font-medium text-ink outline-none"
          style={{ fontSize: 15 }}
        />

        <SectionLabel className="mb-2 mt-5">Length</SectionLabel>
        <div className="flex items-center gap-[14px]">
          <DurationStepper
            minutes={config.duration}
            onChange={(m) => update({ duration: m })}
          />
          <span className="font-sans text-[12px] text-body">Any length, in 5-minute steps.</span>
        </div>

        <SectionLabel className="mb-2 mt-5">Where</SectionLabel>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {locations.map((l) => {
            const on = config.location === l.key;
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => update({ location: l.key })}
                aria-pressed={on}
                className="min-h-[44px] rounded-input border px-4 py-[14px] text-left"
                style={{ borderColor: on ? T.ink : T.line, background: on ? T.tintWarm : "#fff" }}
              >
                <div className="font-sans text-[13.5px] font-semibold text-ink">{l.title}</div>
                <div className="mt-[3px] font-sans text-[12px] leading-[1.5] text-body">{l.sub}</div>
              </button>
            );
          })}
        </div>
        {config.location === "mine" && (
          <div className="mt-3">
            <label htmlFor="setup-address" className="sr-only">
              Your address
            </label>
            <input
              id="setup-address"
              value={config.ownerAddress}
              onChange={(e) => update({ ownerAddress: e.target.value })}
              placeholder="Your address, e.g. 12 Harley Street, London"
              className="w-full rounded-chip border border-line px-[15px] py-3 font-medium text-ink outline-none"
              style={{ fontSize: 13.5 }}
            />
            <div className="mt-[7px] font-sans text-[11.5px] text-body">
              Only shared after someone books.
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={!ready}
        onClick={() => ready && onNext()}
        className="mt-7 rounded-input px-6 py-[13px] font-sans text-[14px] font-semibold text-paper hover:bg-ink-soft"
        style={{ background: ready ? T.ink : T.disabled }}
      >
        Next: when you work →
      </button>
    </div>
  );
}

function StepHours({
  onLive,
  publishing,
  publishError,
  onRetry,
}: {
  onLive: () => void;
  publishing: boolean;
  publishError: string | null;
  onRetry: () => void;
}) {
  const { config, update } = useOwnerConfig();
  const g = useGridControls();
  // Revalidate the full signup at the commit point, even if someone navigated back.
  const ready =
    /^[a-z0-9-]{3,30}$/.test(config.handle) &&
    config.name.trim().length > 0 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.email) &&
    config.service.trim().length > 0 &&
    (config.location !== "mine" || config.ownerAddress.trim().length > 0) &&
    openHours(config.cells) > 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="setup-step-heading" tabIndex={-1} className="font-serif text-[26px] tracking-[-.01em]">Paint when you work</h2>
          <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
            Tap half-hours on a phone, or click and drag with a mouse. Everything
            else stays closed.
          </p>
        </div>
        <div className="font-sans text-[12px] text-body">{g.summary}</div>
      </div>

      <TimezoneSelect
        value={config.timezone}
        onChange={(timezone) => update({ timezone })}
        className="mt-5"
        description="We detected this from your device. Your painted hours stay fixed in this timezone."
      />

      <div className="mt-[18px] flex items-center gap-[10px]">
        <button
          type="button"
          onClick={g.toggleWeekends}
          role="switch"
          aria-checked={g.weekends}
          className="flex min-h-[44px] items-center gap-[9px] rounded-input border px-[14px] py-[9px]"
          style={{
            borderColor: g.weekends ? T.bronze : T.line,
            background: g.weekends ? T.tintWarm : "#fff",
          }}
        >
          <Toggle on={g.weekends} />
          <span className="font-sans text-[12.5px] font-semibold text-ink">We&apos;re open weekends</span>
        </button>
      </div>

      <button
        type="button"
        onClick={g.startEarlier}
        disabled={!g.canEarlier}
        className="mt-4 min-h-[44px] rounded-[5px] border border-dashed border-disabled px-3 font-sans text-[11.5px] font-semibold text-bronze-ink hover:bg-tint-warm disabled:text-body"
      >
        {g.earlierLabel}
      </button>
      <div className="mt-[10px]">
        <AvailabilityGrid cellHeight={30} />
      </div>
      <button
        type="button"
        onClick={g.finishLater}
        disabled={!g.canLater}
        className="mt-[10px] min-h-[44px] rounded-[5px] border border-dashed border-disabled px-3 font-sans text-[11.5px] font-semibold text-bronze-ink hover:bg-tint-warm disabled:text-body"
      >
        {g.laterLabel}
      </button>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={!ready || publishing}
          onClick={() => ready && !publishing && onLive()}
          aria-busy={publishing}
          className="rounded-input px-6 py-[13px] font-sans text-[14px] font-semibold text-paper hover:bg-bronze-hover"
          style={{ background: ready && !publishing ? T.bronzeHover : T.disabled }}
        >
          {publishing ? "Publishing your page…" : "You’re done — go live"}
        </button>
        <span className="font-sans text-[12.5px] text-body">
          Connect Google or Outlook later; busy time blocks itself.
        </span>
      </div>
      {publishError && (
        <div role="alert" className="mt-4 rounded-chip border border-line-soft bg-tint-warm px-4 py-3 font-sans text-[12.5px] leading-[1.5] text-body">
          <p>{publishError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 min-h-[44px] font-semibold text-bronze-ink"
          >
            Try publishing again
          </button>
        </div>
      )}
    </div>
  );
}

function StepLive({ handleShown }: { handleShown: string }) {
  const { config } = useOwnerConfig();
  const [copied, setCopied] = useState(false);
  const hours = openHours(config.cells);
  const summary = `${config.service.trim() || "Session"} · ${fmtDuration(config.duration)} · ${fmtHours(hours)} bookable a week.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`booktimewith.link/${handleShown}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — non-fatal */
    }
  };

  return (
    <div className="py-9 text-center">
      <div className="mx-auto grid h-[52px] w-[52px] place-items-center rounded-full bg-bronze-hover font-serif text-2xl text-paper">
        ✓
      </div>
      <h2 id="setup-step-heading" tabIndex={-1} className="mt-5 font-serif text-[30px] tracking-[-.01em]">You&apos;re live.</h2>
      <p className="mt-[10px] font-sans text-[14px] leading-[1.6] text-body">{summary}</p>
      <div className="mt-[22px] inline-flex items-center gap-[10px] rounded-chip border border-line bg-paper px-[18px] py-[13px] font-sans text-[14.5px] font-medium">
        booktimewith.link/{handleShown}
        <button
          type="button"
          onClick={copy}
          className="min-h-[44px] px-2 font-sans text-[11px] font-semibold tracking-label text-bronze-ink"
        >
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <div className="mt-[26px]">
        <a
          href={`/${handleShown}`}
          className="inline-block rounded-input bg-ink px-6 py-[13px] font-sans text-[14px] font-semibold text-paper hover:bg-ink-soft hover:text-paper"
        >
          See what clients see →
        </a>
      </div>
    </div>
  );
}
