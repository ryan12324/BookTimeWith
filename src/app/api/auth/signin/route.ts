import { after, NextResponse } from "next/server";
import { render } from "react-email";
import { z } from "zod";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import {
  generateIdentityToken,
  hashToken,
  ownerSigninExpiry,
} from "@/lib/auth-tokens";
import { assertSessionConfiguration, safeNextPath } from "@/lib/session";
import { requestIp, takeRateLimit } from "@/lib/rate-limit";
import { deliverQueuedEmail, spool } from "@/emails/send";
import { OwnerSignIn } from "@/emails/templates";
import { canonicalAppUrl } from "@/lib/urls";
import { isEmailTransportConfigured } from "@/emails/transports/factory";

export const dynamic = "force-dynamic";

const SIGNIN_RESPONSE_FLOOR_MS =
  process.env.NODE_ENV === "test" ? 0 : 350;

async function waitForSigninResponseFloor(startedAt: number) {
  const remaining = SIGNIN_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

const Input = z.object({
  email: z.string().email().max(320),
  next: z.string().max(500).optional(),
});

/**
 * Magic-link sign-in: mint a 15-minute single-use token and email the link.
 * Responds 200 whether or not the email matches an owner — no address probing.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    assertSessionConfiguration();
  } catch {
    return NextResponse.json(
      { error: "Sign-in is temporarily unavailable." },
      { status: 503 },
    );
  }
  const db = await getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Input.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid email" }, { status: 400 });

  const email = parsed.data.email.toLowerCase().trim();
  const ipLimit = await takeRateLimit(db, {
    scope: "owner-signin-ip",
    identifier: requestIp(request),
    limit: 20,
    windowMs: 60 * 60_000,
  });
  const emailLimit = await takeRateLimit(db, {
    scope: "owner-signin-email",
    identifier: email,
    limit: 5,
    windowMs: 15 * 60_000,
  });
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in links requested. Try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds),
          ),
        },
      },
    );
  }

  const owner = await db.query.owners.findFirst({
    where: eq(schema.owners.email, email),
  });

  // Perform the same token hashing and template rendering for known and unknown
  // addresses. Known-account mail is committed to the outbox before response,
  // then delivered in request-lifecycle background work; provider latency can
  // no longer reveal whether the address exists.
  const token = generateIdentityToken(owner?.sessionVersion ?? 0);
  const tokenHash = await hashToken(token);
  const baseUrl = canonicalAppUrl(request.url);
  const next = safeNextPath(parsed.data.next);
  const signInUrl = `${baseUrl}/api/auth/callback?token=${token}&next=${encodeURIComponent(next)}`;
  let queuedId: string | false = false;
  try {
    if (owner) {
      const authTokenId = crypto.randomUUID();
      await db.insert(schema.authTokens).values({
        id: authTokenId,
        kind: "owner_signin",
        ownerId: owner.id,
        identityEmail: owner.email,
        tokenHash,
        expiresAt: ownerSigninExpiry(),
      });
      queuedId = await spool(
        db,
        {
        to: owner.email,
        from: "booktimewith.com",
        subject: "Here's your sign-in link",
        template: "owner-sign-in",
        ownerId: owner.id,
        ownerRecipientVersion: owner.sessionVersion,
        authTokenId,
        element: OwnerSignIn({ signInUrl }),
        },
        { deferDelivery: true },
      );
    } else {
      await render(OwnerSignIn({ signInUrl }));
    }
  } catch (error) {
    // Preserve the same response for known and unknown addresses. Operators
    // still get a server-side error signal without turning this into an
    // account-enumeration endpoint.
    console.error("Sign-in email could not be queued", error);
  }

  if (queuedId && isEmailTransportConfigured()) {
    const deliveryId = queuedId;
    after(async () => {
      try {
        await deliverQueuedEmail(db, deliveryId);
      } catch (error) {
        // The committed pending row remains retryable by cron after a worker or
        // transport failure.
        console.error("Sign-in email delivery could not finish", error);
      }
    });
  }

  await waitForSigninResponseFloor(startedAt);

  return NextResponse.json({ ok: true });
}
