"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";

export function RouteError({
  error,
  reset,
  title = "This page hit a problem.",
  message = "Your last action may not have completed. Try the page again, or return to a safe starting point.",
  homeHref = "/",
  homeLabel = "Return home",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  message?: string;
  homeHref?: string;
  homeLabel?: string;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
    // Preserve a useful operator signal without exposing implementation detail
    // or a server digest in the recovery UI.
    console.error(error);
  }, [error]);

  return (
    <section
      aria-labelledby={titleId}
      role="alert"
      className="mx-auto mt-12 w-full max-w-[520px] rounded-card border border-line bg-white px-6 py-10 text-center shadow-card sm:px-9"
    >
      <h1
        ref={heading}
        id={titleId}
        tabIndex={-1}
        className="font-serif text-[26px] tracking-[-.01em] text-ink"
      >
        {title}
      </h1>
      <p className="mx-auto mt-3 max-w-[44ch] font-sans text-[13.5px] leading-[1.65] text-body">
        {message}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="min-h-[44px] rounded-input bg-ink px-5 font-sans text-[13px] font-semibold text-paper hover:bg-ink-soft"
        >
          Try again
        </button>
        <Link
          href={homeHref}
          className="inline-flex min-h-[44px] items-center rounded-input px-4 font-sans text-[13px] font-semibold text-bronze-ink"
        >
          {homeLabel}
        </Link>
      </div>
    </section>
  );
}
