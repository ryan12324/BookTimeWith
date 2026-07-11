/**
 * Token logic (README data model: login_tokens / manage_tokens). Tokens are
 * random, stored only as SHA-256 hashes, single-use where applicable, and
 * expiring: owner sign-in links live 15 minutes; a booking's stable client
 * manage link lives until the appointment ends. Pure functions — the
 * API layer persists rows in `auth_tokens` (src/db/schema.ts).
 */

export const OWNER_SIGNIN_TTL_MINUTES = 15;

/** 256-bit URL-safe random token. This is the only form the user ever sees. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Identity links carry the live session generation in their authenticated token. */
export function generateIdentityToken(sessionVersion: number): string {
  return `${generateToken()}.${sessionVersion}`;
}

/** Legacy identity links were version 0; malformed suffixes are rejected. */
export function identityTokenVersion(token: string): number | null {
  const separator = token.lastIndexOf(".");
  if (separator < 0) return 0;
  const value = Number(token.slice(separator + 1));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** SHA-256 hex of a token — the only form that is ever stored. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Owner sign-in links expire 15 minutes after issue. */
export function ownerSigninExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + OWNER_SIGNIN_TTL_MINUTES * 60_000);
}

/** Client manage links stay valid until the appointment ends. */
export function manageLinkExpiry(appointmentEnd: Date): Date {
  return new Date(appointmentEnd.getTime());
}

/** Validity check against a stored auth_tokens row: unexpired and unused. */
export function isTokenUsable(
  row: { expiresAt: Date; usedAt: Date | null },
  now: Date = new Date(),
): boolean {
  return row.usedAt === null && row.expiresAt.getTime() > now.getTime();
}
