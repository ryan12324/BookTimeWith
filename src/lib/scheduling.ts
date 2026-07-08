import type { Cells } from "./availability";

/**
 * Scheduling engine rules, spelled out from the design (README "Scheduling
 * engine rules"). These are pure functions — the phase-2 API layer feeds them
 * real bookings and synced-calendar busy time; here they encode the policy.
 */

export const MIN_NOTICE_HOURS = 4; // no booking less than 4h ahead (v1 default)
export const HORIZON_DAYS = 60; // bookable up to 60 days out
export const SLOT_STEP_MINUTES = 30; // slot starts snap to :00 / :30

export interface Interval {
  /** minutes from midnight, in the owner's timezone */
  start: number;
  end: number;
}

/** Collapse painted half-hour cells for one weekday column into open intervals. */
export function openIntervalsForDay(cells: Cells, dayColumn: number): Interval[] {
  const halves: number[] = [];
  for (const key of Object.keys(cells)) {
    const [col, hour, half] = key.split("-");
    if (Number(col) !== dayColumn) continue;
    const minutes = Number(hour) * 60 + (half === "b" ? 30 : 0);
    halves.push(minutes);
  }
  halves.sort((a, b) => a - b);

  const intervals: Interval[] = [];
  for (const start of halves) {
    const last = intervals[intervals.length - 1];
    if (last && last.end === start) last.end = start + 30;
    else intervals.push({ start, end: start + 30 });
  }
  return intervals;
}

/** Subtract busy intervals (existing bookings + synced calendar events). */
export function subtractBusy(open: Interval[], busy: Interval[]): Interval[] {
  let result = open;
  for (const b of busy) {
    const next: Interval[] = [];
    for (const o of result) {
      if (b.end <= o.start || b.start >= o.end) {
        next.push(o); // no overlap
        continue;
      }
      if (b.start > o.start) next.push({ start: o.start, end: b.start });
      if (b.end < o.end) next.push({ start: b.end, end: o.end });
    }
    result = next;
  }
  return result;
}

/**
 * Generate bookable slot start times (minutes from midnight) for a day: walk each
 * free interval in 30-minute steps, keeping only starts where the whole service
 * length fits before the interval ends.
 */
export function generateSlots(
  free: Interval[],
  serviceMinutes: number,
): number[] {
  const slots: number[] = [];
  for (const iv of free) {
    // snap the first candidate up to a 30-minute mark
    let t = Math.ceil(iv.start / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
    while (t + serviceMinutes <= iv.end) {
      slots.push(t);
      t += SLOT_STEP_MINUTES;
    }
  }
  return slots;
}

/** True if a slot is far enough ahead to satisfy min-notice. */
export function meetsMinNotice(slotStart: Date, now: Date): boolean {
  const hoursAhead = (slotStart.getTime() - now.getTime()) / 3_600_000;
  return hoursAhead >= MIN_NOTICE_HOURS;
}

/** True if a slot is within the booking horizon. */
export function withinHorizon(slotStart: Date, now: Date): boolean {
  const daysAhead = (slotStart.getTime() - now.getTime()) / 86_400_000;
  return daysAhead <= HORIZON_DAYS;
}
