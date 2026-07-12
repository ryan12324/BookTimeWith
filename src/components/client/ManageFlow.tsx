"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublishedConfig } from "@/lib/store";
import { fmtDuration } from "@/lib/format";
import { fmtSlotLabel } from "@/lib/slots";
import { clientZone, zoneLabel } from "@/lib/timezone";
import { StatusBadge, SectionLabel } from "@/components/ui";
import { CardShell } from "./CardShell";
import { DayTabs, SlotGrid } from "./Picker";
import { T } from "@/lib/tokens";

type Step = "loading" | "error" | "view" | "pick" | "moved" | "cancelled" | "expired";

interface ApiSlot {
  startsAt: string;
  label: string;
}
interface ApiDay {
  key: string;
  dow: string;
  date: string;
  full: string;
  slots: ApiSlot[];
}
interface ManagedBooking {
  startsAt: string;
  clientName: string;
  status: string;
  durationMinutes: number;
  service: string;
  locationMode: "mine" | "theirs" | "virtual";
  location: string | null;
  meetingLink: string | null;
}

/** "Tuesday, July 14 · 10:00 – 10:50" */
function fmtWhen(start: Date, durationMinutes: number): string {
  const day = start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return `${day} · ${fmtSlotLabel(start)} – ${fmtSlotLabel(end)}`;
}

/** "Tuesday 10:00" */
function fmtWhenShort(start: Date): string {
  return `${start.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })} at ${fmtSlotLabel(start)}`;
}

/**
 * Client manage page (booktimewith.link, reached only from the magic link in
 * client emails — no login). The token resolves server-side; the 24-hour
 * cutoff is enforced by the API and mirrored here.
 */
