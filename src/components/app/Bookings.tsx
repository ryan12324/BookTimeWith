"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { useOwnerConfig } from "@/lib/store";
import { fmtDuration } from "@/lib/format";
import { datePartsInZone } from "@/lib/timezone";
import { SectionLabel } from "@/components/ui";
import { T } from "@/lib/tokens";

interface MoveOption {
  startsAt: string;
  label: string;
}
interface Row {
  id: string;
  startsAt: string;
  durationMinutes: number;
  clientName: string;
  clientEmail?: string;
  clientAddress?: string | null;
  serviceName: string;
  locationMode: "mine" | "theirs";
  location: string | null;
  status: "confirmed" | "cancelled";
  calendarSyncStatus: "none" | "pending" | "synced" | "failed" | "deleted";
  moveOptions: MoveOption[];
  // UI-only state
  moving: boolean;
  movedTo: string;
}

interface ActionResult {
  ok: boolean;
  error?: string;
  emailDeliveryConfigured?: boolean;
  clientEmailQueued?: boolean;
}

interface BookingGroup {
  key: string;
  label: string;
}

/**
 * Owner bookings management, backed by /api/bookings. Move opens an inline row
 * of alternative times (computed from live availability); Cancel strikes the
 * row through with an Undo. Every action really emails the client — the
 * system-written polite email lands in the outbox at /emails.
 */
