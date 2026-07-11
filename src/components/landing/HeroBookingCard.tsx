"use client";

import { useState } from "react";
import { StripedAvatar } from "@/components/ui";
import { T } from "@/lib/tokens";

const TIMES = ["9:00am", "10:00am", "1:00pm", "3:30pm"];

/** The floating booking-card demo in the hero — clickable slots update the CTA. */
export function HeroBookingCard() {
  const [picked, setPicked] = useState(1);

  return (
    <div className="overflow-hidden rounded-card border border-line-soft bg-white shadow-float">
      <div className="flex items-center gap-[13px] border-b border-hairline px-6 py-5">
        <StripedAvatar size={40} />
        <div>
          <div className="font-serif text-[15px] font-semibold">Dana Whitfield, LMFT</div>
          <div className="font-sans text-[12px] text-faint">Therapy session · 50 min</div>
        </div>
      </div>
      <div className="px-6 pb-[22px] pt-[18px]">
        <div className="mb-[11px] font-sans text-[11px] font-semibold uppercase tracking-wide text-faint">
          Tuesday, July 14
        </div>
        <div className="grid grid-cols-4 gap-2">
          {TIMES.map((t, i) => {
            const on = i === picked;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setPicked(i)}
                aria-pressed={on}
                className="min-h-[44px] rounded-[5px] border px-1 py-[10px] text-center font-sans text-[13px] font-medium"
                style={{
                  borderColor: on ? T.ink : T.line,
                  background: on ? T.ink : "#fff",
                  color: on ? T.paper : T.ink,
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="mt-[15px] min-h-[44px] w-full rounded-input bg-bronze py-3 text-center font-sans text-[13.5px] font-semibold text-paper hover:bg-bronze-hover"
        >
          Book Tuesday at {TIMES[picked]} →
        </button>
        <div className="mt-[10px] text-center font-sans text-[11.5px] text-faint">
          No account needed. Ever.
        </div>
      </div>
    </div>
  );
}
