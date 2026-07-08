import { NextResponse } from "next/server";
import { checkHandle, normalizeHandle } from "@/lib/handles";

/**
 * Live handle-availability check driving the onboarding "✓ … is available" hint
 * (debounce on the client). Phase 2 also checks taken handles + active redirects
 * in the DB; here it enforces the format + reserved/profanity rules.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("handle") ?? "";
  const handle = normalizeHandle(raw);
  const status = checkHandle(handle);

  const message: Record<typeof status, string> = {
    available: `booktimewith.link/${handle} is available`,
    "too-short": "Handles are at least 3 characters.",
    reserved: "That one's taken — try another.",
    invalid: "Letters, numbers and dashes only.",
  };

  return NextResponse.json({
    handle,
    available: status === "available",
    status,
    message: message[status],
  });
}
