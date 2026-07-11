import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { bookingByManageToken, ownerByHandle, slotsFor } from "@/db/repo";
import { canAcceptBookings } from "@/lib/entitlements";
import { requestIp, takeRateLimit } from "@/lib/rate-limit";
import { CalendarUnavailableError } from "@/lib/calendar";

export const dynamic = "force-dynamic";

function scopeFromReferer(request: Request): { handle?: string; manageToken?: string } {
  const referer = request.headers.get("referer");
  if (!referer) return {};
  try {
    const parts = new URL(referer).pathname.split("/").filter(Boolean);
    if (parts[0] === "manage" && parts[1]) return { manageToken: decodeURIComponent(parts[1]) };
    if (parts[0]) return { handle: parts[0].toLowerCase() };
  } catch {
    // An explicit query scope below remains the supported API contract.
  }
  return {};
}

async function scopedOwner(request: Request, db: Awaited<ReturnType<typeof getDb>>) {
  const url = new URL(request.url);
  const fallback = scopeFromReferer(request);
  const handle = url.searchParams.get("handle")?.toLowerCase() ?? fallback.handle;
  if (handle) return (await ownerByHandle(db, handle)) ?? null;

  const manageToken = url.searchParams.get("manageToken") ?? fallback.manageToken;
  if (!manageToken) return null;
  const booking = await bookingByManageToken(db, manageToken);
  if (!booking) return null;
  return (
    (await db.query.owners.findFirst({ where: eq(schema.owners.id, booking.ownerId) })) ??
    null
  );
}

/**
 * Live bookable slots for the public page: painted availability − confirmed
 * bookings − away periods, stepped by service length, min-notice and horizon
 * applied. Slots carry UTC instants; the client renders them in its own zone.
 */
export async function GET(request: Request) {
  const db = await getDb();
  const owner = await scopedOwner(request, db);
  if (!owner || !owner.setupCompletedAt) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const limit = await takeRateLimit(db, {
    scope: "public-slots",
    identifier: `${requestIp(request)}:${owner.id}`,
    limit: 120,
    windowMs: 10 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many availability requests. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }
  // The viewer's IANA zone (sent by the booking page) decides how slots are
  // labelled and bucketed into days — a 9:00-London slot files under Monday
  // evening for someone in Sydney. Validated before use; falls back to the
  // owner's zone if absent or bogus.
  const tzParam = new URL(request.url).searchParams.get("tz");
  let viewerTz: string | undefined;
  if (tzParam) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tzParam });
      viewerTz = tzParam;
    } catch {
      viewerTz = undefined;
    }
  }
  let days;
  try {
    days = !canAcceptBookings(owner)
      ? []
      : await slotsFor(db, owner.id, new Date(), 3, viewerTz);
  } catch (error) {
    if (error instanceof CalendarUnavailableError) {
      return NextResponse.json(
        {
          error:
            "Availability is temporarily unavailable while the calendar reconnects. Try again shortly.",
        },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    throw error;
  }
  return NextResponse.json(
    {
      days: days.map((d) => ({
        ...d,
        slots: d.slots.map((s) => ({ startsAt: s.start.toISOString(), label: s.label })),
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
