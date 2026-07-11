import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { sessionOwner } from "@/lib/authz";
import { generateToken } from "@/lib/auth-tokens";
import { oauthUrl, OAUTH_STATE_COOKIE, type Provider } from "@/lib/calendar";
import { canonicalAppUrl } from "@/lib/urls";
import { withOwnerMutex } from "@/lib/keyed-mutex";

export const dynamic = "force-dynamic";

/**
 * Start a calendar connection: redirect to the provider's consent screen.
 * Requires the owner's session (this mutates owner state on return), and mints
 * an unguessable `state` nonce — stored in an httpOnly cookie and echoed back
 * by the provider — so the callback can reject forged/cross-account codes.
 * No credentials in this environment → no connection; the UI says so plainly.
 */
export async function GET(request: Request) {
  const db = await getDb();
  const owner = await sessionOwner(db);
  if (!owner) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const appUrl = canonicalAppUrl(request.url);
  const provider = (url.searchParams.get("provider") ?? "") as Provider;
  if (!["google", "outlook"].includes(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const nonce = generateToken();
  const consent = oauthUrl(provider, appUrl, `${provider}.${nonce}`);
  if (!consent) {
    return NextResponse.redirect(
      new URL("/app/settings?calendar=unconfigured", appUrl),
    );
  }

  const [intent] = await withOwnerMutex(owner.id, () =>
    db
      .update(schema.owners)
      .set({
        calendarGeneration: sql`${schema.owners.calendarGeneration} + 1`,
      })
      .where(
        and(
          eq(schema.owners.id, owner.id),
          eq(schema.owners.sessionVersion, owner.sessionVersion),
        ),
      )
      .returning({ generation: schema.owners.calendarGeneration }),
  );
  if (!intent) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = NextResponse.redirect(consent);
  // Keep the provider-visible state opaque while binding its cookie counterpart
  // to the exact signed-in owner and provider that initiated consent.
  res.cookies.set(
    OAUTH_STATE_COOKIE,
    `${owner.id}.${provider}.${intent.generation}.${nonce}`,
    {
    httpOnly: true,
    sameSite: "lax", // survives the top-level GET redirect back from the provider
    secure: new URL(appUrl).protocol === "https:",
    path: "/",
    maxAge: 600, // 10 minutes to complete consent
    },
  );
  return res;
}
