"use client";

import { useState } from "react";
import { CURRENCY_ORDER, PRICES, type CurrencyCode } from "@/lib/format";
import { T } from "@/lib/tokens";

/** Single-plan pricing card with a currency switcher (auto-detect in production). */
export function PricingCard() {
  const [currency, setCurrency] = useState<CurrencyCode>("GBP");

  return (
    <div className="mt-9 flex max-w-[560px] flex-col items-start gap-8 rounded-card border border-line-soft bg-white p-9 sm:flex-row sm:items-center sm:px-10">
      <div className="flex-none">
        <div className="font-serif text-[56px] leading-none">
          {PRICES[currency]}
          <span className="font-sans text-base text-faint"> /person/mo</span>
        </div>
        <div className="mt-2 flex gap-1" role="group" aria-label="Currency">
          {CURRENCY_ORDER.map((code) => {
            const on = code === currency;
            return (
              <button
                key={code}
                type="button"
                onClick={() => setCurrency(code)}
                aria-pressed={on}
                className="rounded-[4px] px-[9px] py-1 font-sans text-[11px] font-semibold tracking-[.05em] hover:bg-tint"
                style={{
                  background: on ? T.ink : "transparent",
                  color: on ? T.paper : T.faint,
                }}
              >
                {code}
              </button>
            );
          })}
        </div>
      </div>
      <div className="font-sans text-[14px] leading-[1.65] text-body text-pretty">
        Everything, for everyone. Solo or a practice of ten — one booking page,
        unlimited appointments, calendar sync, reminders.
      </div>
    </div>
  );
}
