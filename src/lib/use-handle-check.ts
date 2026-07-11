"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Debounced live handle-availability check against /api/handle-available —
 * the endpoint behind the "✓ … is available" hint (README "Handle availability
 * check"). Shared by the landing claim form and onboarding step 1.
 */
export interface HandleHint {
  handle: string;
  ok: boolean;
  msg: string;
  status: "checking" | "available" | "unavailable" | "error";
  retry: () => void;
}

export function useHandleCheck(handle: string): HandleHint | null {
  const [hint, setHint] = useState<Omit<HandleHint, "retry"> | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = useCallback(() => setRetryNonce((value) => value + 1), []);

  useEffect(() => {
    if (!handle) {
      setHint(null);
      return;
    }
    const controller = new AbortController();
    setHint({
      handle,
      ok: false,
      msg: "Checking availability…",
      status: "checking",
    });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/handle-available?handle=${encodeURIComponent(handle)}`,
          { signal: controller.signal },
        );
        const data = (await res.json().catch(() => null)) as {
          available?: boolean;
          handle?: string;
          message?: string;
        } | null;
        if (controller.signal.aborted) return;
        if (!res.ok || !data || typeof data.available !== "boolean") {
          setHint({
            handle,
            ok: false,
            msg: data?.message ?? "Availability couldn't be checked. Try again.",
            status: "error",
          });
          return;
        }
        setHint(
          data.available
            ? {
                handle,
                ok: true,
                msg: `✓ booktimewith.link/${data.handle ?? handle} is available`,
                status: "available",
              }
            : {
                handle,
                ok: false,
                msg: data.message ?? "That handle isn't available.",
                status: "unavailable",
              },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setHint({
          handle,
          ok: false,
          msg:
            error instanceof Error && error.name === "AbortError"
              ? "Checking availability…"
              : "Availability couldn't be checked. Try again.",
          status: "error",
        });
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [handle, retryNonce]);

  if (!handle) return null;
  if (!hint || hint.handle !== handle) {
    return {
      handle,
      ok: false,
      msg: "Checking availability…",
      status: "checking",
      retry,
    };
  }
  return { ...hint, retry };
}
