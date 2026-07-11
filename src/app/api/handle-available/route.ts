import { NextResponse } from "next/server";
import { eq, ne, and } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { checkHandle, normalizeHandle } from "@/lib/handles";
import { requestIp, takeRateLimit } from "@/lib/rate-limit";
import { sessionOwner } from "@/lib/authz";

export const dynamic = "force-dynamic";

/**
 * Live handle-availability check driving the "✓ … is available" hint
 * (debounced on the client). Format + reserved rules first, then the real DB:
 * a handle held by an existing owner, or an active redirect from a changed
 * handle, is taken. The signed-in owner's OWN handle doesn't count against
 * them (editing it in settings); everyone else gets the honest answer.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("handle") ?? "";
  const handle = normalizeHandle(raw);
  let status: ReturnType<typeof checkHandle> = checkHandle(raw);

  if (status === "available") {
    const db = await getDb();
    const limit = await takeRateLimit(db, {
      scope: "handle-availability",
      identifier: requestIp(request),
      limit: 60,
      windowMs: 10 * 60_000,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { handle, available: false, status: "reserved", message: "Too many checks. Try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }
    // only the authenticated owner is "self" — anonymous checkers see the truth
    const me = await sessionOwner(db);

    const taken = await db.query.owners.findFirst({
      where: me
        ? and(eq(schema.owners.handle, handle), ne(schema.owners.id, me.id))
        : eq(schema.owners.handle, handle),
    });
    const redirected = await db.query.handleRedirects.findFirst({
      where: me
        ? and(
            eq(schema.handleRedirects.fromHandle, handle),
            ne(schema.handleRedirects.ownerId, me.id),
          )
        : eq(schema.handleRedirects.fromHandle, handle),
    });
    if (taken || (redirected && redirected.expiresAt > new Date())) status = "reserved";
  }

  const message: Record<typeof status, string> = {
    available: `booktimewith.link/${handle} is available`,
    "too-short": "Handles are at least 3 characters.",
    reserved: "That one's taken — try another.",
    invalid: "Letters, numbers and dashes only.",
  };

  return NextResponse.json({
    handle,
    available: status === "available",
    status,
    message: message[status],
  });
}
