"use client";

import { T } from "@/lib/tokens";

/** 30×17 track with a 13px knob, bronze when on — the one toggle style in the app. */
export function Toggle({ on }: { on: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="relative flex-none rounded-[9px] transition-colors"
      style={{ width: 30, height: 17, background: on ? T.bronze : T.toggleOff }}
    >
      <div
        className="absolute rounded-full bg-white transition-transform"
        style={{
          top: 2,
          left: 2,
          transform: on ? "translateX(13px)" : "translateX(0)",
          width: 13,
          height: 13,
          boxShadow: "0 1px 2px rgba(38,34,28,.25)",
        }}
      />
    </div>
  );
}

/** A toggle preceding a label, the whole row clickable (settings "emails to you"). */
export function ToggleRow({
  on,
  onToggle,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className="flex min-h-[44px] items-center gap-[11px] rounded-input px-1 text-left"
    >
      <Toggle on={on} />
      <span className="font-sans text-[13.5px] text-ink">{children}</span>
    </button>
  );
}
