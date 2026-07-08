"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/ui";
import { useOwnerConfig } from "@/lib/store";

const TABS = [
  { href: "/app/setup", label: "Set up" },
  { href: "/app/bookings", label: "Bookings" },
  { href: "/app/settings", label: "Settings" },
];

/**
 * Owner app top bar (booktimewith.com). Tabs are real routes; the design
 * prototype folded these into one tab switcher, but in the product each is a page.
 */
export function OwnerNav() {
  const pathname = usePathname();
  const { config } = useOwnerConfig();

  return (
    <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-4 px-6 pt-9 md:px-8">
      <Wordmark size={16} />
      <div className="flex items-center gap-3">
        <div className="flex gap-[3px] rounded-chip border border-line bg-white p-[3px]">
          {TABS.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-[5px] px-4 py-2 font-sans text-[13px] font-semibold ${
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
          className="hidden font-sans text-[12.5px] font-semibold text-bronze sm:inline"
        >
          View your page →
        </Link>
      </div>
    </div>
  );
}
