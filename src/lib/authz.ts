import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import {
  SESSION_COOKIE,
  verifySession,
  verifySessionDetails,
} from "@/lib/session";

/**
 * Resolve the signed session to an owner that still exists. Merely possessing a
 * correctly-signed owner id is not enough: deleting an account must revoke its
 * session, and one owner's cookie must never authorize another owner's rows.
 */
export async function sessionOwner(db: Db) {
  const session = await verifySessionDetails(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (!session) return null;
  const owner = await db.query.owners.findFirst({
    where: eq(schema.owners.id, session.ownerId),
  });
  return owner?.sessionVersion === session.sessionVersion ? owner : null;
}

/** Require a live owner session, optionally for one exact owner id. */
export async function ownerSessionOk(db: Db, expectedOwnerId?: string): Promise<boolean> {
  const owner = await sessionOwner(db);
  return Boolean(owner && (!expectedOwnerId || owner.id === expectedOwnerId));
}

/** The session's owner id, or null — no DB required. */
export async function sessionOwnerId(): Promise<string | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}
