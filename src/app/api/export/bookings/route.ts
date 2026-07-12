import { asc, eq } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { sessionOwner } from "@/lib/authz";

export const dynamic = "force-dynamic";

const csvCell = (value: unknown) => {
  let text = value == null ? "" : String(value);
  // Prevent spreadsheet formula execution when owners open client-supplied data.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export async function GET() {
  const db = await getDb();
  const owner = await sessionOwner(db);
  if (!owner) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const bookings = await db.query.bookings.findMany({
    where: eq(schema.bookings.ownerId, owner.id),
    orderBy: asc(schema.bookings.startsAt),
  });

  const headings = [
    "Booking ID",
    "Status",
    "Starts (UTC)",
    "Ends (UTC)",
    `Local date (${owner.timezone})`,
    "Local time",
    "Service",
    "Client name",
    "Client email",
    "Client timezone",
    "Location mode",
    "Location",
    "Meeting link",
    "Client-provided address",
    "Last changed by",
    "Created (UTC)",
  ];
  const rows = bookings.map((booking) => [
    booking.id,
    booking.status,
    booking.startsAt.toISOString(),
    booking.endsAt.toISOString(),
    formatInTimeZone(booking.startsAt, owner.timezone, "yyyy-MM-dd"),
    formatInTimeZone(booking.startsAt, owner.timezone, "HH:mm"),
    booking.serviceNameSnapshot,
    booking.clientName,
    booking.clientEmail,
    booking.clientTimezone ?? "",
    booking.locationModeSnapshot,
    booking.locationSnapshot ?? "",
    booking.meetingLink ?? "",
    booking.clientAddress ?? "",
    booking.lastActionBy ?? "",
    booking.createdAt.toISOString(),
  ]);
  const csv = [headings, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  const safeHandle = owner.handle.replace(/[^a-z0-9-]/g, "") || "bookings";

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeHandle}-bookings.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
