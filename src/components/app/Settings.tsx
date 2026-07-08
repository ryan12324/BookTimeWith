"use client";

import { useOwnerConfig } from "@/lib/store";
import { DurationStepper } from "@/components/DurationStepper";
import { AvailabilityGrid, useGridControls } from "@/components/AvailabilityGrid";
import { Toggle, ToggleRow } from "@/components/Toggle";
import { SectionLabel } from "@/components/ui";
import { T } from "@/lib/tokens";

const PROVIDERS = [
  { name: "Google Calendar", dot: "#4285f4" },
  { name: "Outlook", dot: "#0f6cbd" },
  { name: "Apple Calendar", dot: "#a2a2a7" },
];

/**
 * The whole product promise: one settings page. Sections divided by hairlines,
 * autosave (changes persist to the store immediately — no Save button).
 */
export function Settings() {
  const { config, update } = useOwnerConfig();
  const g = useGridControls();

  return (
    <div className="mx-auto mt-9 max-w-[680px]">
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-[28px] tracking-[-.01em]">Settings</h1>
        <div className="font-sans text-[12.5px] text-faint">This is all of them.</div>
      </div>

      <div className="mt-5 rounded-card border border-line-soft bg-white px-6 pb-8 pt-2 shadow-card md:px-9">
        {/* YOUR LINK */}
        <section className="border-b border-hairline pb-6 pt-[26px]">
          <SectionLabel className="mb-[10px]">Your link</SectionLabel>
          <div className="flex max-w-[420px] items-center overflow-hidden rounded-chip border border-line">
            <span className="flex-none py-[13px] pl-[15px] font-sans text-[14.5px] text-faint">
              booktimewith.link/
            </span>
            <input
              value={config.handle}
              onChange={(e) =>
                update({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })
              }
              placeholder="yourname"
              aria-label="Your booking link handle"
              className="min-w-0 flex-1 border-none py-[13px] pl-[2px] pr-[15px] font-medium text-ink outline-none"
              style={{ fontSize: 14.5 }}
            />
          </div>
          <div className="mt-2 font-sans text-[11.5px] text-faint">
            Changing it redirects your old link for 90 days.
          </div>
        </section>

        {/* YOUR SERVICE */}
        <section className="border-b border-hairline py-6">
          <SectionLabel className="mb-[10px]">Your service</SectionLabel>
          <input
            value={config.service}
            onChange={(e) => update({ service: e.target.value })}
            className="w-full max-w-[420px] rounded-chip border border-line px-[15px] py-[13px] font-medium text-ink outline-none"
            style={{ fontSize: 14.5 }}
          />
          <div className="mt-[14px] flex flex-wrap items-center gap-[14px]">
            <DurationStepper
              minutes={config.duration}
              onChange={(m) => update({ duration: m })}
              size="sm"
            />
            <div className="flex min-w-[280px] flex-1 gap-2">
              {(["mine", "theirs"] as const).map((key) => {
                const on = config.location === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => update({ location: key })}
                    className="flex-1 rounded-input border px-[14px] py-[11px] font-sans text-[12.5px] font-semibold text-ink"
                    style={{ borderColor: on ? T.ink : T.line, background: on ? T.tintWarm : "#fff" }}
                  >
                    {key === "mine" ? "Clients come to me" : "I go to clients"}
                  </button>
                );
              })}
            </div>
          </div>
          {config.location === "mine" && (
            <input
              value={config.ownerAddress}
              onChange={(e) => update({ ownerAddress: e.target.value })}
              placeholder="Your address, e.g. 12 Harley Street, London"
              className="mt-3 w-full max-w-[420px] rounded-chip border border-line px-[15px] py-3 font-medium text-ink outline-none"
              style={{ fontSize: 13.5 }}
            />
          )}
        </section>

        {/* YOUR HOURS */}
        <section className="border-b border-hairline py-6">
          <div className="flex items-baseline justify-between">
            <SectionLabel>Your hours</SectionLabel>
            <div className="font-sans text-[11.5px] text-faint">{g.summary}</div>
          </div>
          <div className="mt-[14px] flex flex-wrap items-center gap-[10px]">
            <button
              type="button"
              onClick={g.toggleWeekends}
              role="switch"
              aria-checked={g.weekends}
              className="flex items-center gap-[9px] rounded-input border px-[13px] py-2"
              style={{
                borderColor: g.weekends ? T.bronze : T.line,
                background: g.weekends ? T.tintWarm : "#fff",
              }}
            >
              <Toggle on={g.weekends} />
              <span className="font-sans text-[12px] font-semibold text-ink">We&apos;re open weekends</span>
            </button>
            <button
              type="button"
              onClick={g.startEarlier}
              className="rounded-[5px] border border-dashed border-disabled px-3 py-2 font-sans text-[11.5px] font-semibold text-bronze hover:bg-tint-warm"
            >
              {g.earlierLabel}
            </button>
            <button
              type="button"
              onClick={g.finishLater}
              className="rounded-[5px] border border-dashed border-disabled px-3 py-2 font-sans text-[11.5px] font-semibold text-bronze hover:bg-tint-warm"
            >
              {g.laterLabel}
            </button>
          </div>
          <div className="mt-[14px]">
            <AvailabilityGrid cellHeight={26} />
          </div>
        </section>

        {/* CALENDAR */}
        <section className="border-b border-hairline py-6">
          <SectionLabel className="mb-[10px]">Calendar</SectionLabel>
          {!config.calendar ? (
            <>
              <p className="mb-[14px] font-sans text-[13px] leading-[1.5] text-body">
                Connect your calendar and busy time blocks itself — both ways.
              </p>
              <div className="flex flex-wrap gap-[10px]">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => update({ calendar: p.name })}
                    className="flex items-center gap-[9px] rounded-input border border-line px-[18px] py-[11px] font-sans text-[13px] font-semibold text-ink hover:bg-paper"
                  >
                    <span
                      className="h-[9px] w-[9px] flex-none rounded-[2px]"
                      style={{ background: p.dot }}
                    />
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-[10px] rounded-[8px] border border-hairline bg-paper px-[18px] py-[14px]">
              <div className="flex items-center gap-[11px]">
                <span className="h-[9px] w-[9px] flex-none rounded-full bg-bronze" />
                <div>
                  <div className="font-sans text-[13.5px] font-semibold text-ink">
                    {config.calendar} connected
                  </div>
                  <div className="font-sans text-[12px] text-faint">
                    Busy events block booking slots · bookings appear in your calendar
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => update({ calendar: null })}
                className="font-sans text-[12.5px] font-semibold text-faint hover:text-body"
              >
                Disconnect
              </button>
            </div>
          )}
        </section>

        {/* EMAILS TO YOU */}
        <section className="border-b border-hairline py-6">
          <SectionLabel className="mb-[14px]">Emails to you</SectionLabel>
          <div className="flex flex-col gap-3">
            <ToggleRow on={config.notifyBook} onToggle={() => update({ notifyBook: !config.notifyBook })}>
              When someone books, reschedules or cancels
            </ToggleRow>
            <ToggleRow
              on={config.notifyMorning}
              onToggle={() => update({ notifyMorning: !config.notifyMorning })}
            >
              Morning summary of the day&apos;s appointments
            </ToggleRow>
          </div>
        </section>

        {/* YOUR PLAN */}
        <section className="flex flex-wrap items-center justify-between gap-[10px] pb-2 pt-6">
          <div>
            <SectionLabel>Your plan</SectionLabel>
            <div className="mt-2 font-sans text-[14px] text-ink">
              £6 a month · <span className="text-body">free trial ends 3 August</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button type="button" className="font-sans text-[12.5px] font-semibold text-bronze">
              Manage billing
            </button>
            <button type="button" className="font-sans text-[12.5px] font-semibold text-faint">
              Delete account
            </button>
          </div>
        </section>
      </div>

      <p className="mt-[14px] text-center font-sans text-[11.5px] text-faint">
        Changes save as you make them.
      </p>
    </div>
  );
}
