"use client";

import { useCallback, useRef } from "react";
import { useOwnerConfig } from "@/lib/store";
import {
  cellKey,
  clearWeekendCells,
  dayLabels,
  GRID_MAX_HOUR,
  GRID_MIN_HOUR,
  openHours,
  type Half,
} from "@/lib/availability";
import { fmtHour, fmtOpenHours } from "@/lib/format";
import { T } from "@/lib/tokens";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Grid control handlers + labels, shared between onboarding and settings. */
export function useGridControls() {
  const { config, update, setConfig } = useOwnerConfig();
  const { cells, startHour, endHour, weekends } = config;

  const toggleWeekends = () =>
    setConfig((p) =>
      p.weekends
        ? { ...p, weekends: false, cells: clearWeekendCells(p.cells) }
        : { ...p, weekends: true },
    );

  return {
    weekends,
    toggleWeekends,
    startEarlier: () => update({ startHour: Math.max(GRID_MIN_HOUR, startHour - 1) }),
    finishLater: () => update({ endHour: Math.min(GRID_MAX_HOUR, endHour + 1) }),
    canEarlier: startHour > GRID_MIN_HOUR,
    canLater: endHour < GRID_MAX_HOUR,
    earlierLabel: `+ Start earlier (${fmtHour(startHour - 1)})`,
    laterLabel: `+ Finish later (${fmtHour(endHour)})`,
    summary: `${fmtOpenHours(openHours(cells))} hours open per week · half-hours count`,
  };
}

/**
 * The paintable weekly availability grid. Click or drag across half-hour cells;
 * drag mode is set from the first cell's state (paint-on if it was off, erase if
 * it was on) and applied while the pointer is held — mouse and touch alike.
 * Keyboard: focus a cell, Space/Enter toggles, arrow keys move.
 */
export function AvailabilityGrid({ cellHeight = 30 }: { cellHeight?: number }) {
  const { config, setConfig } = useOwnerConfig();
  const { cells, startHour, endHour, weekends } = config;
  const labels = dayLabels(weekends);
  const cols = labels.length;

  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);

  // Paint mode persists across pointer moves without re-rendering.
  const mode = useRef<"add" | "remove" | null>(null);

  const paint = useCallback(
    (key: string, add: boolean) => {
      setConfig((p) => {
        const next = { ...p.cells };
        if (add) next[key] = 1;
        else delete next[key];
        return { ...p, cells: next };
      });
    },
    [setConfig],
  );

  const endPaint = useCallback(() => {
    mode.current = null;
  }, []);

  const startPaint = (key: string, currentlyOn: boolean, e: React.PointerEvent) => {
    e.preventDefault();
    mode.current = currentlyOn ? "remove" : "add";
    paint(key, !currentlyOn);
  };

  // Touch drag: pointer is captured by the first cell, so siblings never get
  // pointerenter — resolve the cell under the finger by coordinates instead.
  const onPointerMove = (e: React.PointerEvent) => {
    if (!mode.current) return;
    const el = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-cell]");
    if (el?.dataset.key) paint(el.dataset.key, mode.current === "add");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (!target.dataset.r) return;
    const r = Number(target.dataset.r);
    const c = Number(target.dataset.c);
    const maxR = hours.length * 2 - 1;
    let nr = r;
    let nc = c;
    if (e.key === "ArrowUp") nr = Math.max(0, r - 1);
    else if (e.key === "ArrowDown") nr = Math.min(maxR, r + 1);
    else if (e.key === "ArrowLeft") nc = Math.max(0, c - 1);
    else if (e.key === "ArrowRight") nc = Math.min(cols - 1, c + 1);
    else return;
    e.preventDefault();
    grid.current
      ?.querySelector<HTMLElement>(`[data-r="${nr}"][data-c="${nc}"]`)
      ?.focus();
  };

  const grid = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={grid}
      className="grid touch-none select-none"
      style={{
        gridTemplateColumns: `52px repeat(${cols},1fr)`,
        gap: 4,
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endPaint}
      onPointerLeave={endPaint}
      onKeyDown={onKeyDown}
    >
      {/* header row */}
      <div />
      {labels.map((l) => (
        <div
          key={l}
          className="pb-1 text-center font-sans text-[11px] font-semibold tracking-[.05em] text-faint"
        >
          {l}
        </div>
      ))}

      {/* hour rows */}
      {hours.map((h, hi) => (
        <HourRow
          key={h}
          hour={h}
          hi={hi}
          cols={cols}
          cells={cells}
          cellHeight={cellHeight}
          onStart={startPaint}
        />
      ))}
    </div>
  );
}

function HourRow({
  hour,
  hi,
  cols,
  cells,
  cellHeight,
  onStart,
}: {
  hour: number;
  hi: number;
  cols: number;
  cells: Record<string, 1>;
  cellHeight: number;
  onStart: (key: string, on: boolean, e: React.PointerEvent) => void;
}) {
  return (
    <>
      <div className="pr-2 pt-[7px] text-right font-sans text-[10.5px] text-faint">
        {fmtHour(hour)}
      </div>
      {Array.from({ length: cols }, (_, c) => {
        const kA = cellKey(c, hour, "a");
        const kB = cellKey(c, hour, "b");
        const onA = !!cells[kA];
        const onB = !!cells[kB];
        return (
          <div
            key={c}
            className="flex flex-col overflow-hidden rounded-cell border"
            style={{
              height: cellHeight,
              borderColor: onA && onB ? T.bronze : T.lineSoft,
            }}
          >
            <HalfCell col={c} hour={hour} half="a" r={hi * 2} on={onA} kkey={kA} onStart={onStart} />
            <HalfCell col={c} hour={hour} half="b" r={hi * 2 + 1} on={onB} kkey={kB} onStart={onStart} />
          </div>
        );
      })}
    </>
  );
}

function HalfCell({
  col,
  hour,
  half,
  r,
  on,
  kkey,
  onStart,
}: {
  col: number;
  hour: number;
  half: Half;
  r: number;
  on: boolean;
  kkey: string;
  onStart: (key: string, on: boolean, e: React.PointerEvent) => void;
}) {
  const startMin = half === "a" ? "00" : "30";
  const endLabel =
    half === "a" ? `${((hour % 12) || 12)}:30` : `${(((hour + 1) % 12) || 12)}:00`;
  const label = `${DAY_NAMES[col]} ${(hour % 12) || 12}:${startMin} to ${endLabel}, ${on ? "open" : "closed"}`;
  return (
    <button
      type="button"
      data-cell
      data-key={kkey}
      data-r={r}
      data-c={col}
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      className="flex-1 cursor-pointer"
      style={{ background: on ? T.bronze : T.paper }}
      onPointerDown={(e) => onStart(kkey, on, e)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onStart(kkey, on, e as unknown as React.PointerEvent);
        }
      }}
    />
  );
}
