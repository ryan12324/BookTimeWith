"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
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
import { fmtHour, fmtHours } from "@/lib/format";
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
    summary: `${fmtHours(openHours(cells))} open per week · half-hours count`,
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
  const instructionsId = useId();
  const [activeKey, setActiveKey] = useState(() => cellKey(0, startHour, "a"));

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

  // "Mouseup anywhere ends" (README interactions): the paint stroke survives
  // leaving the grid and only ends when the pointer is actually released.
  useEffect(() => {
    const endPaint = () => {
      mode.current = null;
    };
    window.addEventListener("pointerup", endPaint);
    window.addEventListener("pointercancel", endPaint);
    return () => {
      window.removeEventListener("pointerup", endPaint);
      window.removeEventListener("pointercancel", endPaint);
    };
  }, []);

  const startPaint = (key: string, currentlyOn: boolean, e: React.PointerEvent) => {
    e.preventDefault();
    setActiveKey(key);
    mode.current = currentlyOn ? "remove" : "add";
    paint(key, !currentlyOn);
  };

  const toggleCell = (key: string, currentlyOn: boolean) => {
    setActiveKey(key);
    paint(key, !currentlyOn);
  };

  // Mouse/pen drag may move faster than pointerenter delivery, so resolve the
  // cell under the pointer by coordinates instead.
  const onPointerMove = (e: React.PointerEvent) => {
    if (!mode.current) return;
    const el = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-cell]");
    if (el?.dataset.key) paint(el.dataset.key, mode.current === "add");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.dataset.r === undefined) return;
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
    const next = grid.current?.querySelector<HTMLElement>(`[data-r="${nr}"][data-c="${nc}"]`);
    if (next?.dataset.key) {
      setActiveKey(next.dataset.key);
      next.focus();
    }
  };

  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (grid.current?.querySelector(`[data-key="${activeKey}"]`)) return;
    setActiveKey(cellKey(0, startHour, "a"));
  }, [activeKey, endHour, startHour, weekends]);

  return (
    <div>
      <p id={instructionsId} className="sr-only">
        Weekly availability. Use arrow keys to move between half-hours and Space or Enter to
        toggle the focused time.
      </p>
      {/* Five weekday columns fit the 375px panel; weekends scroll horizontally. */}
      <div className="overflow-x-auto overscroll-x-contain pb-1">
        <div
          ref={grid}
          role="group"
          aria-label="Weekly availability"
          aria-describedby={instructionsId}
          className="grid touch-auto select-none"
          style={{
            gridTemplateColumns: `52px repeat(${cols},minmax(46px,1fr))`,
            gap: 4,
            minWidth: 52 + cols * 50,
          }}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
        >
          {/* header row */}
          <div />
          {labels.map((l) => (
            <div
              key={l}
              className="pb-1 text-center font-sans text-[11px] font-semibold tracking-[.05em] text-body"
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
              activeKey={activeKey}
              onActive={setActiveKey}
              onStart={startPaint}
              onToggle={toggleCell}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function HourRow({
  hour,
  hi,
  cols,
  cells,
  cellHeight,
  activeKey,
  onActive,
  onStart,
  onToggle,
}: {
  hour: number;
  hi: number;
  cols: number;
  cells: Record<string, 1>;
  cellHeight: number;
  activeKey: string;
  onActive: (key: string) => void;
  onStart: (key: string, on: boolean, e: React.PointerEvent) => void;
  onToggle: (key: string, on: boolean) => void;
}) {
  return (
    <>
      <div className="pr-2 pt-[7px] text-right font-sans text-[10.5px] text-body">
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
            className="availability-hour flex flex-col overflow-hidden rounded-cell border"
            style={{
              "--availability-hour-height": `${cellHeight}px`,
              borderColor: onA && onB ? T.bronze : T.line,
            } as React.CSSProperties}
          >
            <HalfCell col={c} hour={hour} half="a" r={hi * 2} on={onA} kkey={kA} active={activeKey === kA} onActive={onActive} onStart={onStart} onToggle={onToggle} />
            <HalfCell col={c} hour={hour} half="b" r={hi * 2 + 1} on={onB} kkey={kB} active={activeKey === kB} onActive={onActive} onStart={onStart} onToggle={onToggle} />
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
  active,
  onActive,
  onStart,
  onToggle,
}: {
  col: number;
  hour: number;
  half: Half;
  r: number;
  on: boolean;
  kkey: string;
  active: boolean;
  onActive: (key: string) => void;
  onStart: (key: string, on: boolean, e: React.PointerEvent) => void;
  onToggle: (key: string, on: boolean) => void;
}) {
  const paintedFromPointer = useRef(false);
  const time = (value: number, minutes: "00" | "30") =>
    `${(value % 12) || 12}:${minutes}${value < 12 ? "am" : "pm"}`;
  const startLabel = time(hour, half === "a" ? "00" : "30");
  const endLabel = half === "a" ? time(hour, "30") : time(hour + 1, "00");
  const label = `${DAY_NAMES[col]} ${startLabel} to ${endLabel}, ${on ? "open" : "closed"}`;
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
      tabIndex={active ? 0 : -1}
      className={`availability-cell relative flex-1 cursor-pointer ${half === "b" ? "border-t border-line" : ""}`}
      style={{ background: on ? T.bronze : T.paper }}
      onFocus={() => onActive(kkey)}
      onPointerDown={(e) => {
        // Touch stays native so the page and weekend overflow can scroll. A tap
        // toggles on click; mouse/pen retain the fast drag-paint interaction.
        paintedFromPointer.current = e.pointerType !== "touch";
        if (paintedFromPointer.current) onStart(kkey, on, e);
      }}
      onPointerUp={() => {
        window.setTimeout(() => {
          paintedFromPointer.current = false;
        }, 0);
      }}
      onPointerCancel={() => {
        paintedFromPointer.current = false;
      }}
      onClick={() => {
        if (paintedFromPointer.current) {
          paintedFromPointer.current = false;
          return;
        }
        onToggle(kkey, on);
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle(kkey, on);
        }
      }}
    />
  );
}
