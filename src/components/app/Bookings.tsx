"use client";

import { useState } from "react";
import { useOwnerConfig } from "@/lib/store";
import { fmtDuration } from "@/lib/format";
import { DEFAULT_BOOKINGS, MOVE_OPTIONS, type Booking } from "@/lib/mock";
import { SectionLabel } from "@/components/ui";
import { T } from "@/lib/tokens";

/**
 * Owner bookings management. Move opens an inline row of alternative times;
 * Cancel strikes the row through with an Undo. Every action notes the client was
 * emailed — the system writes that polite email so the owner never has to.
 */
export function Bookings() {
  const { config } = useOwnerConfig();
  const [bookings, setBookings] = useState<Booking[]>(DEFAULT_BOOKINGS);
  const meta = `${config.service.trim() || "Session"} · ${fmtDuration(config.duration)}`;

  const patch = (id: number, p: Partial<Booking>) =>
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...p } : b)));

  const groups = [...new Set(bookings.map((b) => b.grp))];
  const upcoming = bookings.filter((b) => b.status !== "cancelled").length;

  return (
    <div className="mx-auto mt-9 max-w-[680px]">
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-[28px] tracking-[-.01em]">Your bookings</h1>
        <div className="font-sans text-[12.5px] text-faint">{upcoming} upcoming</div>
      </div>

      <div className="mt-5 flex flex-col gap-6">
        {groups.map((label) => (
          <div key={label}>
            <SectionLabel className="mb-2">{label}</SectionLabel>
            <div className="overflow-hidden rounded-card border border-line-soft bg-white shadow-card">
              {bookings
                .filter((b) => b.grp === label)
                .map((b) => (
                  <Row key={b.id} b={b} meta={meta} patch={patch} />
                ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-center font-sans text-[11.5px] leading-[1.6] text-faint text-pretty">
        Move or cancel here and the client gets a polite email with your reason and
        available times — you never have to write it.
      </p>
    </div>
  );
}

function Row({
  b,
  meta,
  patch,
}: {
  b: Booking;
  meta: string;
  patch: (id: number, p: Partial<Booking>) => void;
}) {
  const first = b.name.split(" ")[0];
  const cancelled = b.status === "cancelled";
  const strike = cancelled ? "line-through" : "none";
  const options = MOVE_OPTIONS.filter((t) => t !== b.time).slice(0, 3);

  return (
    <div className="-mt-px border-t border-hairline first:mt-0 first:border-t-0">
      <div className="flex items-center gap-4 px-[22px] py-4">
        <div
          className="min-w-[48px] font-sans text-[14px] font-semibold"
          style={{ color: cancelled ? T.faint : T.ink, textDecoration: strike }}
        >
          {b.time}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="font-sans text-[13.5px] font-semibold"
            style={{ color: cancelled ? T.faint : T.ink, textDecoration: strike }}
          >
            {b.name}
          </div>
          <div className="mt-[2px] font-sans text-[12px] text-faint">{meta}</div>
        </div>

        {b.status === "ok" && (
          <div className="flex gap-[14px]">
            <button
              type="button"
              onClick={() => patch(b.id, { moving: true })}
              className="font-sans text-[12px] font-semibold text-bronze hover:text-bronze-ink"
            >
              Move
            </button>
            <button
              type="button"
              onClick={() => patch(b.id, { status: "cancelled", moving: false })}
              className="font-sans text-[12px] font-semibold text-faint hover:text-body"
            >
              Cancel
            </button>
          </div>
        )}

        {cancelled && (
          <div className="flex items-center gap-[14px]">
            <span className="font-sans text-[11.5px] text-faint">Cancelled · {first} emailed</span>
            <button
              type="button"
              onClick={() => patch(b.id, { status: "ok" })}
              className="font-sans text-[12px] font-semibold text-bronze"
            >
              Undo
            </button>
          </div>
        )}

        {b.status === "moved" && (
          <div className="font-sans text-[11.5px] text-bronze">
            Moved to {b.movedTo} · {first} emailed
          </div>
        )}
      </div>

      {b.moving && (
        <div className="flex flex-wrap items-center gap-[10px] px-[22px] pb-4">
          <span className="font-sans text-[12px] text-body">Move to:</span>
          {options.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => patch(b.id, { status: "moved", moving: false, movedTo: t })}
              className="rounded-[5px] border border-line px-[14px] py-2 font-sans text-[12.5px] font-semibold text-ink hover:bg-tint-warm"
            >
              {t}
            </button>
          ))}
          <button
            type="button"
            onClick={() => patch(b.id, { moving: false })}
            className="ml-1 font-sans text-[12px] font-semibold text-faint"
          >
            never mind
          </button>
        </div>
      )}
    </div>
  );
}
