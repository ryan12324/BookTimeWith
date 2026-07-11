import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/** Runtime validation for browser/provider-supplied IANA zone identifiers. */
export function isIanaZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * Timezone math (README "Scheduling engine rules"). Availability is painted and
 * stored as wall-clock time in the owner's timezone; a slot only becomes a real
 * instant when the owner-tz wall-clock is materialised to UTC — done with
 * date-fns-tz so DST transitions never shift painted hours. Clients then see the
 * instant in their own local zone, named explicitly on the booking page.
 */

/** Calendar-date parts of `now + plusDays` as seen in the given timezone. */
export function datePartsInZone(
  now: Date,
  tz: string,
  plusDays = 0,
): { y: number; m: number; d: number; col: number } {
  // Read the date in the target zone, then add days in pure calendar space
  // (Date.UTC arithmetic) so DST days of odd length can't skip or repeat a date.
  const zoned = toZonedTime(now, tz);
  const base = Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate());
  const day = new Date(base + plusDays * 86_400_000);
  return {
    y: day.getUTCFullYear(),
    m: day.getUTCMonth(),
    d: day.getUTCDate(),
    // availability grid columns are 0=MON … 6=SUN; JS getDay() is 0=SUN
    col: (day.getUTCDay() + 6) % 7,
  };
}

/**
 * Materialise "minutes from midnight on {y-m-d} in {tz}" into a UTC instant.
 * DST-safe: 9:00 painted in Europe/London is 9:00 local in both GMT and BST.
 * Built as a wall-clock string — handing fromZonedTime a Date would re-read it
 * through the *system* timezone and shift the slot by the host's UTC offset.
 */
export function slotInstant(
  y: number,
  m: number,
  d: number,
  minutes: number,
  tz: string,
): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  const wall = `${y}-${pad(m + 1)}-${pad(d)}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
  return fromZonedTime(wall, tz);
}

/** Return null when an IANA transition makes the requested wall time nonexistent. */
export function validSlotInstant(
  y: number,
  m: number,
  d: number,
  minutes: number,
  tz: string,
): Date | null {
  const instant = slotInstant(y, m, d, minutes, tz);
  const zoned = toZonedTime(instant, tz);
  return zoned.getFullYear() === y &&
    zoned.getMonth() === m &&
    zoned.getDate() === d &&
    zoned.getHours() * 60 + zoned.getMinutes() === minutes
    ? instant
    : null;
}

/** Minutes-from-midnight of a UTC instant as seen in the given timezone. */
export function minutesInZone(instant: Date, tz: string): number {
  const zoned = toZonedTime(instant, tz);
  return zoned.getHours() * 60 + zoned.getMinutes();
}

/** True if the instant falls on the given calendar date in the given zone. */
export function isOnDateInZone(
  instant: Date,
  tz: string,
  y: number,
  m: number,
  d: number,
): boolean {
  const zoned = toZonedTime(instant, tz);
  return zoned.getFullYear() === y && zoned.getMonth() === m && zoned.getDate() === d;
}

/** The viewer's IANA timezone ("Europe/London"). */
export function clientZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** "Europe/London" at a July date → "London (BST)" — the booking-page zone line. */
export function zoneLabel(tz: string, at: Date = new Date()): string {
  const city = (tz.split("/").pop() ?? tz).replace(/_/g, " ");
  try {
    return `${city} (${formatInTimeZone(at, tz, "zzz")})`;
  } catch {
    return city;
  }
}
