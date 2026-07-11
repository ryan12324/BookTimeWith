import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";

interface LimitOptions {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
  now?: Date;
}

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

async function digest(value: string): Promise<string> {
  const configured = process.env.RATE_LIMIT_SECRET?.trim();
  const authFallback = process.env.AUTH_TOKEN_SECRET?.trim();
  const minimumLength = process.env.NODE_ENV === "production" ? 32 : 16;
  if (configured && configured.length < minimumLength) {
    throw new Error(
      `RATE_LIMIT_SECRET must contain at least ${minimumLength} characters`,
    );
  }
  if (
    process.env.NODE_ENV === "production" &&
    (!configured && (!authFallback || authFallback.length < minimumLength))
  ) {
    throw new Error(
      "RATE_LIMIT_SECRET or AUTH_TOKEN_SECRET must contain at least 32 characters",
    );
  }
  const salt = configured || authFallback || "dev-only-rate-limit-salt";
  return hex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${salt}:${value}`),
    ),
  );
}

/**
 * Persistent fixed-window rate limit. The identifier is hashed before storage,
 * so IP and email values do not become another source of retained PII.
 */
export async function takeRateLimit(db: Db, options: LimitOptions) {
  const now = options.now ?? new Date();
  const windowStartMs = Math.floor(now.getTime() / options.windowMs) * options.windowMs;
  const windowStartedAt = new Date(windowStartMs);
  const key = `${options.scope}:${await digest(options.identifier)}:${windowStartMs}`;

  const [row] = await db
    .insert(schema.rateLimits)
    .values({ key, windowStartedAt, count: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.rateLimits.key,
      set: {
        count: sql`${schema.rateLimits.count} + 1`,
        updatedAt: now,
      },
    })
    .returning({ count: schema.rateLimits.count });

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStartMs + options.windowMs - now.getTime()) / 1000),
  );
  return {
    allowed: row.count <= options.limit,
    challenged: row.count > Math.max(2, Math.floor(options.limit * 0.6)),
    remaining: Math.max(0, options.limit - row.count),
    retryAfterSeconds,
  };
}

export function requestIp(request: Request): string {
  // Fetch/Next's Request does not expose the socket peer. Forwarded addresses
  // are safe only when the origin is unreachable directly and the trusted edge
  // strips caller-supplied copies before setting its own value. An unconfigured
  // deployment deliberately collapses to one fail-safe bucket instead of
  // accepting spoofable identities.
  if (process.env.TRUST_PROXY_HEADERS !== "true") return "untrusted-direct";
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function verifyTurnstile(
  token: string | undefined,
  ip: string,
  expectedHostname?: string,
  expectedAction = "booking",
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!token) return false;

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return false;
    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    return (
      result.success === true &&
      (!expectedHostname || result.hostname === expectedHostname) &&
      (!expectedAction || result.action === expectedAction)
    );
  } catch {
    return false;
  }
}

const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "dispostable.com",
  "guerrillamail.com",
  "maildrop.cc",
  "mailinator.com",
  "sharklasers.com",
  "tempmail.com",
  "trashmail.com",
  "yopmail.com",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.toLowerCase().trim().split("@")[1] ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}
