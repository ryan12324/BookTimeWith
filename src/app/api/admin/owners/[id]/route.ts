import { NextResponse } from "next/server";
import { eq, sql, desc } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { requireAdminSession } from "@/lib/admin-auth";
import { takeRateLimit, requestIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = await getDb();

  const admin = await requireAdminSession(db);
  if (!admin) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rateLimit = await takeRateLimit(db, {
    scope: "admin-owner-detail",
    identifier: requestIp(request),
    limit: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid owner id" }, { status: 400 });
  }

  const owner = await db.query.owners.findFirst({
    where: eq(schema.owners.id, id),
  });

  if (!owner) {
    return NextResponse.json({ error: "owner not found" }, { status: 404 });
  }

  const [service, connection, bookingStats, recentBookings, availability] =
    await Promise.all([
      db.query.services.findFirst({
        where: eq(schema.services.ownerId, id),
      }),
      db.query.calendarConnections.findFirst({
        where: eq(schema.calendarConnections.ownerId, id),
      }),
      db
        .select({
          total: sql<number>`count(*)::int`,
          confirmed: sql<number>`count(*) filter (where ${schema.bookings.status} = 'confirmed')::int`,
          cancelled: sql<number>`count(*) filter (where ${schema.bookings.status} = 'cancelled')::int`,
          moved: sql<number>`count(*) filter (where ${schema.bookings.status} = 'moved')::int`,
        })
        .from(schema.bookings)
        .where(eq(schema.bookings.ownerId, id)),
      db.query.bookings.findMany({
        where: eq(schema.bookings.ownerId, id),
        orderBy: desc(schema.bookings.createdAt),
        limit: 5,
        columns: {
          id: true,
          startsAt: true,
          status: true,
          clientName: true,
          createdAt: true,
        },
      }),
      db.query.availability.findMany({
        where: eq(schema.availability.ownerId, id),
      }),
    ]);

  const stripeIdTruncated = owner.stripeCustomerId
    ? `${owner.stripeCustomerId.slice(0, 12)}...`
    : null;
  const subscriptionIdTruncated = owner.stripeSubscriptionId
    ? `${owner.stripeSubscriptionId.slice(0, 12)}...`
    : null;

  return NextResponse.json({
    owner: {
      id: owner.id,
      email: owner.email,
      pendingEmail: owner.pendingEmail,
      emailVerified: owner.emailVerifiedAt !== null,
      emailVerifiedAt: owner.emailVerifiedAt?.toISOString() ?? null,
      name: owner.name,
      handle: owner.handle,
      publicUrl: `https://booktimewith.link/${owner.handle}`,
      timezone: owner.timezone,
      currency: owner.currency,
      planStatus: owner.planStatus,
      trialEndsAt: owner.trialEndsAt?.toISOString() ?? null,
      accessEndsAt: owner.accessEndsAt?.toISOString() ?? null,
      graceUntil: owner.graceUntil?.toISOString() ?? null,
      hasStripe: owner.stripeCustomerId !== null,
      hasSubscription: owner.stripeSubscriptionId !== null,
      stripeCustomerIdTruncated: stripeIdTruncated,
      stripeSubscriptionIdTruncated: subscriptionIdTruncated,
      setupComplete: owner.setupCompletedAt !== null,
      setupCompletedAt: owner.setupCompletedAt?.toISOString() ?? null,
      createdAt: owner.createdAt.toISOString(),
      notifyOnChange: owner.notifyOnChange,
      notifyMorningSummary: owner.notifyMorningSummary,
    },
    service: service
      ? {
          name: service.name,
          durationMinutes: service.durationMinutes,
          locationMode: service.locationMode,
          hasOwnerAddress: !!service.ownerAddress,
          hasMeetingLink: !!service.meetingLink,
        }
      : null,
    calendar: connection
      ? {
          provider: connection.provider,
          syncStatus: connection.syncStatus,
          lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
          lastError: connection.lastError,
          connectedAt: connection.connectedAt.toISOString(),
        }
      : null,
    bookingStats: bookingStats[0] ?? { total: 0, confirmed: 0, cancelled: 0, moved: 0 },
    recentBookings: recentBookings.map((b) => ({
      id: b.id,
      startsAt: b.startsAt.toISOString(),
      status: b.status,
      clientName: b.clientName,
      createdAt: b.createdAt.toISOString(),
    })),
    availabilitySlots: availability.length,
  });
}