export function ManageFlow({ token }: { token: string }) {
  const {
    config: cfg,
    ready,
    error: configError,
    retry: retryConfig,
  } = usePublishedConfig({ manageToken: token });
  const ownerName = cfg.name.trim() || cfg.handle || "";
  const ownerFirst = ownerName.split(/[ ,]/)[0] || "The owner";

  const [step, setStep] = useState<Step>("loading");
  const [booking, setBooking] = useState<ManagedBooking | null>(null);
  const [canChange, setCanChange] = useState(true);
  const [days, setDays] = useState<ApiDay[] | null>(null);
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState(-1);
  const [movedTo, setMovedTo] = useState<Date | null>(null);
  const [conflict, setConflict] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [action, setAction] = useState<"move" | "cancel" | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const actionIntent = useRef<{ fingerprint: string; key: string } | null>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<Step>(step);
  const [actionDelivery, setActionDelivery] = useState<{
    configured: boolean;
    ownerNotified: boolean;
  } | null>(null);

  const service = booking?.service ?? "Booking";
  const duration = booking?.durationMinutes ?? 0;
  const serviceLine = booking
    ? `${service} · ${fmtDuration(duration)}`
    : "Booking details";

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    stepHeading.current?.focus();
  }, [step]);

  const loadBooking = useCallback(async () => {
    setStep("loading");
    setLoadError(null);
    setActionDelivery(null);
    try {
      const res = await fetch(`/api/manage/${encodeURIComponent(token)}`);
      const data = (await res.json().catch(() => null)) as
        | { booking?: ManagedBooking; canChange?: boolean; error?: string }
        | null;
      if (res.status === 404 || res.status === 410) {
        setStep("expired");
        return;
      }
      if (!res.ok || !data?.booking) {
        throw new Error(data?.error ?? "manage page unavailable");
      }
      setBooking(data.booking);
      setCanChange(Boolean(data.canChange));
      setStep(data.booking.status === "cancelled" ? "cancelled" : "view");
    } catch {
      setLoadError("This booking couldn't load. Check your connection and try again.");
      setStep("error");
    }
  }, [token]);
  useEffect(() => {
    void loadBooking();
  }, [loadBooking]);

  const loadSlots = useCallback(async () => {
    setDays(null);
    setSlotError(null);
    try {
      const params = new URLSearchParams({
        tz: clientZone(),
        manageToken: token,
      });
      const res = await fetch(`/api/slots?${params.toString()}`);
      const data = (await res.json()) as { days?: ApiDay[]; error?: string };
      if (!res.ok || !Array.isArray(data.days)) throw new Error(data.error ?? "unavailable");
      const nextDays = data.days;
      setDays(nextDays);
      setDay((current) => Math.min(current, Math.max(0, nextDays.length - 1)));
      setSlot(-1);
    } catch {
      setDays([]);
      setSlotError("Open times couldn't load. Check your connection and try again.");
    }
  }, [token]);
  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  const start = booking ? new Date(booking.startsAt) : null;
  const whenFull = start ? fmtWhen(start, duration) : "";
  const whenShort = start ? fmtWhenShort(start) : "";

  const currentDay = days?.[day];
  const hasSlot = slot >= 0 && !!currentDay?.slots[slot];
  const picked = hasSlot ? currentDay.slots[slot] : null;
  const dayShort = currentDay ? `${currentDay.dow} ${currentDay.date}` : "";

  const act = async (
    payload: { action: "move"; startsAt: string } | { action: "cancel" },
  ): Promise<boolean> => {
    if (action) return false;
    setAction(payload.action);
    setActionError(null);
    const intentPayload = { ...payload, clientTimezone: clientZone() };
    const fingerprint = JSON.stringify(intentPayload);
    if (actionIntent.current?.fingerprint !== fingerprint) {
      actionIntent.current = { fingerprint, key: crypto.randomUUID() };
    }
    try {
      const res = await fetch(`/api/manage/${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...intentPayload,
          actionKey: actionIntent.current.key,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            error?: string;
            status?: string;
            startsAt?: string;
            emailDeliveryConfigured?: boolean;
            ownerNotified?: boolean;
          }
        | null;
      if (res.status === 403) {
        actionIntent.current = null;
        setCanChange(false);
        setActionError(data?.error ?? "Changes are now locked for this booking.");
        setConfirmingCancel(false);
        setStep("view");
        return false;
      }
      if (res.status === 409 || res.status === 422) {
        actionIntent.current = null;
        const mustReload =
          res.status === 409 &&
          (Boolean(data?.status) ||
            /changed after|no longer active/i.test(data?.error ?? ""));
        if (mustReload) {
          setActionError(
            data?.error ?? "This booking changed elsewhere. Its current state is shown.",
          );
          setConfirmingCancel(false);
          await loadBooking();
        } else if (payload.action === "move") {
          setConflict(true);
          setActionError(data?.error ?? "That time is no longer available.");
          setSlot(-1);
          await loadSlots();
        } else {
          setActionError(
            data?.error ?? "This booking changed elsewhere. Reload it and try again.",
          );
          setConfirmingCancel(false);
        }
        return false;
      }
      if (!res.ok) {
        setActionError(data?.error ?? "That change couldn't be saved. Try again.");
        return false;
      }
      actionIntent.current = null;
      setActionDelivery({
        configured: Boolean(data?.emailDeliveryConfigured),
        ownerNotified: Boolean(data?.ownerNotified),
      });
      return true;
    } catch {
      setActionError("That change couldn't be sent. Check your connection and try again.");
      return false;
    } finally {
      setAction(null);
    }
  };

  const move = async () => {
    if (!picked) return;
    if (await act({ action: "move", startsAt: picked.startsAt })) {
      setMovedTo(new Date(picked.startsAt));
      setBooking((current) =>
        current ? { ...current, startsAt: picked.startsAt, status: "confirmed" } : current,
      );
      await loadSlots();
      setStep("moved");
    }
  };

  const cancel = async () => {
    if (await act({ action: "cancel" })) {
      setConfirmingCancel(false);
      setBooking((current) =>
        current ? { ...current, status: "cancelled" } : current,
      );
      await loadSlots();
      setStep("cancelled");
    }
  };

  if (step === "expired") {
    return (
      <div className="mx-auto flex justify-center px-6 pt-16">
        <div className="w-full max-w-[420px] rounded-card-lg border border-line-soft bg-white p-8 text-center shadow-float">
          <StatusBadge variant="neutral" />
          <h1 className="mt-[18px] font-serif text-[24px] tracking-[-.01em]">
            This link is no longer available.
          </h1>
          <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
            Manage links stop working when an appointment ends. If you rescheduled,
            use the link in the newer confirmation.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="mx-auto flex justify-center px-0 pt-0 sm:px-6 sm:pt-9">
        <div role="status" className="w-full max-w-[420px] bg-white px-[26px] py-16 text-center font-sans text-[13.5px] text-body sm:rounded-card-lg sm:border sm:border-line-soft sm:shadow-float">
          Loading this booking…
        </div>
      </div>
    );
  }

  if (configError) {
    return (
      <div className="mx-auto flex justify-center px-6 pt-16">
        <div role="alert" className="w-full max-w-[420px] rounded-card-lg border border-line-soft bg-white p-8 text-center shadow-float">
          <h1 className="font-serif text-[24px] tracking-[-.01em]">This booking couldn&apos;t load.</h1>
          <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
            Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={retryConfig}
            className="mt-3 min-h-[44px] rounded-input px-4 font-sans text-[12.5px] font-semibold text-bronze-ink"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex justify-center px-0 pt-0 sm:px-6 sm:pt-9">
      <CardShell ownerName={ownerName} serviceLine={serviceLine}>
        <h1 ref={stepHeading} tabIndex={-1} className="sr-only">
          {step === "pick"
            ? "Choose a new booking time"
            : step === "moved"
              ? "Booking moved"
              : step === "cancelled"
                ? "Booking cancelled"
                : "Manage your booking"}
        </h1>
        {step === "loading" && (
          <div role="status" className="px-[26px] py-[54px] text-center font-sans text-[13.5px] text-body">
            Loading your booking…
          </div>
        )}

        {step === "error" && (
          <div role="alert" className="px-[26px] py-[42px] text-center">
            <StatusBadge variant="neutral" />
            <p className="mt-4 font-sans text-[13.5px] leading-[1.6] text-body">{loadError}</p>
            <button type="button" onClick={() => void loadBooking()} className="mt-3 min-h-[44px] rounded-input px-4 font-sans text-[12.5px] font-semibold text-bronze-ink">
              Try again
            </button>
          </div>
        )}

        {step === "view" && booking && (
          <div className="px-[26px] pb-[26px] pt-[22px]">
            <SectionLabel className="mb-[10px]">Your booking</SectionLabel>
            <div className="rounded-[8px] border border-hairline bg-paper px-5 py-4">
              <div className="font-sans text-[15px] font-semibold text-ink">{whenFull}</div>
              <div className="mt-1 font-sans text-[13px] text-body">
                {service} with {ownerFirst} · booked by {booking.clientName}
              </div>
              {booking.location && (
                <div className="mt-2 break-words font-sans text-[12.5px] text-body">
                  At {booking.location}
                </div>
              )}
              {booking.meetingLink && (
                <a
                  href={booking.meetingLink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex min-h-[44px] items-center font-sans text-[12.5px] font-semibold text-bronze-ink"
                >
                  Open meeting link
                </a>
              )}
              {booking.locationMode === "virtual" && !booking.meetingLink && (
                <div className="mt-2 font-sans text-[12.5px] leading-[1.5] text-body">
                  Your meeting link will appear here when it is ready.
                </div>
              )}
              <div className="mt-1 font-sans text-[11px] text-body">
                Times in {zoneLabel(clientZone(), start ?? new Date())}
              </div>
            </div>
            <button
              type="button"
              disabled={!canChange || Boolean(action)}
              onClick={() => { if (canChange) { setStep("pick"); setDay(0); setSlot(-1); } }}
              className="mt-4 w-full rounded-chip py-[13px] text-center font-sans text-[14px] font-semibold text-paper"
              style={{ background: canChange ? T.ink : T.disabled }}
            >
              Pick a new time
            </button>
            {!confirmingCancel ? (
              <button
                type="button"
                disabled={!canChange || Boolean(action)}
                onClick={() => {
                  if (!canChange) return;
                  setActionError(null);
                  setConfirmingCancel(true);
                }}
                className="mt-[10px] w-full rounded-chip border border-line py-[13px] text-center font-sans text-[14px] font-semibold"
                style={{ color: canChange ? T.ink : T.faint }}
              >
                Cancel booking
              </button>
            ) : (
              <div className="mt-[10px] rounded-chip border border-line bg-paper px-4 py-3 text-center">
                <p className="font-sans text-[12.5px] leading-[1.5] text-body">
                  Cancel this booking? The time will become available to someone else.
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    disabled={Boolean(action)}
                    onClick={() => void cancel()}
                    aria-busy={action === "cancel"}
                    className="min-h-[44px] rounded-input bg-ink px-4 font-sans text-[12.5px] font-semibold text-paper"
                  >
                    {action === "cancel" ? "Cancelling…" : "Yes, cancel it"}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(action)}
                    onClick={() => setConfirmingCancel(false)}
                    className="min-h-[44px] px-3 font-sans text-[12.5px] font-semibold text-bronze-ink"
                  >
                    Keep booking
                  </button>
                </div>
              </div>
            )}
            {actionError && (
              <div role="alert" className="mt-3 rounded-chip border border-line-soft bg-tint-warm px-4 py-3 text-center font-sans text-[12px] text-body">
                {actionError}
              </div>
            )}
            <div className="mt-3 text-center font-sans text-[11.5px] text-body">
              {canChange
                ? "Free to change until 24 hours before."
                : "Less than 24 hours to go — changes are locked. Reply to your confirmation email if something's come up."}
            </div>
          </div>
        )}

        {step === "pick" && (
          <div className="px-[26px] pb-[26px] pt-5">
            <div className="rounded-chip border border-line-soft bg-tint-warm px-[15px] py-[11px] font-sans text-[12.5px] text-body">
              Moving your {whenShort} booking
              <button
                type="button"
                onClick={() => setStep(booking?.status === "cancelled" ? "cancelled" : "view")}
                className="ml-[6px] min-h-[44px] px-1 font-semibold text-bronze-ink"
              >
                keep it
              </button>
            </div>
            {conflict && (
              <div role="alert" className="mt-3 rounded-chip border border-line-soft bg-tint-warm px-[15px] py-[11px] font-sans text-[12.5px] text-body">
                {actionError ?? "That time just went. Here is what is still open."}
              </div>
            )}
            {days === null && (
              <div role="status" className="py-8 text-center font-sans text-[13.5px] text-body">
                Finding open times…
              </div>
            )}
            {days && slotError && (
              <div role="alert" className="py-7 text-center font-sans text-[13.5px] leading-[1.6] text-body">
                <p>{slotError}</p>
                <button type="button" onClick={() => void loadSlots()} className="mt-3 min-h-[44px] rounded-input px-4 font-semibold text-bronze-ink">
                  Try again
                </button>
              </div>
            )}
            {days && !slotError && days.length === 0 && (
              <div className="py-8 text-center font-sans text-[13.5px] leading-[1.6] text-body">
                Nothing available in the next few weeks.
              </div>
            )}
            {days && !slotError && days.length > 0 && (
              <>
                <div className="mt-4">
                  <DayTabs days={days} selected={day} onPick={(i) => { setDay(i); setSlot(-1); }} />
                </div>
                <div className="mt-4">
                  <SlotGrid
                    slots={currentDay?.slots.map((s) => s.label) ?? []}
                    selected={slot}
                    onPick={(i) => {
                      setSlot(i);
                      setConflict(false);
                      setActionError(null);
                      actionIntent.current = null;
                    }}
                  />
                </div>
                <div className="mt-2 text-center font-sans text-[11px] text-body">
                  Times in {zoneLabel(clientZone(), picked ? new Date(picked.startsAt) : new Date())}
                </div>
                <button
                  type="button"
                  disabled={!hasSlot || Boolean(action)}
                  onClick={() => void move()}
                  aria-busy={action === "move"}
                  className="sticky bottom-3 z-10 mt-[18px] w-full rounded-chip py-[13px] text-center font-sans text-[14px] font-semibold text-paper sm:static"
                  style={{ background: hasSlot && !action ? T.bronzeHover : T.disabled }}
                >
                  {action === "move"
                    ? "Moving…"
                    : hasSlot
                      ? `Move to ${dayShort} at ${picked?.label} →`
                      : "Pick a new time"}
                </button>
                {actionError && !conflict && (
                  <div role="alert" className="mt-3 rounded-chip border border-line-soft bg-tint-warm px-4 py-3 text-center font-sans text-[12px] text-body">
                    {actionError}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === "moved" && (
          <div className="px-[26px] py-[34px] text-center">
            <StatusBadge variant="done" />
            <h2 className="mt-[18px] font-serif text-[24px] tracking-[-.01em]">Moved.</h2>
            <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
              {service} with {ownerFirst} · now{" "}
              {movedTo ? fmtWhenShort(movedTo) : ""}
              .
            </p>
            <p className="mt-[6px] font-sans text-[12px] text-body">
              {!actionDelivery?.configured
                ? "Your change is saved, but this site has not configured email delivery."
                : actionDelivery.ownerNotified
                  ? `An update for ${ownerFirst} and your fresh confirmation are queued.`
                  : "Your fresh confirmation is queued. Your change is saved here."}
            </p>
          </div>
        )}

        {step === "cancelled" && (
          <div className="px-[26px] py-[34px] text-center">
            <StatusBadge variant="neutral" />
            <h2 className="mt-[18px] font-serif text-[24px] tracking-[-.01em]">Cancelled.</h2>
            <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
              Your {whenShort} booking is cancelled. {actionDelivery === null
                ? ""
                : actionDelivery.ownerNotified
                  ? `An update for ${ownerFirst} is queued.`
                  : actionDelivery.configured
                    ? "The cancellation is saved. No owner email was queued."
                    : "The cancellation is saved, but this site has not configured email delivery."}
            </p>
            {actionError && (
              <div role="alert" className="mt-3 rounded-chip border border-line-soft bg-tint-warm px-4 py-3 font-sans text-[12px] text-body">
                {actionError}
              </div>
            )}
            {cfg.handle && (
              <a
                href={`/${cfg.handle}`}
                className="mt-5 inline-flex min-h-[44px] items-center px-3 font-sans text-[12.5px] font-semibold text-bronze-ink"
              >
                Book a new appointment
              </a>
            )}
          </div>
        )}
      </CardShell>
    </div>
  );
}
