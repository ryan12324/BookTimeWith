"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useOwnerConfig } from "@/lib/store";

/**
 * Bookings and Settings don't exist until onboarding is done — before that
 * there's nothing to book or configure. Anyone deep-linking in mid-setup goes
 * back to the setup flow.
 */
export function RequireSetup({ children }: { children: React.ReactNode }) {
  const { config, hydrated, accountReady, loadError, refresh } = useOwnerConfig();
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (hydrated && !loadError && (!config.setupComplete || !accountReady)) {
      router.replace("/app/setup");
    }
  }, [accountReady, config.setupComplete, hydrated, loadError, router]);

  if (!hydrated || retrying) {
    return (
      <div role="status" className="mx-auto mt-9 max-w-[680px] rounded-card border border-line-soft bg-white px-6 py-10 text-center font-sans text-[13.5px] text-body shadow-card">
        Loading your account…
      </div>
    );
  }
  if (loadError) {
    return (
      <div role="alert" className="mx-auto mt-9 max-w-[680px] rounded-card border border-line-soft bg-white px-6 py-10 text-center shadow-card">
        <h1 className="font-serif text-[24px] tracking-[-.01em]">
          Your account couldn&apos;t load.
        </h1>
        <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
          {loadError}
        </p>
        <button
          type="button"
          onClick={() => {
            setRetrying(true);
            void refresh().finally(() => setRetrying(false));
          }}
          className="mt-3 min-h-[44px] rounded-input px-4 font-sans text-[12.5px] font-semibold text-bronze-ink"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!config.setupComplete || !accountReady) return null;
  return <>{children}</>;
}
