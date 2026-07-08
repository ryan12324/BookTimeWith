/** Human formatting helpers, matching the prototype's voice exactly. */

/** 50 -> "50 min", 60 -> "1 hr", 90 -> "1 hr 30" */
export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const r = minutes % 60;
  return r ? `${h} hr ${r}` : `${h} hr`;
}

/** 9 -> "9am", 12 -> "12pm", 13 -> "1pm", 0 -> "12am" */
export function fmtHour(h: number): string {
  return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
}

/** 16.5 -> "16.5", 16 -> "16" (trailing .0 stripped) */
export function fmtOpenHours(hours: number): string {
  return hours % 1 ? hours.toFixed(1).replace(".0", "") : String(hours);
}

export type CurrencyCode = "GBP" | "USD" | "EUR" | "AUD";

/** Localised single-plan pricing (README billing rules). GBP is the default. */
export const PRICES: Record<CurrencyCode, string> = {
  GBP: "£6",
  USD: "$8",
  EUR: "€7",
  AUD: "A$12",
};

export const CURRENCY_ORDER: CurrencyCode[] = ["GBP", "USD", "EUR", "AUD"];
