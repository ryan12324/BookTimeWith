"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useHandleCheck } from "@/lib/use-handle-check";
import { T } from "@/lib/tokens";

/**
 * The "claim your link" form: prefix + editable handle + "Claim it" → onboarding
 * with the handle carried in ?handle=. A real form (Enter and the mobile "go"
 * key submit), with the same debounced live availability hint as onboarding —
 * a taken or too-short handle says so here instead of failing on the next page.
 */
export function ClaimInput({ center = false }: { center?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [handle, setHandle] = useState("");
  const hint = useHandleCheck(handle);

  const claim = (e: React.FormEvent) => {
    e.preventDefault();
    const h = handle.trim();
    // Nothing typed, or the live check already said no — put the cursor back
    // in the input (the hint line explains why) instead of navigating.
    if (!h || hint?.status !== "available") {
      input.current?.focus();
      return;
    }
    router.push(`/app/setup?handle=${encodeURIComponent(h)}`);
  };

  return (
    <form onSubmit={claim} className={center ? "text-center" : ""}>
      <div
        className={`flex flex-wrap items-center gap-[10px] ${center ? "justify-center" : ""}`}
      >
        {/* label, not div: clicking anywhere in the field — prefix included —
            drops the cursor into the input */}
        <label className="flex cursor-text items-center rounded-input border border-line bg-white px-[15px] py-[13px] font-sans text-[16px] text-faint focus-within:outline focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-bronze">
          booktimewith.link/
          <input
            ref={input}
            value={handle}
            onChange={(e) =>
              setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            placeholder="yourname"
            aria-label="Choose your booking link handle"
            aria-describedby={center ? undefined : "claim-hint"}
            maxLength={30}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            // the field's focus ring lives on the label (focus-within) — kill
            // the global input ring or both draw at once
            className="w-[7.5em] min-w-0 border-none bg-transparent p-0 font-medium text-ink outline-none focus-visible:!outline-none placeholder:text-faint placeholder:font-normal"
            style={{ fontSize: "16px" }}
          />
        </label>
        <button
          type="submit"
          className="rounded-input bg-ink px-[22px] py-[14px] font-sans text-[14.5px] font-semibold text-paper hover:bg-ink-soft"
        >
          Claim it
        </button>
      </div>
      {/* A minimum-height slot keeps the form steady while still leaving room
          for an explicit retry when the availability service is unreachable. */}
      <div
        id={center ? undefined : "claim-hint"}
        aria-live="polite"
        className="mt-2 min-h-[17px] font-sans text-[12px]"
        style={{ color: hint?.ok ? T.bronzeHover : T.body }}
      >
        {handle ? hint?.msg : ""}
        {handle && hint?.status === "error" && (
          <button
            type="button"
            onClick={hint.retry}
            className="ml-2 min-h-[44px] px-1 font-semibold text-bronze-ink"
          >
            Try again
          </button>
        )}
      </div>
    </form>
  );
}
