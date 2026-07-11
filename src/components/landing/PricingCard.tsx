"use client";

import { useEffect, useState } from "react";
import { CURRENCY_ORDER, PRICES, type CurrencyCode } from "@/lib/format";
import { T } from "@/lib/tokens";

/** Single-plan pricing card with a currency switcher (auto-detect in production). */
export function PricingCard() {
  const [currency, setCurrency] = useState<CurrencyCode>("GBP");

  useEffect(() => {
    const saved = window.localStorage.getItem("btw-currency") as CurrencyCode | null;
    if (saved && CURRENCY_ORDER.includes(saved)) {
      setCurrency(saved);
      return;
    }
    const region = navigator.language.split("-")[1]?.toUpperCase();
    const euroRegions = new Set([
      "AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT",
      "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK",
    ]);
    const detected: CurrencyCode =
      region === "AU" ? "AUD" : region === "US" ? "USD" : region && euroRegions.has(region) ? "EUR" : "GBP";
    setCurrency(detected);
    window.localStorage.setItem("btw-currency", detected);
  }, []);

  const pickCurrency = (next: CurrencyCode) => {
    setCurrency(next);
    window.localStorage.setItem("btw-currency", next);
  };

  return (
    <div className="mt-9 flex max-w-[560px] flex-col items-start gap-9 rounded-card border border-line-soft bg-white p-9 sm:flex-row sm:items-center sm:px-10">
      <div className="flex-none">
        <div className="font-serif text-[56px] leading-none">
          {PRICES[currency]}
          <span className="font-sans text-base text-body"> /month</span>
        </div>
        <div className="mt-2 flex gap-1" role="group" aria-label="Currency">
          {CURRENCY_ORDER.map((code) => {
            const on = code === currency;
            return (
              <button
                key={code}
                type="button"
                onClick={() => pickCurrency(code)}
                aria-pressed={on}
                className="min-h-[44px] min-w-[44px] rounded-[4px] px-[11px] font-sans text-[11px] font-semibold tracking-[.05em] hover:bg-tint"
                style={{
                  background: on ? T.ink : "transparent",
                  color: on ? T.paper : T.body,
                }}
              >
                {code}
              </button>
            );
          })}
        </div>
      </div>
      <div className="font-sans text-[14px] leading-[1.65] text-body text-pretty">
        One booking page, unlimited appointments, calendar sync, and reminders. The
        complete solo plan, with no feature tiers.
      </div>
    </div>
  );
}
