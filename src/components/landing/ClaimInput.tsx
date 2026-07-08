"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** The "claim your link" input: prefix + editable handle + "Claim it" → onboarding. */
export function ClaimInput({ center = false }: { center?: boolean }) {
  const router = useRouter();
  const [handle, setHandle] = useState("");

  const claim = () => {
    const h = handle.trim() || "yourname";
    router.push(`/app/setup?handle=${encodeURIComponent(h)}`);
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-[10px] ${center ? "justify-center" : ""}`}
    >
      <div className="flex items-center rounded-input border border-line bg-white px-[15px] py-[13px] font-sans text-[14.5px] text-faint">
        booktimewith.link/
        <input
          value={handle}
          onChange={(e) =>
            setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
          }
          onKeyDown={(e) => e.key === "Enter" && claim()}
          placeholder="yourname"
          aria-label="Choose your booking link handle"
          className="w-[7.5em] min-w-0 border-none bg-transparent p-0 font-medium text-ink outline-none placeholder:text-faint placeholder:font-normal"
          style={{ fontSize: "14.5px" }}
        />
      </div>
      <button
        type="button"
        onClick={claim}
        className="rounded-input bg-ink px-[22px] py-[14px] font-sans text-[14.5px] font-semibold text-paper hover:bg-ink-soft"
      >
        Claim it
      </button>
    </div>
  );
}
