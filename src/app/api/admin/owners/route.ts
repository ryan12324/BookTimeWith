import { NextResponse } from "next/server";
import { and, desc, eq, inArray, or, ilike, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { requireAdminSession } from "@/lib/admin-auth";
import { takeRateLimit, requestIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request) {
  const db = await getDb();

  const admin = await requireAdminSession(db);
  if (!admin) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rateLimit = await takeRateLimit(db, {
    scope: "admin-list-owners",
    identifier: requestIp(request),
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase();
  const limitParam = Number(url.searchParams.get("limit")) || DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, limitParam), MAX_LIMIT);
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  try {
    const whereClause = q
      ? or(
          ilike(schema.owners.handle, `%${q}%`),
          ilike(schema.owners.email, `%${q}%`),
        )
      : undefined;

    const [owners, countResult] = await Promise.all([
      db
        .select({
          id: schema.owners.id,
          email: schema.owners.email,
          pendingEmail: schema.owners.pendingEmail,
          emailVerifiedAt: schema.owners.emailVerifiedAt,
          name: schema.owners.name,
          handle: schema.owners.handle,
          timezone: schema.owners.timezone,
          planStatus: schema.owners.planStatus,
          trialEndsAt: schema.owners.trialEndsAt,
          accessEndsAt: schema.owners.accessEndsAt,
          graceUntil: schema.owners.graceUntil,
          stripeCustomerId: schema.owners.stripeCustomerId,
          stripeSubscriptionId: schema.owners.stripeSubscriptionId,
          setupCompletedAt: schema.owners.setupCompletedAt,
          createdAt: schema.owners.createdAt,
          currency: schema.owners.currency,
        })
        .from(schema.owners)
        .where(whereClause)
        .orderBy(desc(schema.owners.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.owners)
        .where(whereClause),
    ]);

    const ownerIds = owners.map((o) => o.id);

    const [services, connections, bookingCounts] = await Promise.all([
      ownerIds.length
        ? db
            .select({
              ownerId: schema.services.ownerId,
              name: schema.services.name,
              durationMinutes: schema.services.durationMinutes,
              locationMode: schema.services.locationMode,
            })
            .from(schema.services)
            .where(inArray(schema.services.ownerId, ownerIds))
        : [],
      ownerIds.length
        ? db
            .select({
              ownerId: schema.calendarConnections.ownerId,
              provider: schema.calendarConnections.provider,
              syncStatus: schema.calendarConnections.syncStatus,
            })
            .from(schema.calendarConnections)
            .where(inArray(schema.calendarConnections.ownerId, ownerIds))
        : [],
      ownerIds.length
        ? db
            .select({
              ownerId: schema.bookings.ownerId,
              count: sql<number>`count(*)::int`,
            })
            .from(schema.bookings)
            .where(
              and(
                inArray(schema.bookings.ownerId, ownerIds),
                eq(schema.bookings.status, "confirmed"),
              ),
            )
            .groupBy(schema.bookings.ownerId)
        : [],
    ]);

    const serviceMap = new Map(services.map((s) => [s.ownerId, s]));
    const connectionMap = new Map(connections.map((c) => [c.ownerId, c]));
    const bookingCountMap = new Map(bookingCounts.map((b) => [b.ownerId, b.count]));

    const results = owners.map((o) => {
      const service = serviceMap.get(o.id);
      const connection = connectionMap.get(o.id);
      const stripeIdTruncated = o.stripeCustomerId
        ? `${o.stripeCustomerId.slice(0, 8)}...`
        : null;

      return {
        id: o.id,
        email: o.email,
        pendingEmail: o.pendingEmail,
        emailVerified: o.emailVerifiedAt !== null,
        name: o.name,
        handle: o.handle,
        publicUrl: `https://booktimewith.link/${o.handle}`,
        timezone: o.timezone,
        currency: o.currency,
        planStatus: o.planStatus,
        trialEndsAt: o.trialEndsAt?.toISOString() ?? null,
        accessEndsAt: o.accessEndsAt?.toISOString() ?? null,
        graceUntil: o.graceUntil?.toISOString() ?? null,
        hasStripe: o.stripeCustomerId !== null,
        hasSubscription: o.stripeSubscriptionId !== null,
        stripeCustomerIdTruncated: stripeIdTruncated,
        setupComplete: o.setupCompletedAt !== null,
        setupCompletedAt: o.setupCompletedAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
        serviceName: service?.name ?? null,
        serviceDuration: service?.durationMinutes ?? null,
        serviceLocation: service?.locationMode ?? null,
        calendarConnected: connection !== undefined,
        calendarProvider: connection?.provider ?? null,
        calendarSyncStatus: connection?.syncStatus ?? null,
        bookingCount: bookingCountMap.get(o.id) ?? 0,
      };
    });

    return NextResponse.json({
      owners: results,
      total: countResult[0]?.count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Admin owners list failed", error);
    return NextResponse.json(
      { error: "Could not load owners. Try again shortly." },
      { status: 500 },
    );
  }
}
