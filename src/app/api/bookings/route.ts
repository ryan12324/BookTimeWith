import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Create a booking. Phase-2 responsibilities (stubbed here):
 *  - re-check the slot inside a transaction against the (owner, starts_at) unique
 *    constraint; on conflict return 409 "that time just went — here's what's open"
 *  - persist, then queue the client confirmation (+ .ics) and owner notification
 *    via the Cloudflare Email Worker
 *  - anti-abuse: per-IP/email rate limit, disposable-email blocklist, Turnstile
 *    only when limits trip.
 */
const BookingInput = z.object({
  handle: z.string().min(3),
  startsAt: z.string().datetime(),
  clientName: z.string().min(1).max(120),
  clientEmail: z.string().email(),
  clientAddress: z.string().max(240).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BookingInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid booking", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Phase 2: transactional slot re-check + persist + email. For now, echo back a
  // deterministic mock confirmation so the client flow has a contract to call.
  return NextResponse.json(
    {
      ok: true,
      booking: { id: "bk_demo", status: "confirmed", ...parsed.data },
      note: "Mock response — persistence, race-check, and emails land in phase 2.",
    },
    { status: 201 },
  );
}
