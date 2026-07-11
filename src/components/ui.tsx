import type { CSSProperties } from "react";

/**
 * Brand wordmark. The real logo lockup (calendar mark + "booktimewith.com")
 * lives at /images/btw_logo.png; `size` stays the visual text size so existing
 * call sites read the same. The image bakes in the ".com" suffix, so any
 * non-".com" surface (e.g. a .link footer) falls back to the text mark.
 */
export function Wordmark({
  size = 17,
  suffix = ".com",
}: {
  size?: number;
  suffix?: string;
}) {
  if (suffix !== ".com") {
    return (
      <span className="font-serif font-semibold" style={{ fontSize: size }}>
        booktimewith<span className="text-faint">{suffix}</span>
      </span>
    );
  }
  // Intrinsic logo is 2193×297 (≈7.38:1); height tracks the text size so the
  // mark sits at the same weight the serif wordmark did.
  const height = Math.round(size * 1.6);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/images/btw_logo.png"
      alt="booktimewith.com"
      width={2193}
      height={297}
      style={{ height, width: "auto" }}
    />
  );
}

/** Deliberately abstract striped avatar mark. */
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
  as = "div",
  htmlFor,
}: {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "label";
  htmlFor?: string;
}) {
  const classes = `font-sans text-[11.5px] font-semibold uppercase tracking-label text-body ${className}`;
  if (as === "label") {
    return (
      <label htmlFor={htmlFor} className={classes} style={style}>
        {children}
      </label>
    );
  }
  return <div className={classes} style={style}>{children}</div>;
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
        background: done ? "#776a50" : "#e6dfd3",
        color: done ? "#faf8f4" : "#6b6357",
      }}
    >
      {done ? "✓" : "—"}
    </div>
  );
}
