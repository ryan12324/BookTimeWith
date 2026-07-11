import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb, type Db } from "@/db/client";
import { queueOwnerCalendarReconciliation } from "@/lib/booking-calendar";
import { sessionOwner } from "@/lib/authz";
import {
  exchangeCode,
  OAUTH_STATE_COOKIE,
  type Provider,
  withCalendarConnectionMutex,
} from "@/lib/calendar";
import { canonicalAppUrl } from "@/lib/urls";
import { withOwnerMutex } from "@/lib/keyed-mutex";

export const dynamic = "force-dynamic";

/**
 * OAuth redirect target: exchange the code, store tokens, back to settings.
 * Guarded against CSRF/account-grafting — requires the owner's own session AND
 * a `state` nonce that matches the httpOnly cookie set when consent began.
 * Without both, an attacker who holds a valid provider code can't graft their
 * calendar onto the owner's account.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = canonicalAppUrl(request.url);
  const fail = NextResponse.redirect(new URL("/app/settings?calendar=failed", appUrl));
  fail.cookies.delete(OAUTH_STATE_COOKIE);

  const stateParts = (url.searchParams.get("state") ?? "").split(".");
  const [provider, nonce] = stateParts;
  const code = url.searchParams.get("code");
  const cookieParts =
    (await cookies()).get(OAUTH_STATE_COOKIE)?.value.split(".") ?? [];
  const [cookieOwnerId, cookieProvider, cookieGenerationRaw, cookieNonce] =
    cookieParts;
  const cookieGeneration = Number(cookieGenerationRaw);

  if (
    !code ||
    stateParts.length !== 2 ||
    cookieParts.length !== 4 ||
    !["google", "outlook"].includes(provider) ||
    !nonce ||
    !cookieOwnerId ||
    cookieProvider !== provider ||
    !Number.isSafeInteger(cookieGeneration) ||
    cookieGeneration < 1 ||
    !cookieNonce ||
    nonce !== cookieNonce
  ) {
    return fail;
  }

  const db = await getDb();
  const owner = await sessionOwner(db);
  if (!owner || owner.id !== cookieOwnerId) return fail;
  try {
    await withOwnerMutex(owner.id, async () => {
      const currentOwner = await db.query.owners.findFirst({
        where: eq(schema.owners.id, owner.id),
      });
      if (
        !currentOwner ||
        currentOwner.sessionVersion !== owner.sessionVersion ||
        currentOwner.calendarGeneration !== cookieGeneration
      ) {
        throw new Error("Calendar connection intent is no longer current");
      }
      // The process-local owner mutex spans the provider exchange; the locked
      // PostgreSQL recheck below is the cross-process commit authority.
      const tokens = await exchangeCode(provider as Provider, code, appUrl);
      const priorConnection = await db.query.calendarConnections.findFirst({
        where: eq(schema.calendarConnections.ownerId, owner.id),
      });
      const install = () => db.transaction(async (tx) => {
        await tx.execute(
          sql`select ${schema.owners.id} from ${schema.owners} where ${schema.owners.id} = ${owner.id} for update`,
        );
        const finalOwner = await tx.query.owners.findFirst({
          where: eq(schema.owners.id, owner.id),
        });
        if (
          !finalOwner ||
          finalOwner.sessionVersion !== owner.sessionVersion ||
          finalOwner.calendarGeneration !== cookieGeneration
        ) {
          throw new Error("Calendar connection intent changed during exchange");
        }
        await tx
          .delete(schema.calendarConnections)
          .where(eq(schema.calendarConnections.ownerId, owner.id));
        await tx.insert(schema.calendarConnections).values({
          ownerId: owner.id,
          provider: provider as Provider,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          syncStatus: "connected",
          lastSyncedAt: new Date(),
          lastError: null,
        });
        await queueOwnerCalendarReconciliation(
          tx as unknown as Db,
          owner.id,
          provider as Provider,
        );
      });
      if (priorConnection) {
        await withCalendarConnectionMutex(priorConnection, install);
      } else {
        await install();
      }
    });
    // Do not revoke during replacement: Google revocation removes the app grant
    // for that Google user/client and can invalidate another BTW owner using
    // the same Google account. Disconnect removes local encrypted credentials.
    const res = NextResponse.redirect(new URL("/app/settings", appUrl));
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch {
    return fail;
  }
}
