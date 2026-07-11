import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { retryBookingEmailOutbox } from "@/emails/send";
import { recoverMissingBookingMail } from "@/lib/booking-mail-recovery";
import { canonicalBookingUrl } from "@/lib/urls";

export const dynamic = "force-dynamic";

/** Recover post-commit booking mail independently from expiring auth links. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (
    process.env.NODE_ENV === "production" &&
    (!cronSecret || cronSecret.length < 32)
  ) {
    return NextResponse.json(
      { error: "service configuration error" },
      { status: 503 },
    );
  }
  if (
    cronSecret &&
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const result = await recoverMissingBookingMail(
    db,
    canonicalBookingUrl(request.url),
    new Date(),
    5,
  );
  const delivery = await retryBookingEmailOutbox(db);
  return NextResponse.json({
    ran: new Date().toISOString(),
    ...result,
    delivery,
  });
}
