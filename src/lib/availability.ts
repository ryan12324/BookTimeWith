/**
 * Availability grid model. Painted availability is stored as a set of half-hour
 * cell keys: `${dayColumn}-${hour}-${half}` where half is "a" (:00–:30) or
 * "b" (:30–:00). A key present with value 1 means "open". Weekdays are columns
 * 0–4 (MON–FRI); weekend columns 5–6 (SAT–SUN) appear when the weekends toggle
 * is on. UI bounds are 05:00–23:00 (README data model).
 */
export type Cells = Record<string, 1>;
export type Half = "a" | "b";

export const GRID_MIN_HOUR = 5;
export const GRID_MAX_HOUR = 23;
export const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI"] as const;
export const WEEKEND_LABELS = ["SAT", "SUN"] as const;

export function cellKey(col: number, hour: number, half: Half): string {
  return `${col}-${hour}-${half}`;
}

export function dayLabels(weekends: boolean): string[] {
  return weekends
    ? [...WEEKDAY_LABELS, ...WEEKEND_LABELS]
    : [...WEEKDAY_LABELS];
}

/** Each half-hour cell counts as 0.5h. */
export function openHours(cells: Cells): number {
  return Object.keys(cells).length / 2;
}

/** Remove weekend columns (>= 5) from a cell set. */
export function clearWeekendCells(cells: Cells): Cells {
  const next: Cells = {};
  for (const k of Object.keys(cells)) {
    if (Number(k.split("-")[0]) < 5) next[k] = 1;
  }
  return next;
}

/** One DB row per painted half-hour block (availability table). */
export interface AvailabilityBlock {
  weekday: number; // 0=MON … 6=SUN
  startMinute: number;
  endMinute: number;
}

export function cellsToBlocks(cells: Cells): AvailabilityBlock[] {
  return Object.keys(cells).map((k) => {
    const [col, hour, half] = k.split("-");
    const start = Number(hour) * 60 + (half === "b" ? 30 : 0);
    return { weekday: Number(col), startMinute: start, endMinute: start + 30 };
  });
}

export function blocksToCells(blocks: AvailabilityBlock[]): Cells {
  const cells: Cells = {};
  for (const b of blocks) {
    const hour = Math.floor(b.startMinute / 60);
    const half: Half = b.startMinute % 60 === 30 ? "b" : "a";
    cells[cellKey(b.weekday, hour, half)] = 1;
  }
  return cells;
}
