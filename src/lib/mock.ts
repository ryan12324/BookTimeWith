import type { Cells } from "./availability";

/**
 * Mock data standing in for what the server would return in phase 2. The owner
 * config is persisted to localStorage (see store.tsx) so edits in the owner app
 * flow through to the client booking demo — the same "live" feel as the design
 * prototype, without a backend.
 */

export type LocationMode = "mine" | "theirs";

export interface OwnerConfig {
  handle: string;
  service: string;
  duration: number; // minutes, 15–240 step 5
  location: LocationMode;
  ownerAddress: string;
  cells: Cells;
  startHour: number;
  endHour: number;
  weekends: boolean;
  calendar: string | null; // provider name once connected
  notifyBook: boolean;
  notifyMorning: boolean;
}

/** The demo owner — Dana Whitfield, matching the design files. */
export const OWNER_NAME = "Dana Whitfield, LMFT";

export const DEFAULT_OWNER: OwnerConfig = {
  handle: "dana",
  service: "Therapy session",
  duration: 50,
  location: "mine",
  ownerAddress: "",
  startHour: 8,
  endHour: 18,
  weekends: false,
  calendar: null,
  notifyBook: true,
  notifyMorning: true,
  // Painted weekday mornings + a couple of afternoons, from the prototype.
  cells: {
    "1-9-a": 1, "1-9-b": 1, "1-10-a": 1, "1-10-b": 1, "1-11-a": 1, "1-11-b": 1, "1-12-a": 1, "1-12-b": 1,
    "2-9-a": 1, "2-9-b": 1, "2-10-a": 1, "2-10-b": 1, "2-11-a": 1, "2-11-b": 1, "2-12-a": 1, "2-12-b": 1,
    "2-14-a": 1, "2-14-b": 1, "2-15-a": 1, "2-15-b": 1,
    "3-9-a": 1, "3-9-b": 1, "3-10-a": 1, "3-10-b": 1, "3-11-a": 1, "3-11-b": 1, "3-12-a": 1, "3-12-b": 1,
    "4-14-a": 1, "4-14-b": 1, "4-15-a": 1, "4-15-b": 1, "4-16-a": 1, "4-16-b": 1,
  },
};

/** Three bookable days with real-ish dates, matching the design. */
export const BOOKING_DAYS = [
  { dow: "TUE", date: "14", full: "Tuesday 14" },
  { dow: "WED", date: "15", full: "Wednesday 15" },
  { dow: "THU", date: "16", full: "Thursday 16" },
] as const;

/** Available slot times per day index (pre-computed for the mock). */
export const SLOT_SETS: string[][] = [
  ["9:00", "10:00", "11:00", "1:00", "2:00", "3:30"],
  ["10:00", "11:00", "2:00", "4:00"],
  ["9:00", "12:00", "1:00", "3:00", "4:00"],
];

export type BookingStatus = "ok" | "moved" | "cancelled";

export interface Booking {
  id: number;
  grp: string;
  time: string;
  name: string;
  status: BookingStatus;
  moving: boolean;
  movedTo: string;
}

export const DEFAULT_BOOKINGS: Booking[] = [
  { id: 1, grp: "TODAY · TUESDAY 14", time: "10:00", name: "Alex Martin", status: "ok", moving: false, movedTo: "" },
  { id: 2, grp: "TODAY · TUESDAY 14", time: "1:00", name: "Priya Shah", status: "ok", moving: false, movedTo: "" },
  { id: 3, grp: "TODAY · TUESDAY 14", time: "3:30", name: "Sam Reed", status: "ok", moving: false, movedTo: "" },
  { id: 4, grp: "TOMORROW · WEDNESDAY 15", time: "10:00", name: "Jordan Lee", status: "ok", moving: false, movedTo: "" },
  { id: 5, grp: "TOMORROW · WEDNESDAY 15", time: "2:00", name: "Maya Chen", status: "ok", moving: false, movedTo: "" },
];

/** Alternative times offered by the owner "Move" action. */
export const MOVE_OPTIONS = ["11:00", "2:00", "4:30", "Thu 9:00"];
