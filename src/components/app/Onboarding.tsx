"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useOwnerConfig } from "@/lib/store";
import { openHours } from "@/lib/availability";
import { fmtDuration, fmtOpenHours } from "@/lib/format";
import { DurationStepper } from "@/components/DurationStepper";
import { Toggle } from "@/components/Toggle";
import { AvailabilityGrid, useGridControls } from "@/components/AvailabilityGrid";
import { SectionLabel } from "@/components/ui";
import { T } from "@/lib/tokens";

type Step = 1 | 2 | 3 | 4;

export function Onboarding() {
  const { config, update } = useOwnerConfig();
  const [step, setStep] = useState<Step>(1);
  const params = useSearchParams();
  const seeded = useRef(false);

  // Seed the handle from the landing page's "Claim it" query, once.
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const h = params.get("handle");
    if (h) {
      const clean = h.toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (clean && clean !== "yourname") update({ handle: clean });
    }
  }, [params, update]);

  const handleShown = (config.handle || "yourname").trim() || "yourname";
  const serviceShown = config.service.trim() || "Session";

  const steps = [
    { num: "01", title: "Claim your link", sub: `booktimewith.link/${handleShown}` },
    { num: "02", title: "Name your service", sub: `${serviceShown} · ${fmtDuration(config.duration)}` },
    { num: "03", title: "Paint your hours", sub: `${fmtOpenHours(openHours(config.cells))} hours open / week` },
  ];

  return (
    <div className="mt-9 grid items-start gap-10 md:grid-cols-[220px_1fr]">
      {/* step rail — desktop */}
      <div className="hidden flex-col gap-[2px] md:flex">
        {steps.map((s, i) => {
          const active = step === i + 1;
          return (
            <button
              key={s.num}
              type="button"
              onClick={() => setStep((i + 1) as Step)}
              className="flex items-baseline gap-3 rounded-chip px-[14px] py-3 text-left"
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
              className="flex items-center gap-2 rounded-chip px-3 py-2"
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
      <div className="min-h-[380px] rounded-card border border-line-soft bg-white p-8 shadow-card md:px-9">
        {step === 1 && <StepClaim onNext={() => setStep(2)} />}
        {step === 2 && <StepService onNext={() => setStep(3)} />}
        {step === 3 && <StepHours onLive={() => setStep(4)} onClient={undefined} />}
        {step === 4 && <StepLive handleShown={handleShown} />}
      </div>
    </div>
  );
}

function StepClaim({ onNext }: { onNext: () => void }) {
  const { config, update } = useOwnerConfig();
  const handleShown = (config.handle || "yourname").trim() || "yourname";
  const isDefault = handleShown === "yourname";
  return (
    <div>
      <h2 className="font-serif text-[26px] tracking-[-.01em]">Claim your link</h2>
      <p className="mt-2 max-w-[400px] font-sans text-[13.5px] leading-[1.6] text-body">
        This is the address clients will use. It&apos;s yours forever.
      </p>
      <div className="mt-6 flex max-w-[440px] items-center overflow-hidden rounded-chip border border-line">
        <span className="flex-none py-[14px] pl-4 font-sans text-[15px] text-faint">
          booktimewith.link/
        </span>
        <input
          value={config.handle}
          onChange={(e) =>
            update({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })
          }
          placeholder="yourname"
          aria-label="Your booking link handle"
          className="min-w-0 flex-1 border-none py-[14px] pl-[2px] pr-4 font-medium text-ink outline-none"
          style={{ fontSize: 15 }}
        />
      </div>
      <div
        className="mt-[10px] font-sans text-[12px]"
        style={{ color: isDefault ? T.faint : T.bronze }}
      >
        {isDefault
          ? "Letters, numbers and dashes."
          : `✓ booktimewith.link/${handleShown} is available`}
      </div>
      <button
        type="button"
        onClick={onNext}
        className="mt-7 rounded-input bg-ink px-6 py-[13px] font-sans text-[14px] font-semibold text-paper hover:bg-ink-soft"
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

  return (
    <div>
      <h2 className="font-serif text-[26px] tracking-[-.01em]">Name your service</h2>
      <p className="mt-2 max-w-[400px] font-sans text-[13.5px] leading-[1.6] text-body">
        One service to start. You can add more later — most people don&apos;t need to.
      </p>
      <div className="mt-6 max-w-[440px]">
        <SectionLabel className="mb-2">Service</SectionLabel>
        <input
          value={config.service}
          onChange={(e) => update({ service: e.target.value })}
          className="w-full rounded-chip border border-line px-4 py-[14px] font-medium text-ink outline-none"
          style={{ fontSize: 15 }}
        />

        <SectionLabel className="mb-2 mt-5">Length</SectionLabel>
        <div className="flex items-center gap-[14px]">
          <DurationStepper
            minutes={config.duration}
            onChange={(m) => update({ duration: m })}
          />
          <span className="font-sans text-[12px] text-faint">Any length, in 5-minute steps.</span>
        </div>

        <SectionLabel className="mb-2 mt-5">Where</SectionLabel>
        <div className="flex gap-2">
          {locations.map((l) => {
            const on = config.location === l.key;
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => update({ location: l.key })}
                className="flex-1 rounded-input border px-4 py-[14px] text-left"
                style={{ borderColor: on ? T.ink : T.line, background: on ? T.tintWarm : "#fff" }}
              >
                <div className="font-sans text-[13.5px] font-semibold text-ink">{l.title}</div>
                <div className="mt-[3px] font-sans text-[12px] leading-[1.5] text-faint">{l.sub}</div>
              </button>
            );
          })}
        </div>
        {config.location === "mine" && (
          <div className="mt-3">
            <input
              value={config.ownerAddress}
              onChange={(e) => update({ ownerAddress: e.target.value })}
              placeholder="Your address, e.g. 12 Harley Street, London"
              className="w-full rounded-chip border border-line px-[15px] py-3 font-medium text-ink outline-none"
              style={{ fontSize: 13.5 }}
            />
            <div className="mt-[7px] font-sans text-[11.5px] text-faint">
              Only shared after someone books.
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onNext}
        className="mt-7 rounded-input bg-ink px-6 py-[13px] font-sans text-[14px] font-semibold text-paper hover:bg-ink-soft"
      >
        Next: when you work →
      </button>
    </div>
  );
}

function StepHours({ onLive }: { onLive: () => void; onClient?: undefined }) {
  const g = useGridControls();
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-serif text-[26px] tracking-[-.01em]">Paint when you work</h2>
          <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
            Click or drag across the hours you take bookings — each block splits into
            half-hours. Everything else stays closed.
          </p>
        </div>
        <div className="font-sans text-[12px] text-faint">{g.summary}</div>
      </div>

      <div className="mt-[18px] flex items-center gap-[10px]">
        <button
          type="button"
          onClick={g.toggleWeekends}
          role="switch"
          aria-checked={g.weekends}
          className="flex items-center gap-[9px] rounded-input border px-[14px] py-[9px]"
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
        className="mt-4 rounded-[5px] border border-dashed border-disabled px-3 py-[6px] font-sans text-[11.5px] font-semibold text-bronze hover:bg-tint-warm"
      >
        {g.earlierLabel}
      </button>
      <div className="mt-[10px]">
        <AvailabilityGrid cellHeight={30} />
      </div>
      <button
        type="button"
        onClick={g.finishLater}
        className="mt-[10px] rounded-[5px] border border-dashed border-disabled px-3 py-[6px] font-sans text-[11.5px] font-semibold text-bronze hover:bg-tint-warm"
      >
        {g.laterLabel}
      </button>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onLive}
          className="rounded-input bg-bronze px-6 py-[13px] font-sans text-[14px] font-semibold text-paper hover:bg-bronze-hover"
        >
          You&apos;re done — go live
        </button>
        <span className="font-sans text-[12.5px] text-faint">
          Connect Google or Outlook later; busy time blocks itself.
        </span>
      </div>
    </div>
  );
}

function StepLive({ handleShown }: { handleShown: string }) {
  const { config } = useOwnerConfig();
  const [copied, setCopied] = useState(false);
  const summary = `${config.service.trim() || "Session"} · ${fmtDuration(config.duration)} · ${fmtOpenHours(openHours(config.cells))} bookable hours a week.`;

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
      <div className="mx-auto grid h-[52px] w-[52px] place-items-center rounded-full bg-bronze font-serif text-2xl text-paper">
        ✓
      </div>
      <div className="mt-5 font-serif text-[30px] tracking-[-.01em]">You&apos;re live.</div>
      <p className="mt-[10px] font-sans text-[14px] leading-[1.6] text-body">{summary}</p>
      <div className="mt-[22px] inline-flex items-center gap-[10px] rounded-chip border border-line bg-paper px-[18px] py-[13px] font-sans text-[14.5px] font-medium">
        booktimewith.link/{handleShown}
        <button
          type="button"
          onClick={copy}
          className="font-sans text-[11px] font-semibold tracking-label text-bronze"
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
