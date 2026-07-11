/**
 * Owner sessions: a self-contained HMAC-signed cookie (`ownerId.exp.sig`) so
 * the middleware can verify it at the edge with no DB round-trip. Sessions are
 * minted only by the magic-link callback — owners have no passwords, the
 * emailed link IS the login.
 *
 * Web Crypto only (runs in both the edge middleware and node route handlers).
 */

export const SESSION_COOKIE = "btw_session";
export const SESSION_TTL_DAYS = 30;

const secret = () => {
  const s = process.env.AUTH_TOKEN_SECRET?.trim();
  const minimumLength = process.env.NODE_ENV === "production" ? 32 : 16;
  if (s && s.length >= minimumLength) return s;
  // Never fall back to a public constant in production — a known key means
  // anyone can forge a session cookie. Fail closed instead.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_TOKEN_SECRET must be set to a random string of at least 32 characters in production.",
    );
  }
  return "dev-only-insecure-secret-not-for-production";
};

/** Fail before a mutation that will need to mint a session cookie. */
export function assertSessionConfiguration(): void {
  void secret();
}

/**
 * A safe post-login redirect target: a same-site absolute path only. WHATWG URL
 * parsing strips ASCII tabs/newlines before resolving, so reject every control
 * character as well as protocol-relative and backslash forms before parsing.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/app",
): string {
  return next &&
    /^\/(?!\/)/.test(next) &&
    !/[\\\u0000-\u001f\u007f]/.test(next)
    ? next
    : fallback;
}

/** Resolve a validated path and enforce the configured application origin. */
export function safeNextUrl(
  next: string | null | undefined,
  appUrl: string,
  fallback = "/app",
): URL {
  const appOrigin = new URL(appUrl);
  const fallbackUrl = new URL(fallback, appOrigin);
  try {
    const target = new URL(safeNextPath(next, fallback), appOrigin);
    return target.origin === appOrigin.origin ? target : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

/**
 * Derive a stable, unguessable opaque token for an idempotent server response.
 * The purpose prefix prevents a value derived for one feature being accepted
 * in another, while JSON framing prevents delimiter ambiguity in caller data.
 */
export async function deriveOpaqueToken(
  purpose: string,
  ...parts: string[]
): Promise<string> {
  return hmac(`opaque:${JSON.stringify([purpose, ...parts])}`);
}

async function validHmac(payload: string, encoded: string): Promise<boolean> {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) return false;
    const padded = encoded
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const signature = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

export async function createSession(
  ownerId: string,
  now = new Date(),
  sessionVersion = 0,
): Promise<string> {
  const exp = now.getTime() + SESSION_TTL_DAYS * 86_400_000;
  const payload = `${ownerId}.${sessionVersion}.${exp}`;
  return `${payload}.${await hmac(payload)}`;
}

export interface VerifiedSession {
  ownerId: string;
  sessionVersion: number;
}

/** Parse a valid, unexpired session. Two-part legacy payloads are version 0. */
export async function verifySessionDetails(
  cookie: string | undefined,
  now = new Date(),
): Promise<VerifiedSession | null> {
  if (!cookie) return null;
  const idx = cookie.lastIndexOf(".");
  if (idx < 0) return null;
  const payload = cookie.slice(0, idx);
  const sig = cookie.slice(idx + 1);
  if (!(await validHmac(payload, sig))) return null;
  const parts = payload.split(".");
  const [ownerId, versionValue, expiryValue] =
    parts.length === 2
      ? [parts[0], "0", parts[1]]
      : [parts[0], parts[1], parts[2]];
  const sessionVersion = Number(versionValue);
  const expiresAt = Number(expiryValue);
  if (
    !ownerId ||
    !Number.isSafeInteger(sessionVersion) ||
    sessionVersion < 0 ||
    !Number.isFinite(expiresAt) ||
    expiresAt < now.getTime()
  ) {
    return null;
  }
  return { ownerId, sessionVersion };
}

/** Returns the ownerId for a valid, unexpired cookie — middleware fast path. */
export async function verifySession(
  cookie: string | undefined,
  now = new Date(),
): Promise<string | null> {
  return (await verifySessionDetails(cookie, now))?.ownerId ?? null;
}
