import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { retryAuthEmailOutbox } from "@/emails/send";

export const dynamic = "force-dynamic";

/** Fast, isolated retry lane for expiring sign-in and verification links. */
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

  const result = await retryAuthEmailOutbox(await getDb());
  return NextResponse.json({ ran: new Date().toISOString(), ...result });
}
