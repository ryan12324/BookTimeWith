import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { SESSION_COOKIE, verifySessionDetails } from "@/lib/session";
import { canonicalAppUrl } from "@/lib/urls";
import { withOwnerMutex } from "@/lib/keyed-mutex";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await verifySessionDetails(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (session) {
    try {
      const db = await getDb();
      await withOwnerMutex(session.ownerId, () =>
        db.transaction(async (tx) => {
          const [rotatedOwner] = await tx
            .update(schema.owners)
            .set({
              sessionVersion: sql`${schema.owners.sessionVersion} + 1`,
            })
            .where(
              and(
                eq(schema.owners.id, session.ownerId),
                eq(schema.owners.sessionVersion, session.sessionVersion),
              ),
            )
            .returning({
              sessionVersion: schema.owners.sessionVersion,
            });
          if (!rotatedOwner) return;

          // Signing out revokes sessions, not the owner's email identity. Keep
          // retryable non-auth mail valid under the newly rotated generation.
          await tx
            .update(schema.emailOutbox)
            .set({ ownerRecipientVersion: rotatedOwner.sessionVersion })
            .where(
              and(
                eq(schema.emailOutbox.ownerId, session.ownerId),
                eq(
                  schema.emailOutbox.ownerRecipientVersion,
                  session.sessionVersion,
                ),
                inArray(schema.emailOutbox.delivery, [
                  "pending",
                  "failed",
                  "processing",
                  "skipped",
                ]),
                notInArray(schema.emailOutbox.template, [
                  "owner-sign-in",
                  "owner-verify-email",
                ]),
              ),
            );
        }),
      );
    } catch (error) {
      console.error("Sign-out session revocation failed", error);
      return NextResponse.json(
        { error: "Sign-out could not be completed. Try again shortly." },
        { status: 503 },
      );
    }
  }

  const res = NextResponse.redirect(new URL("/", canonicalAppUrl(request.url)), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
