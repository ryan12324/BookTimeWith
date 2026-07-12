"use client";

import { T } from "@/lib/tokens";

export interface DayOption {
  dow: string;
  date: string;
}

/** Horizontally-scrollable day tabs (README: scroll if more days are added). */
export function DayTabs({
  days,
  selected,
  onPick,
}: {
  days: readonly DayOption[];
  selected: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="flex gap-[7px] overflow-x-auto">
      {days.map((d, i) => {
        const on = selected === i;
        return (
          <button
            key={d.dow + d.date}
            type="button"
            onClick={() => onPick(i)}
            aria-pressed={on}
            className="min-h-[44px] min-w-[72px] flex-1 rounded-chip border py-[10px] text-center"
            style={{
              background: on ? T.tint : "#fff",
              borderColor: on ? T.ink : T.line,
            }}
          >
            <div
              className="font-sans text-[11px] font-semibold tracking-[.05em]"
              style={{ color: on ? T.bronzeHover : T.body }}
            >
              {d.dow}
            </div>
            <div
              className="mt-[2px] font-sans text-[15px] font-semibold"
              style={{ color: on ? T.ink : T.body }}
            >
              {d.date}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function DatePager({
  hasEarlier,
  hasMore,
  onEarlier,
  onMore,
}: {
  hasEarlier: boolean;
  hasMore: boolean;
  onEarlier: () => void;
  onMore: () => void;
}) {
  if (!hasEarlier && !hasMore) return null;
  return (
    <nav aria-label="Available date pages" className="mt-3 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onEarlier}
        disabled={!hasEarlier}
        className="min-h-[44px] rounded-input px-2 font-sans text-[12.5px] font-semibold text-bronze-ink disabled:invisible"
      >
        ← Earlier dates
      </button>
      <button
        type="button"
        onClick={onMore}
        disabled={!hasMore}
        className="min-h-[44px] rounded-input px-2 font-sans text-[12.5px] font-semibold text-bronze-ink disabled:invisible"
      >
        More dates →
      </button>
    </nav>
  );
}

/** 3-column slot grid; selected slot inverts to ink. */
export function SlotGrid({
  slots,
  selected,
  onPick,
}: {
  slots: string[];
  selected: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {slots.map((label, i) => {
        const on = selected === i;
        return (
          <button
            key={label + i}
            type="button"
            onClick={() => onPick(i)}
            aria-pressed={on}
            className="min-h-[44px] rounded-input border py-[11px] text-center font-sans text-[13.5px] font-medium"
            style={{
              borderColor: on ? T.ink : T.line,
              background: on ? T.ink : "#fff",
              color: on ? T.paper : T.ink,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
