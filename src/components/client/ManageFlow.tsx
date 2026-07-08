"use client";

import { useState } from "react";
import { usePublishedConfig } from "@/lib/store";
import { fmtDuration } from "@/lib/format";
import { BOOKING_DAYS, OWNER_NAME, SLOT_SETS } from "@/lib/mock";
import { StatusBadge, SectionLabel } from "@/components/ui";
import { CardShell } from "./CardShell";
import { DayTabs, SlotGrid } from "./Picker";
import { T } from "@/lib/tokens";

type Step = "view" | "pick" | "moved" | "cancelled";

const WHEN = "Tuesday, July 14 · 10:00 – 10:50";
const WHEN_SHORT = "Tuesday 10:00";

/**
 * Client manage page (booktimewith.link, reached only from the "Change or cancel"
 * magic link — no login). View the booking, reschedule, or cancel.
 */
export function ManageFlow() {
  const cfg = usePublishedConfig();
  const service = cfg.service.trim() || "Session";
  const serviceLine = `${service} · ${fmtDuration(cfg.duration)}`;

  const [step, setStep] = useState<Step>("view");
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState(-1);

  const slots = SLOT_SETS[day];
  const hasSlot = slot >= 0;
  const dayShort = BOOKING_DAYS[day].full.split(" ")[0];

  return (
    <div className="mx-auto flex justify-center px-0 pt-0 sm:px-6 sm:pt-9">
      <CardShell ownerName={OWNER_NAME} serviceLine={serviceLine}>
        {step === "view" && (
          <div className="px-[26px] pb-[26px] pt-[22px]">
            <SectionLabel className="mb-[10px]">Your booking</SectionLabel>
            <div className="rounded-[8px] border border-hairline bg-paper px-5 py-4">
              <div className="font-sans text-[15px] font-semibold text-ink">{WHEN}</div>
              <div className="mt-1 font-sans text-[13px] text-body">
                {service} with Dana · booked by Alex Martin
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setStep("pick"); setDay(0); setSlot(-1); }}
              className="mt-4 w-full rounded-chip bg-ink py-[13px] text-center font-sans text-[14px] font-semibold text-paper hover:bg-ink-soft"
            >
              Pick a new time
            </button>
            <button
              type="button"
              onClick={() => setStep("cancelled")}
              className="mt-[10px] w-full rounded-chip border border-line py-[13px] text-center font-sans text-[14px] font-semibold text-ink hover:bg-paper"
            >
              Cancel booking
            </button>
            <div className="mt-3 text-center font-sans text-[11.5px] text-faint">
              Free to change until 24 hours before.
            </div>
          </div>
        )}

        {step === "pick" && (
          <div className="px-[26px] pb-[26px] pt-5">
            <div className="rounded-chip border border-line-soft bg-tint-warm px-[15px] py-[11px] font-sans text-[12.5px] text-body">
              Moving your {WHEN_SHORT} booking
              <button
                type="button"
                onClick={() => setStep("view")}
                className="ml-[6px] font-semibold text-bronze"
              >
                keep it
              </button>
            </div>
            <div className="mt-4">
              <DayTabs days={BOOKING_DAYS} selected={day} onPick={(i) => { setDay(i); setSlot(-1); }} />
            </div>
            <div className="mt-4">
              <SlotGrid slots={slots} selected={slot} onPick={setSlot} />
            </div>
            <button
              type="button"
              disabled={!hasSlot}
              onClick={() => hasSlot && setStep("moved")}
              className="sticky bottom-3 z-10 mt-[18px] w-full rounded-chip py-[13px] text-center font-sans text-[14px] font-semibold text-paper sm:static"
              style={{ background: hasSlot ? T.bronze : T.disabled }}
            >
              {hasSlot ? `Move to ${dayShort} at ${slots[slot]} →` : "Pick a new time"}
            </button>
          </div>
        )}

        {step === "moved" && (
          <div className="px-[26px] py-[34px] text-center">
            <StatusBadge variant="done" />
            <div className="mt-[18px] font-serif text-[24px] tracking-[-.01em]">Moved.</div>
            <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
              {service} with Dana · now {BOOKING_DAYS[day].full} at {slots[slot]}.
            </p>
            <p className="mt-[6px] font-sans text-[12px] text-faint">
              Dana&apos;s been told. A fresh confirmation is in your inbox.
            </p>
          </div>
        )}

        {step === "cancelled" && (
          <div className="px-[26px] py-[34px] text-center">
            <StatusBadge variant="neutral" />
            <div className="mt-[18px] font-serif text-[24px] tracking-[-.01em]">Cancelled.</div>
            <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
              Your {WHEN_SHORT} booking is gone. Dana&apos;s been told.
            </p>
            <button
              type="button"
              onClick={() => { setStep("pick"); setDay(0); setSlot(-1); }}
              className="mt-5 inline-block font-sans text-[12.5px] font-semibold text-bronze"
            >
              Book a new time instead
            </button>
          </div>
        )}
      </CardShell>
    </div>
  );
}