export function Bookings() {
  const { config, update } = useOwnerConfig();
  const [rows, setRows] = useState<Row[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoadState("loading");
    setLoadError(null);
    try {
      const res = await fetch("/api/bookings");
      const data = (await res.json()) as {
        bookings?: Omit<Row, "moving" | "movedTo">[];
        error?: string;
      };
      if (!res.ok || !Array.isArray(data.bookings)) {
        throw new Error(data.error ?? "bookings unavailable");
      }
      setRows(data.bookings.map((b) => ({ ...b, moving: false, movedTo: "" })));
      setLoadState("ready");
    } catch {
      setLoadError("Your bookings couldn't load. Check your connection and try again.");
      setLoadState("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = (id: string, p: Partial<Row>) =>
    setRows((prev) => prev.map((b) => (b.id === id ? { ...b, ...p } : b)));

  const act = async (
    id: string,
    payload:
      | { action: "move"; startsAt: string; reason?: string }
      | { action: "cancel"; reason?: string }
      | { action: "restore" },
    actionKey: string,
  ): Promise<ActionResult> => {
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, actionKey }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            error?: string;
            emailDeliveryConfigured?: boolean;
            clientEmailQueued?: boolean;
          }
        | null;
      if (!res.ok) {
        await load(false);
        return { ok: false, error: data?.error ?? "That change couldn't be saved." };
      }
      return {
        ok: true,
        emailDeliveryConfigured: data?.emailDeliveryConfigured,
        clientEmailQueued: data?.clientEmailQueued,
      };
    } catch {
      return { ok: false, error: "That change couldn't be sent. Check your connection." };
    }
  };

  const now = new Date();
  const groups = [
    ...new Map(
      rows.map((booking) => {
        const group = bookingGroupInZone(
          new Date(booking.startsAt),
          now,
          config.timezone,
        );
        return [group.key, group] as const;
      }),
    ).values(),
  ];
  const upcoming = rows.filter((b) => b.status !== "cancelled").length;

  return (
    <div className="mx-auto mt-9 max-w-[680px]">
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-[28px] tracking-[-.01em]">Your bookings</h1>
        <div className="font-sans text-[12.5px] text-body">
          {loadState === "loading" ? "Loading…" : `${upcoming} upcoming`}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-6">
        {loadState === "loading" && (
          <div role="status" className="rounded-card border border-line-soft bg-white px-6 py-10 text-center font-sans text-[13.5px] text-body shadow-card">
            Loading your bookings…
          </div>
        )}
        {loadState === "error" && (
          <div role="alert" className="rounded-card border border-line-soft bg-white px-6 py-8 text-center font-sans text-[13.5px] leading-[1.6] text-body shadow-card">
            <p>{loadError}</p>
            <button type="button" onClick={() => void load()} className="mt-3 min-h-[44px] rounded-input px-4 font-semibold text-bronze-ink">
              Try again
            </button>
          </div>
        )}
        {loadState === "ready" && rows.length === 0 && (
          <div className="rounded-card border border-line-soft bg-white px-6 py-9 text-center shadow-card">
            <h2 className="font-serif text-[20px] text-ink">No bookings yet.</h2>
            <p className="mt-2 font-sans text-[13px] leading-[1.6] text-body">
              Share booktimewith.link/{config.handle}; new appointments will appear here.
            </p>
          </div>
        )}
        {loadState === "ready" && groups.map((group) => (
          <div key={group.key}>
            <SectionLabel className="mb-2">{group.label}</SectionLabel>
            <div className="overflow-hidden rounded-card border border-line-soft bg-white shadow-card">
              {rows
                .filter(
                  (b) =>
                    bookingGroupInZone(new Date(b.startsAt), now, config.timezone).key ===
                    group.key,
                )
                .map((b) => (
                  <BookingRow
                    key={b.id}
                    b={b}
                    meta={`${b.serviceName || "Session"} · ${fmtDuration(b.durationMinutes || config.duration)}`}
                    timezone={config.timezone}
                    patch={patch}
                    act={act}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>

      <AwayControl away={config.away} onChange={(away) => update({ away })} />

      <p className="mt-4 text-center font-sans text-[11.5px] leading-[1.6] text-body text-pretty">
        When email delivery is configured, moving or cancelling sends the client a
        polite update automatically.
      </p>
    </div>
  );
}

function bookingGroupInZone(start: Date, now: Date, timezone: string): BookingGroup {
  const label = formatInTimeZone(start, timezone, "EEEE d MMMM").toUpperCase();
  const startKey = formatInTimeZone(start, timezone, "yyyy-MM-dd");
  const todayKey = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const tomorrow = datePartsInZone(now, timezone, 1);
  const tomorrowKey = `${tomorrow.y}-${String(tomorrow.m + 1).padStart(2, "0")}-${String(tomorrow.d).padStart(2, "0")}`;
  if (startKey === todayKey) return { key: startKey, label: `TODAY · ${label}` };
  if (startKey === tomorrowKey) {
    return { key: startKey, label: `TOMORROW · ${label}` };
  }
  return { key: startKey, label };
}

/** "3–10 Aug" / "28 Jul – 2 Aug" */
function fmtAwayRange(start: string, end: string): string {
  const dateOnly = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  };
  const [s, e] = [dateOnly(start), dateOnly(end)];
  const mon = (d: Date) =>
    d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  if (s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear()) {
    return `${s.getUTCDate()}–${e.getUTCDate()} ${mon(e)}`;
  }
  return `${s.getUTCDate()} ${mon(s)} – ${e.getUTCDate()} ${mon(e)}`;
}

/**
 * The one time-off control (README "Scheduling engine rules"): a date range,
 * nothing else — no half-day rules, no recurring holidays.
 */
function AwayControl({
  away,
  onChange,
}: {
  away: { start: string; end: string } | null;
  onChange: (away: { start: string; end: string } | null) => void;
}) {
  const [start, setStart] = useState(away?.start ?? "");
  const [end, setEnd] = useState(away?.end ?? "");
  const invalidRange = Boolean(start && end && start > end);
  useEffect(() => {
    setStart(away?.start ?? "");
    setEnd(away?.end ?? "");
  }, [away]);

  const apply = (s: string, e: string) => {
    setStart(s);
    setEnd(e);
    if (s && e && s <= e) onChange({ start: s, end: e });
    else if (!s && !e) onChange(null);
  };

  const dateInput = (value: string, set: (v: string) => void, label: string) => (
    <input
      type="date"
      value={value}
      onChange={(e) => set(e.target.value)}
      aria-label={label}
      className="min-h-[44px] rounded-input border border-line bg-white px-2 font-sans text-[12.5px] text-ink outline-none"
    />
  );

  return (
    <div className="mt-6 rounded-card border border-line-soft bg-white px-[22px] py-4 shadow-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SectionLabel>Away</SectionLabel>
        <div className="flex flex-wrap items-center gap-2 font-sans text-[12.5px] text-body">
          {dateInput(start, (v) => apply(v, end), "Away from")}
          <span>to</span>
          {dateInput(end, (v) => apply(start, v), "Away until")}
          {away && (
            <button
              type="button"
              onClick={() => apply("", "")}
              className="min-h-[44px] px-2 font-sans text-[12px] font-semibold text-body hover:text-ink"
            >
              clear
            </button>
          )}
        </div>
      </div>
      {away && !invalidRange && (
        <div className="mt-2 font-sans text-[12px] text-bronze-ink">
          Away {fmtAwayRange(away.start, away.end)} · clients see nothing available
        </div>
      )}
      {invalidRange && (
        <div role="alert" className="mt-2 font-sans text-[12px] text-body">
          The end date must be on or after the start date.
        </div>
      )}
    </div>
  );
}

function BookingRow({
  b,
  meta,
  timezone,
  patch,
  act,
}: {
  b: Row;
  meta: string;
  timezone: string;
  patch: (id: string, p: Partial<Row>) => void;
  act: (
    id: string,
    payload:
      | { action: "move"; startsAt: string; reason?: string }
      | { action: "cancel"; reason?: string }
      | { action: "restore" },
    actionKey: string,
  ) => Promise<ActionResult>;
}) {
  const first = b.clientName.split(" ")[0];
  const cancelled = b.status === "cancelled";
  const strike = cancelled ? "line-through" : "none";
  const time = formatInTimeZone(new Date(b.startsAt), timezone, "h:mma").toLowerCase();
  const [busy, setBusy] = useState<"move" | "cancel" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);
  const actionIntent = useRef<{ fingerprint: string; key: string } | null>(null);
  const reasonId = useId();

  const noteFor = (result: ActionResult) =>
    !result.emailDeliveryConfigured
      ? "Saved · email delivery is not configured"
      : result.clientEmailQueued
        ? `${first}'s email is queued`
        : "Saved · no client email was queued";

  const run = async (
    payload:
      | { action: "move"; startsAt: string; reason?: string }
      | { action: "cancel"; reason?: string }
      | { action: "restore" },
    onSuccess: (result: ActionResult) => void,
  ) => {
    if (busy) return;
    setBusy(payload.action);
    setError(null);
    const fingerprint = JSON.stringify(payload);
    if (actionIntent.current?.fingerprint !== fingerprint) {
      actionIntent.current = { fingerprint, key: crypto.randomUUID() };
    }
    const result = await act(b.id, payload, actionIntent.current.key);
    if (result.ok) {
      actionIntent.current = null;
      onSuccess(result);
    }
    else setError(result.error ?? "That change couldn't be saved.");
    setBusy(null);
  };

  return (
    <div className="-mt-px border-t border-hairline first:mt-0 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-[22px]">
        <div
          className="min-w-[48px] font-sans text-[14px] font-semibold"
          style={{ color: cancelled ? T.body : T.ink, textDecoration: strike }}
        >
          {time}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="font-sans text-[13.5px] font-semibold"
            style={{ color: cancelled ? T.body : T.ink, textDecoration: strike }}
          >
            <span className="break-words">{b.clientName}</span>
          </div>
          <div className="mt-[2px] font-sans text-[12px] text-body">{meta}</div>
          {b.calendarSyncStatus === "failed" && (
            <div className="mt-1 font-sans text-[11.5px] text-body">
              Calendar sync needs attention in Settings.
            </div>
          )}
          {deliveryNote && (
            <div className="mt-1 font-sans text-[11.5px] text-bronze-ink">
              {deliveryNote}
            </div>
          )}
          {(b.clientEmail || b.location) && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-sans text-[11.5px] leading-[1.5] text-body">
              {b.clientEmail && <a className="break-all font-semibold text-bronze-ink" href={`mailto:${b.clientEmail}`}>{b.clientEmail}</a>}
              {b.location && <span className="break-words">At {b.location}</span>}
            </div>
          )}
        </div>

        {!cancelled && !b.movedTo && !b.moving && !confirmingCancel && (
          <div className="ml-auto flex gap-1 sm:gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => { setError(null); patch(b.id, { moving: true }); }}
              className="min-h-[44px] px-2 font-sans text-[12px] font-semibold text-bronze-ink"
            >
              Move
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => { setError(null); setConfirmingCancel(true); }}
              className="min-h-[44px] px-2 font-sans text-[12px] font-semibold text-body hover:text-ink"
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel"}
            </button>
          </div>
        )}

        {cancelled && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1 sm:gap-2">
            <span className="font-sans text-[11.5px] text-body">Cancelled</span>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run(
                { action: "restore" },
                (result) => {
                  patch(b.id, { status: "confirmed" });
                  setDeliveryNote(noteFor(result));
                },
              )}
              className="min-h-[44px] px-2 font-sans text-[12px] font-semibold text-bronze-ink"
            >
              {busy === "restore" ? "Restoring…" : "Undo"}
            </button>
          </div>
        )}

        {!cancelled && b.movedTo && (
          <div className="ml-auto font-sans text-[11.5px] text-bronze-ink">
            Moved to {b.movedTo}
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="mx-4 mb-4 rounded-chip border border-line-soft bg-tint-warm px-4 py-3 font-sans text-[12px] text-body sm:mx-[22px]">
          {error}
        </div>
      )}

      {!cancelled && confirmingCancel && (
        <div className="mx-4 mb-4 rounded-chip border border-line-soft bg-paper px-4 py-3 sm:mx-[22px]">
          <label htmlFor={`${reasonId}-cancel`} className="block font-sans text-[11.5px] font-semibold text-body">
            Note for {first} (optional)
          </label>
          <input
            id={`${reasonId}-cancel`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={240}
            placeholder="A short reason, in your own words"
            className="mt-2 min-h-[44px] w-full rounded-input border border-line bg-white px-3 font-sans text-ink"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run(
                { action: "cancel", ...(reason.trim() ? { reason: reason.trim() } : {}) },
                (result) => {
                  patch(b.id, { status: "cancelled", moving: false });
                  setDeliveryNote(noteFor(result));
                  setConfirmingCancel(false);
                  setReason("");
                },
              )}
              className="min-h-[44px] rounded-input bg-ink px-4 font-sans text-[12px] font-semibold text-paper"
            >
              {busy === "cancel" ? "Cancelling…" : "Send cancellation"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => { setConfirmingCancel(false); setReason(""); }}
              className="min-h-[44px] px-3 font-sans text-[12px] font-semibold text-body"
            >
              Never mind
            </button>
          </div>
        </div>
      )}

      {b.moving && (
        <div className="flex flex-wrap items-center gap-[10px] px-4 pb-4 sm:px-[22px]">
          <label htmlFor={`${reasonId}-move`} className="w-full font-sans text-[11.5px] font-semibold text-body">
            Note for {first} (optional)
          </label>
          <input
            id={`${reasonId}-move`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={240}
            placeholder="A short reason, in your own words"
            className="min-h-[44px] w-full rounded-input border border-line bg-white px-3 font-sans text-ink"
          />
          <span className="font-sans text-[12px] text-body">Move to:</span>
          {b.moveOptions.map((o) => (
            <button
              key={o.startsAt}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run(
                {
                  action: "move",
                  startsAt: o.startsAt,
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                },
                (result) => {
                  patch(b.id, { moving: false, movedTo: o.label, startsAt: o.startsAt });
                  setDeliveryNote(noteFor(result));
                  setReason("");
                },
              )}
              className="min-h-[44px] rounded-[5px] border border-line px-[14px] font-sans text-[12.5px] font-semibold text-ink hover:bg-tint-warm"
            >
              {busy === "move" ? "Moving…" : o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { patch(b.id, { moving: false }); setReason(""); }}
            disabled={Boolean(busy)}
            className="ml-1 min-h-[44px] px-2 font-sans text-[12px] font-semibold text-body"
          >
            never mind
          </button>
          {b.moveOptions.length === 0 && (
            <span className="font-sans text-[12px] text-body">No alternative times are open right now.</span>
          )}
        </div>
      )}
    </div>
  );
}
