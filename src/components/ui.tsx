import type { CSSProperties } from "react";

/** Serif wordmark: booktimewith + faint domain suffix. */
export function Wordmark({
  size = 17,
  suffix = ".com",
}: {
  size?: number;
  suffix?: string;
}) {
  return (
    <span className="font-serif font-semibold" style={{ fontSize: size }}>
      booktimewith<span className="text-faint">{suffix}</span>
    </span>
  );
}

/** Striped placeholder avatar (real photo upload is a phase-2 feature). */
export function StripedAvatar({ size = 44 }: { size?: number }) {
  return (
    <div
      className="avatar-stripe flex-none rounded-full"
      style={{ width: size, height: size }}
    />
  );
}

/** 11.5px uppercase letterspaced section label in faint. */
export function SectionLabel({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`font-sans text-[11.5px] font-semibold uppercase tracking-label text-faint ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

/** The rounded check / neutral status badge used on "done" screens. */
export function StatusBadge({
  variant = "done",
  size = 48,
}: {
  variant?: "done" | "neutral";
  size?: number;
}) {
  const done = variant === "done";
  return (
    <div
      className="mx-auto grid place-items-center rounded-full font-serif"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.46),
        background: done ? "#8a7a5c" : "#e6dfd3",
        color: done ? "#faf8f4" : "#6b6357",
      }}
    >
      {done ? "✓" : "—"}
    </div>
  );
}
