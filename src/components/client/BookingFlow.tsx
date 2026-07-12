"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePublishedConfig } from "@/lib/store";
import { fmtDuration } from "@/lib/format";
import { clientZone, zoneLabel } from "@/lib/timezone";
import { googleCalendarUrl, icsDataUri, outlookCalendarUrl, type CalendarEvent } from "@/lib/ics";
import { StatusBadge } from "@/components/ui";
import { CardShell } from "./CardShell";
import { DayTabs, SlotGrid } from "./Picker";
import { T } from "@/lib/tokens";

type Step = "pick" | "details" | "done";



interface ApiSlot {
  startsAt: string; // UTC instant
  label: string; // client-local "9:00"
}
interface ApiDay {
  key: string;
  dow: string;
  date: string;
  full: string;
  slots: ApiSlot[];
}

interface ConfirmedBooking {
  id: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  service: string;
  locationMode: "mine" | "theirs";
  location: string | null;
  meetingLink: string | null;
  emailDeliveryConfigured: boolean;
}

interface BookingResponse {
  booking?: ConfirmedBooking;
  manageUrl?: string;
  error?: string;
  challengeRequired?: boolean;
  siteKey?: string | null;
}

export function UnverifiedBookingPage({
  ownerName,
  serviceLine,
}: {
  ownerName: string;
  serviceLine: string;
}) {
  return (
    <div className="mx-auto flex justify-center px-0 pt-0 sm:px-6 sm:pt-9">
      <CardShell ownerName={ownerName} serviceLine={serviceLine}>
        <div className="px-[26px] py-[42px] text-center">
          <h1 className="font-serif text-[20px] leading-[1.4] text-ink">
            This booking page isn&apos;t live yet.
          </h1>
          <p className="mx-auto mt-2 max-w-[32ch] font-sans text-[13.5px] leading-[1.6] text-body">
            The owner needs to verify their email before anyone can book.
          </p>
        </div>
      </CardShell>
    </div>
  );
}

