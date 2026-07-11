/**
 * Fields that make one public booking request the same logical intent.
 * Turnstile tokens are deliberately excluded: they authorize a request but do
 * not change the booking that is committed.
 */
export interface PersistedBookingIntent {
  initialIntentHash?: string | null;
  startsAt: Date;
  clientName: string;
  clientEmail: string;
  clientTimezone: string | null;
  clientAddress: string | null;
}

export interface SubmittedBookingIntent {
  startsAt: string;
  clientName: string;
  clientEmail: string;
  clientTimezone?: string;
  clientAddress?: string;
}

export interface PersistedClientActionIntent {
  actor: "owner" | "client";
  action: string;
  toStartsAt: Date | null;
  clientTimezoneIntent: string | null;
}

export interface SubmittedClientActionIntent {
  action: "move" | "cancel";
  startsAt?: string;
  clientTimezone?: string;
}

/** Bind an idempotent client action to every field that mutates booking state. */
export function matchesClientActionIntent(
  existing: PersistedClientActionIntent,
  submitted: SubmittedClientActionIntent,
): boolean {
  const timezoneMatches =
    existing.clientTimezoneIntent === null ||
    existing.clientTimezoneIntent === (submitted.clientTimezone ?? "");
  return (
    existing.actor === "client" &&
    existing.action === submitted.action &&
    timezoneMatches &&
    (submitted.action !== "move" ||
      existing.toStartsAt?.getTime() ===
        new Date(submitted.startsAt ?? "").getTime())
  );
}

function normalizedBookingIntent(intent: SubmittedBookingIntent) {
  const startsAt = new Date(intent.startsAt);
  return {
    startsAt: Number.isFinite(startsAt.getTime())
      ? startsAt.toISOString()
      : intent.startsAt,
    clientName: intent.clientName.trim(),
    clientEmail: intent.clientEmail.toLowerCase().trim(),
    clientTimezone: intent.clientTimezone ?? null,
    clientAddress: intent.clientAddress?.trim() || null,
  };
}

/** Stable fingerprint of the exact normalized initial booking intent. */
export async function bookingIntentHash(
  intent: SubmittedBookingIntent,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(normalizedBookingIntent(intent))),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * An idempotency key is valid only for the payload that first committed it.
 * Optional legacy fields are compared when the request supplies them; modern
 * browser requests always include a timezone.
 */
export async function matchesBookingIntent(
  existing: PersistedBookingIntent,
  submitted: SubmittedBookingIntent,
): Promise<boolean> {
  if (existing.initialIntentHash) {
    return existing.initialIntentHash === (await bookingIntentHash(submitted));
  }
  // Nullable fingerprints are the upgrade path for bookings created before the
  // immutable field existed. Their original mutable intent cannot be recovered.
  const submittedAddress = submitted.clientAddress?.trim() || null;
  return (
    existing.startsAt.getTime() === new Date(submitted.startsAt).getTime() &&
    existing.clientName === submitted.clientName.trim() &&
    existing.clientEmail === submitted.clientEmail.toLowerCase().trim() &&
    existing.clientAddress === submittedAddress &&
    (submitted.clientTimezone === undefined ||
      existing.clientTimezone === submitted.clientTimezone)
  );
}
