/**
 * Handle rules (README "Reserved handles"). A handle is 3–30 chars of
 * [a-z0-9-]; a blocklist keeps product/system paths and obvious abuse out.
 * The live availability endpoint also consults taken handles and redirects.
 */
export const RESERVED_HANDLES = new Set([
  "www", "api", "app", "admin", "help", "billing", "mail", "manage",
  "settings", "setup", "bookings", "login", "signin", "signup", "account",
  "support", "status", "about", "pricing", "terms", "privacy", "static",
  "assets", "public", "dashboard", "emails",
]);

// Conservative exact-token list. Production operations should still review
// abuse reports and update this without changing the public handle contract.
const PROFANITY = new Set([
  "asshole",
  "bastard",
  "bitch",
  "cunt",
  "dick",
  "fuck",
  "nazi",
  "porn",
  "shit",
  "slut",
]);

export function normalizeHandle(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

export type HandleStatus = "available" | "too-short" | "reserved" | "invalid";

export function checkHandle(input: string): HandleStatus {
  const h = normalizeHandle(input);
  if (h.length < 3) return "too-short";
  if (
    input.toLowerCase() !== h ||
    h.length > 30 ||
    h.startsWith("-") ||
    h.endsWith("-") ||
    h.includes("--")
  ) {
    return "invalid";
  }
  if (RESERVED_HANDLES.has(h) || h.split("-").some((part) => PROFANITY.has(part))) {
    return "reserved";
  }
  return "available";
}
