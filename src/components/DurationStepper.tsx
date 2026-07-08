"use client";

import { fmtDuration } from "@/lib/format";

/**
 * One control for any service length: −/value/+ in 5-minute steps, clamped
 * 15 min–4 hr. Value shown human-style ("50 min", "1 hr 30").
 */
export function DurationStepper({
  minutes,
  onChange,
  size = "lg",
}: {
  minutes: number;
  onChange: (next: number) => void;
  size?: "lg" | "sm";
}) {
  const dec = () => onChange(Math.max(15, minutes - 5));
  const inc = () => onChange(Math.min(240, minutes + 5));

  const btn =
    size === "lg"
      ? "px-[18px] py-3 text-[17px]"
      : "px-[17px] py-[11px] text-base";
  const val =
    size === "lg"
      ? "min-w-[86px] px-2 py-3 text-[15px]"
      : "min-w-[80px] px-2 py-[11px] text-[14px]";

  return (
    <div className="inline-flex items-center overflow-hidden rounded-chip border border-line">
      <button
        type="button"
        onClick={dec}
        aria-label="Decrease length by 5 minutes"
        className={`select-none font-sans font-semibold text-bronze hover:bg-tint-warm ${btn}`}
      >
        −
      </button>
      <div
        aria-live="polite"
        className={`border-x border-hairline text-center font-sans font-semibold text-ink ${val}`}
      >
        {fmtDuration(minutes)}
      </div>
      <button
        type="button"
        onClick={inc}
        aria-label="Increase length by 5 minutes"
        className={`select-none font-sans font-semibold text-bronze hover:bg-tint-warm ${btn}`}
      >
        +
      </button>
    </div>
  );
}
