"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/ui";
import { useOwnerConfig } from "@/lib/store";

const TABS = [
  { href: "/app/bookings", label: "Bookings" },
  { href: "/app/settings", label: "Settings" },
];

/**
 * Owner app top bar (booktimewith.com). Tabs are real routes; the design
 * prototype folded these into one tab switcher, but in the product each is a
 * page. Until onboarding finishes there is nothing to book or configure, so
 * only "Set up" shows — Bookings/Settings appear when setup completes.
 */
export function OwnerNav() {
  const pathname = usePathname();
  const { config, accountReady } = useOwnerConfig();

  // During signup (the setup flow, pre-completion) there is no account yet —
  // no tabs, no "View your page", no sign out. Just the wordmark.
  if (!config.setupComplete || !accountReady) {
    return (
      <header className="mx-auto flex max-w-[960px] items-center px-6 pt-9 md:px-8">
        <Wordmark size={16} />
      </header>
    );
  }

  return (
    <header className="mx-auto max-w-[960px] px-6 pt-9 md:px-8">
      <nav
        aria-label="Owner navigation"
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <Wordmark size={16} />
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:gap-3">
        <div className="flex gap-[3px] rounded-chip border border-line bg-white p-[3px]">
          {TABS.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-[44px] items-center rounded-[5px] px-4 font-sans text-[13px] font-semibold ${
                  active ? "bg-ink text-paper hover:text-paper" : "text-body"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
        <Link
          href={`/${config.handle || "dana"}`}
          className="hidden min-h-[44px] items-center font-sans text-[12.5px] font-semibold text-bronze-ink sm:inline-flex"
        >
          View your page →
        </Link>
        <form action="/api/auth/signout" method="post">
          <button
            type="submit"
            className="min-h-[44px] px-2 font-sans text-[12px] font-semibold text-body hover:text-ink"
          >
            Sign out
          </button>
        </form>
        </div>
      </nav>
    </header>
  );
}
