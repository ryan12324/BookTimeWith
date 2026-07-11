import { NextResponse } from "next/server";
import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { hashToken, identityTokenVersion } from "@/lib/auth-tokens";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
} from "@/lib/session";
import { canonicalAppUrl } from "@/lib/urls";
import { withOwnerMutex } from "@/lib/keyed-mutex";

export const dynamic = "force-dynamic";

type Verification = {
  ownerId: string;
  sessionVersion: number;
  identityChanged: boolean;
};

const retryable = ["pending", "failed", "processing", "skipped"];
const clientDirectedTemplates = [
  "client-confirmation",
  "client-owner-changed",
  "client-reminder",
];

/** The link in the verification email: single-use, address-bound, 24h expiry. */
export async function GET(request: Request) {
  const db = await getDb();
  const url = new URL(request.url);
  const appUrl = canonicalAppUrl(request.url);
  const token = url.searchParams.get("token") ?? "";
  const now = new Date();
  const tokenVersion = token ? identityTokenVersion(token) : null;
  const tokenHash = token && tokenVersion !== null ? await hashToken(token) : null;
  const candidate = tokenHash
    ? await db.query.authTokens.findFirst({
        where: and(
          eq(schema.authTokens.tokenHash, tokenHash),
          eq(schema.authTokens.kind, "email_verify"),
          isNull(schema.authTokens.usedAt),
          gt(schema.authTokens.expiresAt, now),
        ),
      })
    : null;

  let verification: Verification | "taken" | null = null;
  if (candidate?.ownerId && tokenVersion !== null) {
    try {
      verification = await withOwnerMutex(candidate.ownerId, () =>
        db.transaction(async (tx) => {
          const currentToken = await tx.query.authTokens.findFirst({
            where: and(
              eq(schema.authTokens.id, candidate.id),
              eq(schema.authTokens.tokenHash, tokenHash!),
              eq(schema.authTokens.kind, "email_verify"),
              isNull(schema.authTokens.usedAt),
              gt(schema.authTokens.expiresAt, now),
            ),
          });
          if (!currentToken?.ownerId || !currentToken.identityEmail) return null;
          await tx.execute(
            sql`select ${schema.owners.id} from ${schema.owners} where ${schema.owners.id} = ${currentToken.ownerId} for update`,
          );
          const owner = await tx.query.owners.findFirst({
            where: eq(schema.owners.id, currentToken.ownerId),
          });
          if (!owner || owner.sessionVersion !== tokenVersion) return null;

          const identityEmail = currentToken.identityEmail.toLowerCase().trim();
          const verifiesActive = identityEmail === owner.email;
          const verifiesPending = identityEmail === owner.pendingEmail;
          if (!verifiesActive && !verifiesPending) return null;

          if (verifiesPending) {
            const conflict = await tx.query.owners.findFirst({
              where: and(
                eq(schema.owners.email, identityEmail),
                ne(schema.owners.id, owner.id),
              ),
            });
            if (conflict) return "taken" as const;
          }

          const [consumed] = await tx
            .update(schema.authTokens)
            .set({ usedAt: now })
            .where(
              and(
                eq(schema.authTokens.id, currentToken.id),
                isNull(schema.authTokens.usedAt),
                gt(schema.authTokens.expiresAt, now),
              ),
            )
            .returning({ id: schema.authTokens.id });
          if (!consumed) return null;

          let sessionVersion = owner.sessionVersion;
          if (verifiesPending) {
            const [changed] = await tx
              .update(schema.owners)
              .set({
                email: identityEmail,
                pendingEmail: null,
                emailVerifiedAt: now,
                sessionVersion: sql`${schema.owners.sessionVersion} + 1`,
              })
              .where(
                and(
                  eq(schema.owners.id, owner.id),
                  eq(schema.owners.pendingEmail, identityEmail),
                  eq(schema.owners.sessionVersion, owner.sessionVersion),
                ),
              )
              .returning({ sessionVersion: schema.owners.sessionVersion });
            if (!changed) return null;
            sessionVersion = changed.sessionVersion;

            // Carry retryable business mail to the newly proven identity.
            await tx
              .update(schema.emailOutbox)
              .set({
                replyTo: identityEmail,
                ownerRecipientVersion: sessionVersion,
              })
              .where(
                and(
                  eq(schema.emailOutbox.ownerId, owner.id),
                  eq(schema.emailOutbox.ownerRecipientVersion, owner.sessionVersion),
                  inArray(schema.emailOutbox.template, clientDirectedTemplates),
                  inArray(schema.emailOutbox.delivery, retryable),
                ),
              );
            await tx
              .update(schema.emailOutbox)
              .set({
                toEmail: identityEmail,
                ownerRecipientVersion: sessionVersion,
              })
              .where(
                and(
                  eq(schema.emailOutbox.ownerId, owner.id),
                  eq(schema.emailOutbox.ownerRecipientVersion, owner.sessionVersion),
                  inArray(schema.emailOutbox.delivery, retryable),
                  notInArray(schema.emailOutbox.template, [
                    ...clientDirectedTemplates,
                    "owner-sign-in",
                    "owner-verify-email",
                  ]),
                ),
              );
          } else {
            await tx
              .update(schema.owners)
              .set({ emailVerifiedAt: now })
              .where(eq(schema.owners.id, owner.id));
          }

          // Every other identity capability was minted for the superseded
          // state. Business mail above remains useful; auth mail does not.
          await tx
            .delete(schema.authTokens)
            .where(
              and(
                eq(schema.authTokens.ownerId, owner.id),
                inArray(schema.authTokens.kind, [
                  "email_verify",
                  ...(verifiesPending ? (["owner_signin"] as const) : []),
                ]),
              ),
            );
          await tx
            .update(schema.emailOutbox)
            .set({
              delivery: "expired",
              lastError: verifiesPending
                ? "The owner verified a new email identity"
                : "Email verification is already complete",
              html: "",
              attachments: null,
            })
            .where(
              and(
                eq(schema.emailOutbox.ownerId, owner.id),
                inArray(schema.emailOutbox.template, [
                  "owner-verify-email",
                  ...(verifiesPending ? (["owner-sign-in"] as const) : []),
                ]),
                inArray(schema.emailOutbox.delivery, retryable),
              ),
            );

          return {
            ownerId: owner.id,
            sessionVersion,
            identityChanged: verifiesPending,
          };
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("owners_email") || message.includes("email_unique")) {
        verification = "taken";
      } else {
        throw error;
      }
    }
  }

  if (verification === "taken") {
    return NextResponse.redirect(new URL("/app/settings?verified=taken", appUrl));
  }
  if (!verification) {
    return NextResponse.redirect(new URL("/app/settings?verified=expired", appUrl));
  }

  const response = NextResponse.redirect(
    new URL("/app/settings?verified=1", appUrl),
  );
  if (verification.identityChanged) {
    response.cookies.set(
      SESSION_COOKIE,
      await createSession(
        verification.ownerId,
        now,
        verification.sessionVersion,
      ),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(appUrl).protocol === "https:",
        path: "/",
        maxAge: SESSION_TTL_DAYS * 86_400,
      },
    );
  }
  return response;
}
