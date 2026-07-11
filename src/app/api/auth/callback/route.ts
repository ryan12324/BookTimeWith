import { NextResponse } from "next/server";
import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  notInArray,
  sql,
} from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { hashToken, identityTokenVersion } from "@/lib/auth-tokens";
import {
  assertSessionConfiguration,
  createSession,
  safeNextUrl,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
} from "@/lib/session";
import { canonicalAppUrl } from "@/lib/urls";
import { withOwnerMutex } from "@/lib/keyed-mutex";

export const dynamic = "force-dynamic";

class InvalidSigninTokenError extends Error {}

/** The emailed sign-in link: consume the token, set the session, go to /app. */
export async function GET(request: Request) {
  const db = await getDb();
  const url = new URL(request.url);
  const appUrl = canonicalAppUrl(request.url);
  try {
    assertSessionConfiguration();
  } catch {
    return NextResponse.json(
      { error: "Sign-in is temporarily unavailable." },
      { status: 503 },
    );
  }
  const token = url.searchParams.get("token") ?? "";
  const next = url.searchParams.get("next");
  const tokenVersion = token ? identityTokenVersion(token) : null;
  const tokenHash = token && tokenVersion !== null ? await hashToken(token) : null;
  const candidate = tokenHash
    ? await db.query.authTokens.findFirst({
        where: and(
          eq(schema.authTokens.tokenHash, tokenHash),
          eq(schema.authTokens.kind, "owner_signin"),
          isNull(schema.authTokens.usedAt),
          gt(schema.authTokens.expiresAt, new Date()),
        ),
      })
    : null;

  let login: { ownerId: string; sessionVersion: number; issuedAt: Date } | null =
    null;
  if (candidate?.ownerId && tokenVersion !== null) {
    try {
      login = await withOwnerMutex(candidate.ownerId, () =>
        db.transaction(async (tx) => {
          const consumedAt = new Date();
          const currentToken = await tx.query.authTokens.findFirst({
            where: and(
              eq(schema.authTokens.id, candidate.id),
              eq(schema.authTokens.tokenHash, tokenHash!),
              eq(schema.authTokens.kind, "owner_signin"),
              isNull(schema.authTokens.usedAt),
              gt(schema.authTokens.expiresAt, consumedAt),
            ),
          });
          if (!currentToken?.ownerId) throw new InvalidSigninTokenError();
          await tx.execute(
            sql`select ${schema.owners.id} from ${schema.owners} where ${schema.owners.id} = ${currentToken.ownerId} for update`,
          );
          const lockedOwner = await tx.query.owners.findFirst({
            where: eq(schema.owners.id, currentToken.ownerId),
          });
          if (!lockedOwner || lockedOwner.sessionVersion !== tokenVersion) {
            throw new InvalidSigninTokenError();
          }
          if (currentToken.identityEmail !== lockedOwner.email) {
            throw new InvalidSigninTokenError();
          }
          const [consumed] = await tx
            .update(schema.authTokens)
            .set({ usedAt: consumedAt })
            .where(
              and(
                eq(schema.authTokens.id, currentToken.id),
                isNull(schema.authTokens.usedAt),
                gt(schema.authTokens.expiresAt, consumedAt),
              ),
            )
            .returning({ id: schema.authTokens.id });
          if (!consumed) throw new InvalidSigninTokenError();

          const [rotatedOwner] = await tx
            .update(schema.owners)
            .set({
              sessionVersion: sql`${schema.owners.sessionVersion} + 1`,
              ...(lockedOwner.emailVerifiedAt
                ? {}
                : { emailVerifiedAt: consumedAt }),
            })
            .where(
              and(
                eq(schema.owners.id, lockedOwner.id),
                eq(schema.owners.sessionVersion, lockedOwner.sessionVersion),
              ),
            )
            .returning({
              id: schema.owners.id,
              sessionVersion: schema.owners.sessionVersion,
            });
          if (!rotatedOwner) throw new InvalidSigninTokenError();

          // sessionVersion also guards the owner's current email identity on
          // durable non-auth mail. This login did not change that identity, so
          // carry still-retryable booking/billing rows to the new generation.
          await tx
            .update(schema.emailOutbox)
            .set({ ownerRecipientVersion: rotatedOwner.sessionVersion })
            .where(
              and(
                eq(schema.emailOutbox.ownerId, lockedOwner.id),
                eq(
                  schema.emailOutbox.ownerRecipientVersion,
                  lockedOwner.sessionVersion,
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

          return {
            ownerId: rotatedOwner.id,
            sessionVersion: rotatedOwner.sessionVersion,
            issuedAt: consumedAt,
          };
        }),
      );
    } catch (error) {
      if (!(error instanceof InvalidSigninTokenError)) throw error;
    }
  }

  if (!login) {
    return NextResponse.redirect(new URL("/signin?expired=1", appUrl));
  }

  const res = NextResponse.redirect(safeNextUrl(next, appUrl));
  res.cookies.set(
    SESSION_COOKIE,
    await createSession(login.ownerId, login.issuedAt, login.sessionVersion),
    {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(appUrl).protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
    },
  );
  return res;
}
