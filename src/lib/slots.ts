import { formatInTimeZone } from "date-fns-tz";
import type { OwnerConfig } from "./mock";
import {
  generateSlots,
  meetsMinNotice,
  openIntervalsForDay,
  subtractBusy,
  withinHorizon,
  type Interval,
} from "./scheduling";
import {
  datePartsInZone,
  minutesInZone,
  slotInstant,
  validSlotInstant,
} from "./timezone";

/**
 * Real slot computation for the booking page (README: painted availability −
 * existing bookings − busy time − service length, min notice, horizon, away).
 * Availability is walked day-by-day in the owner's timezone, each slot is
 * materialised to a UTC instant (DST-safe), then bucketed into the *client's*
 * local days for display — so a 9:00-London slot files under Monday evening for
 * a viewer in Sydney.
 */

export interface Slot {
  start: Date;
  label: string; // client-local and unambiguous: "9:00am" / "1:00pm"
}

export interface DaySlots {
  key: string; // client-local y-m-d bucket key
  dow: string; // "TUE"
  date: string; // "14 Jul"
  full: string; // "Tuesday 14 July"
  slots: Slot[];
}

export interface BusySpan {
  start: Date;
  end: Date;
}

export function fmtSlotLabel(d: Date): string {
  const h = d.getHours() % 12 || 12;
  const period = d.getHours() < 12 ? "am" : "pm";
  return `${h}:${String(d.getMinutes()).padStart(2, "0")}${period}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Busy spans intersected with one owner-tz calendar day, expressed as
 * minutes-from-midnight. Clipping (not just start-date matching) means a span
 * crossing midnight — a multi-day synced-calendar event, say — correctly blocks
 * every day it touches, not only the day it starts on.
 */
function busyMinutesForDay(
  busy: BusySpan[],
  tz: string,
  y: number,
  m: number,
  d: number,
): Interval[] {
  const dayStart = slotInstant(y, m, d, 0, tz).getTime();
  const nd = datePartsInZone(slotInstant(y, m, d, 0, tz), tz, 1);
  const dayEnd = slotInstant(nd.y, nd.m, nd.d, 0, tz).getTime();
  const out: Interval[] = [];
  for (const b of busy) {
    const start = Math.max(b.start.getTime(), dayStart);
    const end = Math.min(b.end.getTime(), dayEnd);
    if (end <= start) continue;
    // Convert both clipped instants independently. Adding elapsed milliseconds
    // to a wall-clock start is wrong on the 23/25-hour DST transition days.
    const startMin = start <= dayStart ? 0 : minutesInZone(new Date(start), tz);
    let endMin = end >= dayEnd ? 24 * 60 : minutesInZone(new Date(end), tz);
    // A repeated-hour event can map both instants to the same wall minute. Be
    // conservative and block at least one slot rather than exposing busy time.
    if (endMin <= startMin && end > start) endMin = Math.min(24 * 60, startMin + 30);
    out.push({ start: startMin, end: endMin });
  }
  return out;
}

/** True while `now` (owner-tz date) sits inside the away range. */
export function isAwayNow(
  away: OwnerConfig["away"],
  now: Date,
  tz: string,
): boolean {
  if (!away) return false;
  const { y, m, d } = datePartsInZone(now, tz, 0);
  const today = `${y}-${pad(m + 1)}-${pad(d)}`;
  return away.start <= today && today <= away.end;
}

function isAwayDate(away: OwnerConfig["away"], y: number, m: number, d: number): boolean {
  if (!away) return false;
  const ymd = `${y}-${pad(m + 1)}-${pad(d)}`;
  return away.start <= ymd && ymd <= away.end;
}

/**
 * The next `count` client-local days that have at least one bookable slot.
 * Returns [] when the owner is away right now ("clients see nothing available")
 * or when nothing is open inside the 60-day horizon.
 */
export function bookableDays(
  cfg: OwnerConfig,
  busy: BusySpan[],
  now: Date = new Date(),
  count = 3,
  viewerTz: string = cfg.timezone,
  after?: Date,
): DaySlots[] {
  if (isAwayNow(cfg.away, now, cfg.timezone)) return [];

  const tz = cfg.timezone;
  const buckets = new Map<string, DaySlots>();

  // Iterate one bucket past `count`: a viewer-local day can straddle two owner
  // days, so the last bucket may still be filling — we drop it below.
  for (let plus = 0; plus <= cfg.bookingHorizonDays && buckets.size <= count; plus++) {
    const { y, m, d, col } = datePartsInZone(now, tz, plus);
    if (isAwayDate(cfg.away, y, m, d)) continue;

    const open = openIntervalsForDay(cfg.cells, col);
    if (!open.length) continue;

    const free = subtractBusy(open, busyMinutesForDay(busy, tz, y, m, d));
    for (const mins of generateSlots(free, cfg.duration)) {
      const start = validSlotInstant(y, m, d, mins, tz);
      if (!start) continue;
      if (after && start.getTime() <= after.getTime()) continue;
      if (!meetsMinNotice(start, now) || !withinHorizon(start, now, cfg.bookingHorizonDays)) continue;

      // Bucket and label in the VIEWER's timezone — the booking page renders
      // these verbatim under "Times in {their zone}", so they must be built
      // there, not in whatever timezone the server process happens to run in.
      const key = formatInTimeZone(start, viewerTz, "yyyy-MM-dd");
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          key,
          dow: formatInTimeZone(start, viewerTz, "EEE").toUpperCase(),
          date: formatInTimeZone(start, viewerTz, "d MMM"),
          full: formatInTimeZone(start, viewerTz, "EEEE d MMMM"),
          slots: [],
        };
        buckets.set(key, bucket);
      }
      bucket.slots.push({
        start,
        label: formatInTimeZone(start, viewerTz, "h:mma").toLowerCase(),
      });
    }
  }

  return [...buckets.values()].slice(0, count);
}

/**
 * Is `target` a currently-bookable slot start for this owner? Recomputes the
 * open slot set for the owner-tz day containing `target` and checks exact
 * membership — enforcing painted availability, away periods, busy time (which
 * also rules out overlap with existing bookings), slot-step alignment,
 * duration-fit, min-notice and horizon. This is the server-side authorization
 * the booking/reschedule endpoints must apply to client-supplied times.
 */
export function isSlotBookable(
  cfg: OwnerConfig,
  busy: BusySpan[],
  target: Date,
  now: Date = new Date(),
): boolean {
  const tz = cfg.timezone;
  if (isAwayNow(cfg.away, now, tz)) return false;
  if (!meetsMinNotice(target, now) || !withinHorizon(target, now, cfg.bookingHorizonDays)) return false;

  const { y, m, d, col } = datePartsInZone(target, tz, 0);
  if (isAwayDate(cfg.away, y, m, d)) return false;

  const open = openIntervalsForDay(cfg.cells, col);
  if (!open.length) return false;

  const free = subtractBusy(open, busyMinutesForDay(busy, tz, y, m, d));
  return generateSlots(free, cfg.duration).some((mins) => {
    const instant = validSlotInstant(y, m, d, mins, tz);
    return instant?.getTime() === target.getTime();
  });
}
