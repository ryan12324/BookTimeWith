import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb, type Db } from "@/db/client";
import { sessionOwner } from "@/lib/authz";
import { clearOwnerCalendarState } from "@/lib/booking-calendar";
import { withCalendarConnectionMutex } from "@/lib/calendar";
import { withOwnerMutex } from "@/lib/keyed-mutex";

export const dynamic = "force-dynamic";

export async function POST() {
  const db = await getDb();
  const owner = await sessionOwner(db);
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await withOwnerMutex(owner.id, async () => {
    const lockedOwner = await db.query.owners.findFirst({
      where: eq(schema.owners.id, owner.id),
    });
    if (!lockedOwner || lockedOwner.sessionVersion !== owner.sessionVersion) {
      return "unauthorized" as const;
    }

    // Invalidate every consent flow that started before this disconnect.
    const [intent] = await db
      .update(schema.owners)
      .set({
        calendarGeneration: sql`${schema.owners.calendarGeneration} + 1`,
      })
      .where(
        and(
          eq(schema.owners.id, owner.id),
          eq(schema.owners.sessionVersion, owner.sessionVersion),
          eq(
            schema.owners.calendarGeneration,
            lockedOwner.calendarGeneration,
          ),
        ),
      )
      .returning({ generation: schema.owners.calendarGeneration });
    if (!intent) return "unauthorized" as const;

    const connection = await db.query.calendarConnections.findFirst({
      where: eq(schema.calendarConnections.ownerId, owner.id),
    });
    const disconnect = () => db.transaction(async (tx) => {
      await tx
        .delete(schema.calendarConnections)
        .where(eq(schema.calendarConnections.ownerId, owner.id));
      await clearOwnerCalendarState(tx as unknown as Db, owner.id);
    });
    if (connection) {
      await withCalendarConnectionMutex(connection, disconnect);
    } else {
      await disconnect();
    }
    return "ok" as const;
  });

  if (result === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
