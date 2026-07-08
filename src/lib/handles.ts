/**
 * Handle rules (README "Reserved handles"). A handle is 3–30 chars of
 * [a-z0-9-]; a blocklist keeps product/system paths and obvious abuse out.
 * The live availability check (phase 2) also consults taken handles + redirects.
 */
export const RESERVED_HANDLES = new Set([
  "www", "api", "app", "admin", "help", "billing", "mail", "manage",
  "settings", "setup", "bookings", "login", "signin", "signup", "account",
  "support", "status", "about", "pricing", "terms", "privacy", "static",
  "assets", "public", "dashboard", "emails",
]);

// Minimal placeholder — the real service uses a maintained profanity list.
const PROFANITY = new Set(["fuck", "shit", "cunt"]);

export function normalizeHandle(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

export type HandleStatus = "available" | "too-short" | "reserved" | "invalid";

export function checkHandle(input: string): HandleStatus {
  const h = normalizeHandle(input);
  if (h.length < 3) return "too-short";
  if (RESERVED_HANDLES.has(h) || PROFANITY.has(h)) return "reserved";
  if (!/^[a-z0-9-]+$/.test(h)) return "invalid";
  return "available";
}