export function CalendarDownloadLinks({ event }: { event: CalendarEvent }) {
  return (
    <div
      className="mt-4 flex flex-wrap items-center justify-center gap-x-1 font-sans text-[12.5px] text-body"
      aria-label="Add to calendar"
    >
      <span>Add to calendar:</span>
      <a
        href={googleCalendarUrl(event)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-[44px] items-center px-2 font-semibold text-bronze-ink"
      >
        Google
      </a>
      <a
        href={outlookCalendarUrl(event)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-[44px] items-center px-2 font-semibold text-bronze-ink"
      >
        Outlook
      </a>
      <a
        href={icsDataUri(event)}
        download="booking.ics"
        className="inline-flex min-h-[44px] items-center px-2 font-semibold text-bronze-ink"
      >
        .ics file
      </a>
    </div>
  );
}

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: "light";
      size: "flexible";
      action: "booking";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Public booking flow (booktimewith.link/handle). Slots come from /api/slots
 * (availability − bookings − away, all rules server-side); confirm POSTs to
 * /api/bookings, where the unique index turns a race into the friendly 409.
 */
export function BookingFlow() {
  const { config: cfg, ready, error: configError, retry: retryConfig } = usePublishedConfig();
  const ownerName = cfg.name.trim() || cfg.handle || "";
  const ownerFirst = ownerName.split(/[ ,]/)[0] || "The owner";
  const service = cfg.service.trim() || "Session";
  const needsAddress = cfg.location === "theirs";

  const [step, setStep] = useState<Step>("pick");
  const [days, setDays] = useState<ApiDay[] | null>(null); // null = loading
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState(-1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [conflict, setConflict] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challengeSiteKey, setChallengeSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const [challengeUnavailable, setChallengeUnavailable] = useState(false);
  const requestKey = useRef<string | null>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<Step>(step);
  const [booked, setBooked] = useState<{
    id: string;
    start: Date;
    end: Date;
    durationMinutes: number;
    service: string;
    locationMode: "mine" | "theirs";
    label: string;
    dayFull: string;
    location: string | null;
    meetingLink: string | null;
    emailDeliveryConfigured: boolean;
    manageUrl: string;
  } | null>(null);
  const serviceLine = `${booked?.service ?? service} · ${fmtDuration(
    booked?.durationMinutes ?? cfg.duration,
  )}`;

  const loadSlots = useCallback(async () => {
    setDays(null);
    setSlotError(null);
    try {
      const params = new URLSearchParams({ tz: clientZone() });
      const pathHandle = window.location.pathname.split("/").filter(Boolean)[0];
      if (cfg.handle || pathHandle) params.set("handle", cfg.handle || pathHandle);
      const res = await fetch(`/api/slots?${params.toString()}`);
      const data = (await res.json()) as { days?: ApiDay[]; error?: string };
      if (!res.ok || !Array.isArray(data.days)) {
        throw new Error(data.error ?? "Availability couldn't load.");
      }
      setDays(data.days);
    } catch {
      setDays([]);
      setSlotError("Availability couldn't load. Check your connection and try again.");
    }
  }, [cfg.handle]);
  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  const currentDay = days?.[day];
  const hasSlot = slot >= 0 && !!currentDay?.slots[slot];
  const picked = hasSlot ? currentDay.slots[slot] : null;
  const dayFull = currentDay?.full ?? "";
  const dayShort = currentDay ? `${currentDay.dow} ${currentDay.date}` : "";
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canConfirm = Boolean(
    name.trim() &&
      emailValid &&
      (!needsAddress || address.trim()) &&
      picked &&
      (!challengeSiteKey || turnstileToken) &&
      !submitting,
  );

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    stepHeading.current?.focus();
  }, [step]);

  const resetChallenge = useCallback(() => {
    setTurnstileToken(null);
    setChallengeUnavailable(false);
    setChallengeAttempt((attempt) => attempt + 1);
  }, []);

  const confirm = async () => {
    if (!canConfirm || !picked || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    requestKey.current ??= crypto.randomUUID();
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: cfg.handle,
          startsAt: picked.startsAt,
          clientName: name.trim(),
          clientEmail: email.trim(),
          clientTimezone: clientZone(),
          clientRequestKey: requestKey.current,
          ...(turnstileToken ? { turnstileToken } : {}),
          ...(needsAddress ? { clientAddress: address.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as BookingResponse | null;
      if (res.status === 403 && data?.challengeRequired) {
        setTurnstileToken(null);
        setChallengeUnavailable(false);
        if (data.siteKey) {
          setChallengeSiteKey(data.siteKey);
          setChallengeAttempt((attempt) => attempt + 1);
          setSubmitError("Please complete the quick anti-spam check, then confirm again.");
        } else {
          setSubmitError("The anti-spam check is temporarily unavailable. Please try again later.");
        }
        return;
      }
      if (res.status === 409 || (res.status === 422 && data?.error?.includes("time"))) {
        if (challengeSiteKey) resetChallenge();
        setConflict(true);
        setSlot(-1);
        await loadSlots();
        setStep("pick");
        return;
      }
      if (!res.ok) {
        if (challengeSiteKey) resetChallenge();
        setSubmitError(data?.error ?? "The booking couldn't be confirmed. Try again.");
        return;
      }
      if (!data?.booking) {
        setSubmitError("The booking was received, but its confirmation details couldn't load. Check your email before trying again.");
        return;
      }
      setBooked({
        id: data.booking.id,
        start: new Date(data.booking.startsAt),
        end: new Date(data.booking.endsAt),
        durationMinutes: data.booking.durationMinutes,
        service: data.booking.service,
        locationMode: data.booking.locationMode,
        label: picked.label,
        dayFull,
        location: data.booking.location,
        meetingLink: data.booking.meetingLink,
        emailDeliveryConfigured: data.booking.emailDeliveryConfigured,
        manageUrl: data.manageUrl ?? "",
      });
      requestKey.current = null;
      setChallengeSiteKey(null);
      setTurnstileToken(null);
      setChallengeUnavailable(false);
      await loadSlots();
      setStep("done");
    } catch {
      if (challengeSiteKey) resetChallenge();
      setSubmitError("The booking couldn't be sent. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const calendarEvent: CalendarEvent | null = booked
    ? {
        title: `${booked.service} with ${ownerFirst}`,
        start: booked.start,
        end: booked.end,
        description: booked.meetingLink
          ? `Booked at booktimewith.link/${cfg.handle}\nJoin online: ${booked.meetingLink}`
          : `Booked at booktimewith.link/${cfg.handle}`,
        location: booked.location ?? undefined,
        url: booked.meetingLink ?? undefined,
        uid: `${booked.id}@booktimewith.com`,
      }
    : null;

  if (!ready) {
    return (
      <div className="mx-auto flex justify-center px-0 pt-0 sm:px-6 sm:pt-9">
        <div
          role="status"
          className="w-full max-w-[420px] bg-white px-[26px] py-16 text-center font-sans text-[13.5px] text-body sm:rounded-card-lg sm:border sm:border-line-soft sm:shadow-float"
        >
          Loading this booking page…
        </div>
      </div>
    );
  }

  if (configError) {
    return (
      <div className="mx-auto flex justify-center px-6 pt-16">
        <div role="alert" className="w-full max-w-[420px] rounded-card-lg border border-line-soft bg-white p-8 text-center shadow-float">
          <h1 className="font-serif text-[24px] tracking-[-.01em]">This page couldn&apos;t load.</h1>
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

  // A claimed-but-unfinished setup has nothing to book yet.
  if (!cfg.setupComplete) {
    return (
      <div className="mx-auto flex justify-center px-6 pt-16">
        <div className="w-full max-w-[420px] rounded-card-lg border border-line-soft bg-white p-8 text-center shadow-float">
          <h1 className="font-serif text-[24px] tracking-[-.01em]">Nothing here yet.</h1>
          <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
            This link hasn&apos;t finished setting up. If it&apos;s yours, finish
            claiming it at booktimewith.com.
          </p>
        </div>
      </div>
    );
  }

  // Unverified pages are unpublished, not simply empty. Say why so an owner
  // previewing their link knows the next action and does not blame availability.
  if (cfg.paused) {
    const unverified = cfg.entitlementReason === "email_unverified";
    if (unverified) {
      return <UnverifiedBookingPage ownerName={ownerName} serviceLine={serviceLine} />;
    }
    return (
      <div className="mx-auto flex justify-center px-0 pt-0 sm:px-6 sm:pt-9">
        <CardShell ownerName={ownerName} serviceLine={serviceLine}>
          <div className="px-[26px] py-[42px] text-center">
            <h1 className="font-serif text-[20px] leading-[1.4] text-ink">
              {ownerFirst} isn&apos;t taking bookings right now.
            </h1>
          </div>
        </CardShell>
      </div>
    );
  }

  return (
    <div className="mx-auto flex justify-center px-0 pt-0 sm:px-6 sm:pt-9">
      <CardShell ownerName={ownerName} serviceLine={serviceLine}>
        <h1 ref={stepHeading} tabIndex={-1} className="sr-only">
          {step === "pick"
            ? `Choose a time for ${service} with ${ownerFirst}`
            : step === "details"
              ? "Enter your booking details"
              : "Booking confirmed"}
        </h1>
        {step === "pick" && (
          <div className="px-[26px] pb-[26px] pt-5">
            {conflict && (
              <div role="alert" className="mb-4 rounded-chip border border-line-soft bg-tint-warm px-[15px] py-[11px] font-sans text-[12.5px] text-body">
                That time just went — here&apos;s what&apos;s still open.
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
                <button
                  type="button"
                  onClick={() => void loadSlots()}
                  className="mt-3 min-h-[44px] rounded-input px-4 font-semibold text-bronze-ink"
                >
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
                <DayTabs
                  days={days}
                  selected={day}
                  onPick={(i) => { setDay(i); setSlot(-1); setSubmitError(null); requestKey.current = null; }}
                />
                <div className="mt-[18px]">
                  <SlotGrid
                    slots={currentDay?.slots.map((s) => s.label) ?? []}
                    selected={slot}
                    onPick={(i) => {
                      if (i !== slot) requestKey.current = null;
                      setSlot(i);
                      setConflict(false);
                      setSubmitError(null);
                    }}
                  />
                </div>
                <div className="mt-[10px] text-center font-sans text-[11px] text-body">
                  Times in {zoneLabel(clientZone(), picked ? new Date(picked.startsAt) : new Date())}
                </div>
                <button
                  type="button"
                  disabled={!hasSlot}
                  onClick={() => { if (hasSlot) { setSubmitError(null); setStep("details"); } }}
                  className="sticky bottom-3 z-10 mt-[14px] w-full rounded-chip py-[13px] text-center font-sans text-[14px] font-semibold text-paper sm:static"
                  style={{ background: hasSlot ? T.bronzeHover : T.disabled }}
                >
                  {hasSlot ? `Book ${dayShort} at ${picked?.label} →` : "Pick a time"}
                </button>
              </>
            )}
            <div className="mt-[10px] text-center font-sans text-[11.5px] text-faint">
              No account needed. Ever.
            </div>
          </div>
        )}

        {step === "details" && (
          <div className="px-[26px] pb-[26px] pt-5">
            <div className="rounded-chip border border-hairline bg-paper px-4 py-3 font-sans text-[13px] text-body">
              {service} · {dayFull} at {picked?.label}
              <button
                type="button"
                onClick={() => setStep("pick")}
                className="ml-[6px] inline-flex min-h-[44px] items-center px-1 font-semibold text-bronze-ink"
              >
                change
              </button>
            </div>

            <Field
              label="Your name"
              value={name}
              onChange={(value) => {
                setName(value);
                requestKey.current = null;
              }}
              placeholder="Alex Martin"
              autoComplete="name"
            />
            <Field
              label="Email"
              value={email}
              onChange={(value) => {
                setEmail(value);
                setSubmitError(null);
                requestKey.current = null;
              }}
              placeholder="alex@example.com"
              type="email"
              autoComplete="email"
              error={email.trim() && !emailValid ? "Enter a complete email address." : undefined}
            />
            {needsAddress && (
              <Field
                label="Your address"
                value={address}
                onChange={(value) => {
                  setAddress(value);
                  requestKey.current = null;
                }}
                placeholder={`Where should ${ownerFirst} come?`}
                autoComplete="street-address"
              />
            )}

            {submitError && (
              <div role="alert" className="mt-4 rounded-chip border border-line-soft bg-tint-warm px-4 py-3 font-sans text-[12.5px] text-body">
                {submitError}
              </div>
            )}
            {challengeSiteKey && (
              <TurnstileChallenge
                key={challengeAttempt}
                siteKey={challengeSiteKey}
                onToken={(token) => {
                  setTurnstileToken(token);
                  setChallengeUnavailable(false);
                  setSubmitError(null);
                }}
                onUnavailable={() => {
                  setTurnstileToken(null);
                  setChallengeUnavailable(true);
                  setSubmitError("The anti-spam check couldn't load. Check your connection and try again.");
                }}
              />
            )}
            {challengeSiteKey && challengeUnavailable && (
              <button
                type="button"
                onClick={resetChallenge}
                className="mt-2 min-h-[44px] px-3 font-sans text-[12px] font-semibold text-bronze-ink"
              >
                Reload anti-spam check
              </button>
            )}
            <button
              type="button"
              disabled={!canConfirm || submitting}
              onClick={() => void confirm()}
              aria-busy={submitting}
              className="sticky bottom-3 z-10 mt-5 w-full rounded-chip py-[13px] text-center font-sans text-[14px] font-semibold text-paper sm:static"
              style={{ background: canConfirm && !submitting ? T.ink : T.disabled }}
            >
              {submitting ? "Confirming…" : "Confirm booking"}
            </button>
            <div className="mt-[10px] text-center font-sans text-[11.5px] text-body">
              {needsAddress ? "Three fields. That’s the whole form." : "Two fields. That’s the whole form."}
            </div>
          </div>
        )}

        {step === "done" && booked && (
          <div className="px-[26px] py-[34px] text-center">
            <StatusBadge variant="done" />
            <h2 className="mt-[18px] font-serif text-[24px] tracking-[-.01em]">Booked.</h2>
            <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
              {booked.service} with {ownerFirst} · {booked.dayFull} at {booked.label}.
            </p>
            <p className="mt-[6px] font-sans text-[13px] text-body">
              {booked.locationMode === "theirs"
                ? `${ownerFirst} comes to you: ${booked.location || address.trim() || "your address"}`
                : booked.location
                  ? `At ${booked.location}.`
                  : "The location is in your confirmation."}
            </p>
            {booked.meetingLink && (
              <p className="mt-[6px] font-sans text-[13px] text-body">
                <a
                  href={booked.meetingLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[44px] items-center font-semibold text-bronze-ink"
                >
                  Open meeting link
                </a>
              </p>
            )}
            {booked.emailDeliveryConfigured ? (
              <p className="mt-[6px] font-sans text-[12px] text-body">
                Your confirmation is queued for {email.trim() || "your inbox"}. A
                reminder will follow before the appointment.
              </p>
            ) : (
              <p role="status" className="mt-[6px] font-sans text-[12px] text-body">
                Your booking is saved, but this site has not configured email delivery.
                Keep the details above and the manage link below for your records.
              </p>
            )}
            {booked.manageUrl && (
              <p className="mt-3 font-sans text-[12.5px] text-body">
                <a
                  href={booked.manageUrl}
                  className="inline-flex min-h-[44px] items-center font-semibold text-bronze-ink"
                >
                  Manage or cancel this booking
                </a>
              </p>
            )}
            {calendarEvent && <CalendarDownloadLinks event={calendarEvent} />}
            <button
              type="button"
              onClick={() => { setStep("pick"); setSlot(-1); setBooked(null); }}
              className="mt-[22px] min-h-[44px] px-3 font-sans text-[12.5px] font-semibold text-bronze-ink"
            >
              Book another time
            </button>
          </div>
        )}
      </CardShell>
    </div>
  );
}

function TurnstileChallenge({
  siteKey,
  onToken,
  onUnavailable,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  onUnavailable: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  const onUnavailableRef = useRef(onUnavailable);

  useEffect(() => {
    onTokenRef.current = onToken;
    onUnavailableRef.current = onUnavailable;
  }, [onToken, onUnavailable]);

  useEffect(() => {
    let disposed = false;
    let widgetId: string | null = null;
    let script = document.querySelector<HTMLScriptElement>(
      "script[data-booktimewith-turnstile]",
    );

    const render = () => {
      if (disposed || widgetId || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: "light",
        size: "flexible",
        action: "booking",
        callback: (token) => onTokenRef.current(token),
        "error-callback": () => onUnavailableRef.current(),
        "expired-callback": () => onUnavailableRef.current(),
      });
    };
    const scriptError = () => {
      script?.remove();
      onUnavailableRef.current();
    };

    if (window.turnstile) {
      render();
    } else {
      if (!script) {
        script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.booktimewithTurnstile = "true";
        document.head.appendChild(script);
      }
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", scriptError, { once: true });
    }

    return () => {
      disposed = true;
      script?.removeEventListener("load", render);
      script?.removeEventListener("error", scriptError);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey]);

  return (
    <div className="mt-4" aria-label="Anti-spam verification">
      <div ref={container} className="min-h-[65px] w-full" />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  autoComplete?: string;
  error?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-2 mt-[14px] block font-sans text-[11.5px] font-semibold uppercase tracking-label text-body">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className="w-full rounded-chip border border-line px-[15px] py-[13px] font-medium text-ink outline-none"
        style={{ fontSize: 16 }}
      />
      {error && <p id={errorId} className="mt-2 font-sans text-[11.5px] text-body">{error}</p>}
    </div>
  );
}
