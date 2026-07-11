import { and, eq, inArray } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { deliverQueuedEmail, sendVerification } from "@/emails/send";
import { sessionOwner } from "@/lib/authz";
import { takeRateLimit } from "@/lib/rate-limit";
import { canonicalAppUrl } from "@/lib/urls";
import { withOwnerMutex } from "@/lib/keyed-mutex";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = await getDb();
  const owner = await sessionOwner(db);
  if (!owner) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (owner.emailVerifiedAt && !owner.pendingEmail) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  const limit = await takeRateLimit(db, {
    scope: "verify-email",
    identifier: owner.id,
    limit: 3,
    windowMs: 60 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Please wait before requesting another email." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const queuedId = await withOwnerMutex(owner.id, async () => {
    const current = await db.query.owners.findFirst({
      where: eq(schema.owners.id, owner.id),
    });
    if (!current || current.sessionVersion !== owner.sessionVersion) {
      return "unauthorized" as const;
    }
    if (current.emailVerifiedAt && !current.pendingEmail) {
      return "verified" as const;
    }
    await db
      .delete(schema.authTokens)
      .where(
        and(
          eq(schema.authTokens.ownerId, current.id),
          eq(schema.authTokens.kind, "email_verify"),
        ),
      );
    await db
      .update(schema.emailOutbox)
      .set({
        delivery: "expired",
        lastError: "A newer verification link was requested",
        html: "",
        attachments: null,
      })
      .where(
        and(
          eq(schema.emailOutbox.ownerId, current.id),
          eq(schema.emailOutbox.template, "owner-verify-email"),
          inArray(schema.emailOutbox.delivery, [
            "pending",
            "failed",
            "processing",
            "skipped",
          ]),
        ),
      );
    return sendVerification(db, current, canonicalAppUrl(request.url), {
      deferDelivery: true,
    });
  });
  if (queuedId === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (queuedId === "verified") {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }
  if (queuedId && process.env.EMAIL_WEBHOOK_URL) {
    const deliveryId = queuedId;
    after(async () => {
      try {
        await deliverQueuedEmail(db, deliveryId);
      } catch (error) {
        console.error("Verification email handoff failed", error);
      }
    });
  }
  return NextResponse.json({ ok: true });
}
