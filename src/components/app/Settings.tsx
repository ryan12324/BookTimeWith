"use client";

import { useEffect, useId, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { useOwnerConfig } from "@/lib/store";
import { DurationStepper } from "@/components/DurationStepper";
import { AvailabilityGrid, useGridControls } from "@/components/AvailabilityGrid";
import { Toggle, ToggleRow } from "@/components/Toggle";
import { SectionLabel } from "@/components/ui";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { T } from "@/lib/tokens";
import { CURRENCY_ORDER, PRICES, type CurrencyCode } from "@/lib/format";
import { useHandleCheck } from "@/lib/use-handle-check";

const PROVIDERS = [
  { key: "google", name: "Google Calendar", dot: "#4285f4" },
  { key: "outlook", name: "Outlook", dot: "#0f6cbd" },
];

type HorizonUnit = "days" | "weeks" | "months";

const HORIZON_UNITS: Record<HorizonUnit, { days: number; max: number }> = {
  days: { days: 1, max: 730 },
  weeks: { days: 7, max: 104 },
  months: { days: 30, max: 24 },
};

function horizonParts(days: number): { amount: number; unit: HorizonUnit } {
  if (days % 30 === 0) return { amount: days / 30, unit: "months" };
  if (days % 7 === 0) return { amount: days / 7, unit: "weeks" };
  return { amount: days, unit: "days" };
}

function BookingHorizon({
  days,
  onChange,
}: {
  days: number;
  onChange: (days: number) => void;
}) {
  const parts = horizonParts(days);
  const [unit, setUnit] = useState<HorizonUnit>(parts.unit);
  const [amount, setAmount] = useState(String(parts.amount));

  useEffect(() => {
    const next = horizonParts(days);
    setUnit(next.unit);
    setAmount(String(next.amount));
  }, [days]);

  const commit = (nextAmount: string, nextUnit = unit) => {
    const value = Number(nextAmount);
    if (!Number.isInteger(value) || value < 1) {
      const current = horizonParts(days);
      setUnit(current.unit);
      setAmount(String(current.amount));
      return;
    }
    const rule = HORIZON_UNITS[nextUnit];
    const clamped = Math.min(value, rule.max);
    setAmount(String(clamped));
    onChange(clamped * rule.days);
  };

  return (
    <div className="mt-4 max-w-[420px]">
      <label
        htmlFor="settings-booking-horizon"
        className="block font-sans text-[12.5px] font-semibold text-ink"
      >
        How far ahead people can book
      </label>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(120px,0.8fr)] gap-2">
        <input
          id="settings-booking-horizon"
          type="number"
          inputMode="numeric"
          min={1}
          max={HORIZON_UNITS[unit].max}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onBlur={() => commit(amount)}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
          className="min-h-[44px] min-w-0 rounded-chip border border-line px-[15px] font-sans text-[16px] font-medium text-ink outline-none"
        />
        <select
          aria-label="Booking window unit"
          value={unit}
          onChange={(event) => {
            const nextUnit = event.target.value as HorizonUnit;
            setUnit(nextUnit);
            commit(amount, nextUnit);
          }}
          className="min-h-[44px] min-w-0 rounded-chip border border-line bg-white px-[12px] font-sans text-[16px] font-medium text-ink outline-none"
        >
          <option value="days">days</option>
          <option value="weeks">weeks</option>
          <option value="months">months</option>
        </select>
      </div>
      <p className="mt-1.5 font-sans text-[11.5px] leading-[1.5] text-body">
        Times beyond this window stay hidden. A month is counted as 30 days.
      </p>
    </div>
  );
}

/** "£6 a month · free trial ends 3 August" — the plan line, from real state. */
export function PlanSection({
  planStatus,
  trialEndsAt,
  graceUntil,
  currency,
  billingCurrencyLocked,
  timezone,
  onCurrencyChange,
}: {
  planStatus: string;
  trialEndsAt: string | null;
  graceUntil: string | null;
  currency: CurrencyCode;
  billingCurrencyLocked: boolean;
  timezone: string;
  onCurrencyChange: (currency: CurrencyCode) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const currencyNoteId = useId();
  const day = (iso: string | null) =>
    iso ? formatInTimeZone(new Date(iso), timezone, "d MMMM") : null;

  const line: Record<string, React.ReactNode> = {
    trialing: (
      <>
        {PRICES[currency]} a month ·{" "}
        <span className="text-body">
          free trial{trialEndsAt ? ` ends ${day(trialEndsAt)}` : " starts when you go live"}
        </span>
      </>
    ),
    active: <>{PRICES[currency]} a month · <span className="text-body">all good</span></>,
    past_due: (
      <>
        {PRICES[currency]} a month ·{" "}
        <span className="text-body">
          card didn&apos;t go through — your page works until {day(graceUntil) ?? "the retry window ends"}
        </span>
      </>
    ),
    paused: <span className="text-body">Paused — add a card and your page comes straight back.</span>,
    cancelled: <span className="text-body">Cancelled — bookings already made still happen.</span>,
  };

  const manageBilling = async () => {
    if (billingBusy) return;
    setBillingBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.ok && data.url) window.location.href = data.url;
      else setNote(data.error ?? "Stripe isn't connected in this environment.");
    } catch {
      setNote("Billing couldn't open. Check your connection and try again.");
    } finally {
      setBillingBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/owner", { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          data?.error ??
            "Your account wasn't deleted because connected billing could not be closed. Try again shortly.",
        );
      }
      window.location.href = "/app/setup";
    } catch (error) {
      setNote(
        error instanceof Error
          ? error.message
          : "Your account wasn't deleted. Check your connection and try again.",
      );
      setDeleteBusy(false);
    }
  };

  return (
    <section className="pb-2 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div>
          <SectionLabel>Your plan</SectionLabel>
          <div className="mt-2 font-sans text-[14px] text-ink">
            {line[planStatus] ?? line.trialing}
          </div>
        </div>
        <div>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="Plan currency"
            aria-describedby={billingCurrencyLocked ? currencyNoteId : undefined}
          >
            {CURRENCY_ORDER.map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={currency === code}
                disabled={billingCurrencyLocked}
                onClick={() => {
                  if (!billingCurrencyLocked) onCurrencyChange(code);
                }}
                className={`min-h-[44px] min-w-[44px] rounded-input px-2 font-sans text-[11px] font-semibold disabled:cursor-not-allowed ${
                  currency === code ? "bg-ink text-paper" : "text-body"
                }`}
              >
                {code}
              </button>
            ))}
          </div>
          {billingCurrencyLocked && (
            <p id={currencyNoteId} className="mt-1 max-w-[34ch] font-sans text-[11.5px] leading-[1.5] text-body">
              Currency is fixed for this Stripe subscription. Manage billing to update billing details.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4">
          <a
            href="/api/export/bookings"
            download
            className="inline-flex min-h-[44px] items-center font-sans text-[12.5px] font-semibold text-bronze-ink"
          >
            Export bookings
          </a>
          <button
            type="button"
            onClick={manageBilling}
            disabled={billingBusy || deleteBusy}
            className="min-h-[44px] font-sans text-[12.5px] font-semibold text-bronze-ink disabled:text-body"
          >
            {billingBusy
              ? "Opening billing…"
              : planStatus === "cancelled"
                ? "Restart billing"
                : "Manage billing"}
          </button>
          {!deleteConfirm && (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              disabled={billingBusy || deleteBusy}
              className="min-h-[44px] font-sans text-[12.5px] font-semibold text-body disabled:opacity-60"
            >
              Delete account
            </button>
          )}
        </div>
      </div>
      {deleteConfirm && (
        <div className="mt-4 rounded-chip border border-line bg-paper px-4 py-3 font-sans text-[12.5px] leading-[1.6] text-body">
          <p>
            Delete your link, bookings, settings, tokens, and queued email data?
            Local calendar credentials are removed and any Stripe
            customer/subscription is closed first. If billing cleanup fails,
            nothing local is deleted.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void deleteAccount()}
              disabled={deleteBusy}
              className="min-h-[44px] font-semibold text-ink disabled:opacity-60"
            >
              {deleteBusy ? "Deleting…" : "Yes, delete everything"}
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirm(false)}
              disabled={deleteBusy}
              className="min-h-[44px] font-semibold text-bronze-ink disabled:opacity-60"
            >
              Keep my account
            </button>
          </div>
        </div>
      )}
      {note && <div role="alert" className="mt-2 font-sans text-[12px] text-body">{note}</div>}
    </section>
  );
}

/**
 * The owner's notification address. Commits on blur (not per keystroke) — a
 * changed email un-verifies and triggers the one-click confirmation email.
 */
function OwnerEmail({
  email,
  pendingEmail,
  verified,
  onCommit,
  onResend,
  resendBusy,
  resendNote,
}: {
  email: string;
  pendingEmail: string | null;
  verified: boolean;
  onCommit: (email: string) => void;
  onResend: () => void;
  resendBusy: boolean;
  resendNote: string | null;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const displayedEmail = pendingEmail ?? email;
  const [draft, setDraft] = useState(displayedEmail);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setDraft(displayedEmail), [displayedEmail]);
  const commit = () => {
    const clean = draft.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      setInvalid(true);
    } else if (clean.toLowerCase() !== displayedEmail.toLowerCase()) {
      setInvalid(false);
      onCommit(clean);
    } else {
      setInvalid(false);
    }
  };

  return (
    <div className="mt-4 flex max-w-[420px] flex-wrap items-center gap-x-3 gap-y-1">
      <input
        id={id}
        type="email"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="you@example.com"
        aria-label="Where booking emails go"
        aria-invalid={invalid}
        aria-describedby={hintId}
        className="min-w-[220px] flex-1 rounded-chip border border-line px-[15px] py-[11px] font-medium text-ink outline-none"
        style={{ fontSize: 13.5 }}
      />
      <div className="min-w-0 flex-1" aria-live="polite">
        <span
          id={hintId}
          role={invalid ? "alert" : undefined}
          className="block font-sans text-[11.5px] font-semibold"
          style={{ color: verified && !pendingEmail ? T.bronzeHover : T.body }}
        >
          {invalid
            ? "Enter a complete email address."
            : pendingEmail
              ? `Confirm ${pendingEmail}. ${email} stays active until then.`
              : verified
              ? "✓ Verified"
              : resendNote ?? "Check your inbox for the confirmation link."}
        </span>
        {(!verified || pendingEmail) && !invalid && (
          <button
            type="button"
            onClick={onResend}
            disabled={resendBusy}
            className="mt-1 min-h-[44px] font-sans text-[11.5px] font-semibold text-bronze-ink disabled:text-body"
          >
            {resendBusy ? "Sending…" : "Resend confirmation"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Keep a prospective handle local until the availability endpoint approves it. */
function OwnerHandle({
  handle,
  onCommit,
}: {
  handle: string;
  onCommit: (handle: string) => void;
}) {
  const [draft, setDraft] = useState(handle);
  const [commitWhenChecked, setCommitWhenChecked] = useState(false);
  const hint = useHandleCheck(draft);
  const changed = draft !== handle;
  const syntacticallyValid = /^[a-z0-9-]{3,30}$/.test(draft);

  useEffect(() => {
    setDraft(handle);
    setCommitWhenChecked(false);
  }, [handle]);

  useEffect(() => {
    if (!commitWhenChecked || !changed) return;
    if (hint?.status === "available") {
      onCommit(draft);
      setCommitWhenChecked(false);
    } else if (hint?.status === "unavailable") {
      setCommitWhenChecked(false);
    }
  }, [changed, commitWhenChecked, draft, hint, onCommit]);

  const commit = () => {
    if (changed && syntacticallyValid && hint?.status === "available") onCommit(draft);
    else if (
      changed &&
      syntacticallyValid &&
      (!hint || hint.status === "checking")
    ) {
      setCommitWhenChecked(true);
    }
  };

  const hintText = !syntacticallyValid
    ? "Use 3–30 letters, numbers, or dashes."
    : !hint
      ? "Checking availability…"
      : hint.msg;

  return (
    <>
      <div className="focus-group flex max-w-[420px] items-center overflow-hidden rounded-chip border border-line">
        <span className="flex-none py-[13px] pl-[15px] font-sans text-[14.5px] text-body">
          booktimewith.link/
        </span>
        <input
          id="settings-handle"
          value={draft}
          onChange={(event) => {
            setCommitWhenChecked(false);
            setDraft(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            if (event.key === "Escape") {
              setDraft(handle);
              (event.target as HTMLInputElement).blur();
            }
          }}
          placeholder="yourname"
          aria-label="Your booking link handle"
          aria-describedby="settings-handle-hint"
          aria-invalid={
            changed &&
            (!syntacticallyValid || hint?.status === "unavailable")
          }
          maxLength={30}
          className="min-w-0 flex-1 border-none py-[13px] pl-[2px] pr-[15px] font-medium text-ink outline-none"
          style={{ fontSize: 14.5 }}
        />
      </div>
      <div
        id="settings-handle-hint"
        aria-live="polite"
        className="mt-2 font-sans text-[11.5px] text-body"
      >
        {hintText} {hint?.ok && changed ? "Change saves when you leave the field." : ""}
        {hint?.status === "error" && (
          <button
            type="button"
            onClick={hint.retry}
            className="ml-2 min-h-[44px] px-1 font-semibold text-bronze-ink"
          >
            Try again
          </button>
        )}
      </div>
      <div className="mt-1 font-sans text-[11.5px] text-body">
        Changing it redirects your old link for 90 days.
      </div>
    </>
  );
}

/**
 * The whole product promise: one settings page. Sections divided by hairlines,
 * autosave (changes persist to the store immediately — no Save button).
 */
export function Settings() {
  const {
    config,
    update,
    hydrated,
    loadError,
    saveState,
    saveError,
    refresh,
    retrySave,
  } = useOwnerConfig();
  const g = useGridControls();

  // outcome of a calendar connect redirect (?calendar=unconfigured|failed)
  const [calNote, setCalNote] = useState<string | null>(null);
  const [pageNote, setPageNote] = useState<string | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [retryingLoad, setRetryingLoad] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const flag = query.get("calendar");
    if (flag === "unconfigured") {
      setCalNote(
        "Calendar sync isn't configured in this environment — set the Google or Microsoft OAuth keys.",
      );
    } else if (flag === "failed") {
      setCalNote("That connection didn't complete — try again.");
    }
    if (query.get("verified") === "expired") {
      setPageNote("That email confirmation link expired. Your address is still unverified.");
    } else if (query.get("verified") === "taken") {
      setPageNote("That email now belongs to another account. Your existing address is unchanged.");
    } else if (query.get("verified") === "1") {
      setPageNote("Email confirmed.");
    } else if (query.get("billing") === "done") {
      setPageNote("Billing updated.");
    }
  }, []);

  const disconnectCalendar = async () => {
    if (calendarBusy) return;
    setCalendarBusy(true);
    setCalNote(null);
    try {
      const res = await fetch("/api/calendar/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("disconnect failed");
      await refresh();
      setCalNote(
        "Disconnected here. You can also remove the app grant in your calendar provider's security settings.",
      );
    } catch {
      setCalNote("The calendar couldn't disconnect. Check your connection and try again.");
    } finally {
      setCalendarBusy(false);
    }
  };

  const resendVerification = async () => {
    if (verifyBusy) return;
    setVerifyBusy(true);
    setVerifyNote(null);
    try {
      const res = await fetch("/api/verify-email/resend", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; alreadyVerified?: boolean }
        | null;
      if (!res.ok) {
        setVerifyNote(data?.error ?? "The confirmation email couldn't be sent. Try again.");
      } else if (data?.alreadyVerified) {
        await refresh();
        setVerifyNote("This address is already verified.");
      } else {
        setVerifyNote(
          config.emailDeliveryConfigured
            ? "Confirmation email queued. Check your inbox for a fresh link."
            : "Confirmation link saved to the outbox. Email delivery is not configured.",
        );
      }
    } catch {
      setVerifyNote("The confirmation email couldn't be sent. Check your connection.");
    } finally {
      setVerifyBusy(false);
    }
  };

  if (!hydrated || retryingLoad) {
    return (
      <div role="status" className="mx-auto mt-9 max-w-[680px] rounded-card border border-line-soft bg-white px-6 py-10 text-center font-sans text-[13.5px] text-body shadow-card">
        Loading your settings…
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="mx-auto mt-9 max-w-[680px] rounded-card border border-line-soft bg-white px-6 py-10 text-center shadow-card">
        <h1 className="font-serif text-[24px] tracking-[-.01em]">Your settings couldn&apos;t load.</h1>
        <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setRetryingLoad(true);
            void refresh().finally(() => setRetryingLoad(false));
          }}
          className="mt-3 min-h-[44px] rounded-input px-4 font-sans text-[12.5px] font-semibold text-bronze-ink"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-9 max-w-[680px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-[28px] tracking-[-.01em]">Settings</h1>
        <div className="font-sans text-[12.5px] text-body">This is all of them.</div>
      </div>
      {pageNote && (
        <div role="status" className="mt-3 rounded-chip border border-line-soft bg-white px-4 py-3 font-sans text-[12.5px] text-body">
          {pageNote}
        </div>
      )}

      <div className="mt-5 rounded-card border border-line-soft bg-white px-6 pb-8 pt-2 shadow-card md:px-9">
        {/* YOUR LINK */}
        <section className="border-b border-hairline pb-6 pt-[26px]">
          <SectionLabel className="mb-[10px]">Your link</SectionLabel>
          <OwnerHandle handle={config.handle} onCommit={(handle) => update({ handle })} />
          <SectionLabel as="label" htmlFor="settings-name" className="mb-2 mt-5 block">
            Public name
          </SectionLabel>
          <input
            id="settings-name"
            value={config.name}
            onChange={(event) => update({ name: event.target.value })}
            maxLength={120}
            autoComplete="name"
            className="w-full max-w-[420px] rounded-chip border border-line px-[15px] py-[13px] font-medium text-ink outline-none"
          />
        </section>

        {/* YOUR SERVICE */}
        <section className="border-b border-hairline py-6">
          <SectionLabel as="label" htmlFor="settings-service" className="mb-[10px] block">Your service</SectionLabel>
          <input
            id="settings-service"
            value={config.service}
            onChange={(e) => update({ service: e.target.value })}
            className="w-full max-w-[420px] rounded-chip border border-line px-[15px] py-[13px] font-medium text-ink outline-none"
            style={{ fontSize: 14.5 }}
          />
          <div className="mt-[14px] flex flex-wrap items-center gap-[14px]">
            <DurationStepper
              minutes={config.duration}
              onChange={(m) => update({ duration: m })}
              size="sm"
            />
            <div className="grid w-full flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              {(["mine", "theirs"] as const).map((key) => {
                const on = config.location === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => update({ location: key })}
                    aria-pressed={on}
                    className="min-h-[44px] rounded-input border px-[14px] py-[11px] font-sans text-[12.5px] font-semibold text-ink"
                    style={{ borderColor: on ? T.ink : T.line, background: on ? T.tintWarm : "#fff" }}
                  >
                    {key === "mine" ? "Clients come to me" : "I go to clients"}
                  </button>
                );
              })}
            </div>
          </div>
          {config.location === "mine" && (
            <div className="mt-3">
              <label htmlFor="settings-address" className="sr-only">Your address</label>
              <input
                id="settings-address"
                value={config.ownerAddress}
                onChange={(e) => update({ ownerAddress: e.target.value })}
                placeholder="Your address, e.g. 12 Harley Street, London"
                className="w-full max-w-[420px] rounded-chip border border-line px-[15px] py-3 font-medium text-ink outline-none"
                style={{ fontSize: 16 }}
              />
            </div>
          )}
          <label htmlFor="settings-meeting-link" className="sr-only">Meeting link</label>
          <input
            id="settings-meeting-link"
            type="url"
            value={config.meetingLink}
            onChange={(e) => update({ meetingLink: e.target.value })}
            placeholder="Meeting link (optional) — your Zoom/Meet URL, sent in reminders"
            aria-label="Meeting link"
            className="mt-3 w-full max-w-[420px] rounded-chip border border-line px-[15px] py-3 font-medium text-ink outline-none"
            style={{ fontSize: 13.5 }}
          />
        </section>

        {/* YOUR HOURS */}
        <section className="border-b border-hairline py-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SectionLabel>Your hours</SectionLabel>
            <div className="font-sans text-[11.5px] text-body">{g.summary}</div>
          </div>
          <TimezoneSelect
            value={config.timezone}
            onChange={(timezone) => update({ timezone })}
            className="mt-4"
          />
          <BookingHorizon
            days={config.bookingHorizonDays}
            onChange={(bookingHorizonDays) => update({ bookingHorizonDays })}
          />
          <div className="mt-[14px] flex flex-wrap items-center gap-[10px]">
            <button
              type="button"
              onClick={g.toggleWeekends}
              role="switch"
              aria-checked={g.weekends}
              className="flex min-h-[44px] items-center gap-[9px] rounded-input border px-[13px] py-2"
              style={{
                borderColor: g.weekends ? T.bronze : T.line,
                background: g.weekends ? T.tintWarm : "#fff",
              }}
            >
              <Toggle on={g.weekends} />
              <span className="font-sans text-[12px] font-semibold text-ink">We&apos;re open weekends</span>
            </button>
            <button
              type="button"
              onClick={g.startEarlier}
              disabled={!g.canEarlier}
              className="min-h-[44px] rounded-[5px] border border-dashed border-disabled px-3 font-sans text-[11.5px] font-semibold text-bronze-ink hover:bg-tint-warm disabled:text-body"
            >
              {g.earlierLabel}
            </button>
            <button
              type="button"
              onClick={g.finishLater}
              disabled={!g.canLater}
              className="min-h-[44px] rounded-[5px] border border-dashed border-disabled px-3 font-sans text-[11.5px] font-semibold text-bronze-ink hover:bg-tint-warm disabled:text-body"
            >
              {g.laterLabel}
            </button>
          </div>
          <div className="mt-[14px]">
            <AvailabilityGrid cellHeight={26} />
          </div>
        </section>

        {/* CALENDAR */}
        <section className="border-b border-hairline py-6">
          <SectionLabel className="mb-[10px]">Calendar</SectionLabel>
          {!config.calendar ? (
            <>
              <p className="mb-[14px] font-sans text-[13px] leading-[1.5] text-body">
                Connect your calendar and busy time blocks itself — both ways.
              </p>
              {calNote && (
                <p role="alert" className="mb-3 font-sans text-[12px] text-body">{calNote}</p>
              )}
              <div className="flex flex-wrap gap-[10px]">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => {
                      // Real OAuth when credentials are configured. The callback
                      // reports an honest unconfigured or failed state.
                      window.location.href = `/api/calendar/connect?provider=${p.key}`;
                    }}
                    className="flex min-h-[44px] items-center gap-[9px] rounded-input border border-line px-[18px] py-[11px] font-sans text-[13px] font-semibold text-ink hover:bg-paper"
                  >
                    <span
                      className="h-[9px] w-[9px] flex-none rounded-[2px]"
                      style={{ background: p.dot }}
                    />
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div
              className="flex flex-wrap items-center justify-between gap-[10px] rounded-[8px] border border-hairline bg-paper px-[18px] py-[14px]"
              role={config.calendarStatus === "degraded" ? "alert" : undefined}
            >
              <div className="flex min-w-0 items-start gap-[11px]">
                <span
                  className="mt-1 h-[9px] w-[9px] flex-none rounded-full"
                  style={{ background: config.calendarStatus === "degraded" ? T.body : T.bronzeHover }}
                />
                <div>
                  <div className="font-sans text-[13.5px] font-semibold text-ink">
                    {config.calendar} {config.calendarStatus === "degraded" ? "needs attention" : "connected"}
                  </div>
                  <div className="font-sans text-[12px] text-body">
                    {config.calendarStatus === "degraded"
                      ? config.calendarError ?? "Calendar sync is delayed. Reconnect to resume updates."
                      : "Busy events block booking slots · bookings appear in your calendar"}
                  </div>
                  {config.calendarLastSyncedAt && (
                    <div className="mt-1 font-sans text-[11px] text-body">
                      Last synced{" "}
                      {formatInTimeZone(
                        new Date(config.calendarLastSyncedAt),
                        config.timezone,
                        "d MMM, h:mm a",
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3">
                {config.calendarStatus === "degraded" && (
                  <button
                    type="button"
                    onClick={() => {
                      const provider = config.calendar?.toLowerCase().includes("outlook")
                        ? "outlook"
                        : "google";
                      window.location.href = `/api/calendar/connect?provider=${provider}`;
                    }}
                    className="min-h-[44px] px-2 font-sans text-[12.5px] font-semibold text-bronze-ink"
                  >
                    Reconnect
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void disconnectCalendar()}
                  disabled={calendarBusy}
                  className="min-h-[44px] px-2 font-sans text-[12.5px] font-semibold text-body hover:text-ink"
                >
                  {calendarBusy ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* EMAILS TO YOU */}
        <section className="border-b border-hairline py-6">
          <SectionLabel className="mb-[14px]">Emails to you</SectionLabel>
          {!config.emailDeliveryConfigured && (
            <div
              role="alert"
              className="mb-4 rounded-chip border border-line-soft bg-tint-warm px-4 py-3 font-sans text-[12px] leading-[1.55] text-body"
            >
              Email delivery is not configured. Bookings and changes still save,
              but sign-in links, confirmations, and notifications stay in the outbox.
            </div>
          )}
          <div className="flex flex-col gap-3">
            <ToggleRow on={config.notifyBook} onToggle={() => update({ notifyBook: !config.notifyBook })}>
              When someone books, reschedules or cancels
            </ToggleRow>
            <ToggleRow
              on={config.notifyMorning}
              onToggle={() => update({ notifyMorning: !config.notifyMorning })}
            >
              Morning summary of the day&apos;s appointments
            </ToggleRow>
          </div>
          <OwnerEmail
            email={config.activeEmail}
            pendingEmail={config.pendingEmail}
            verified={config.emailVerified}
            onCommit={(email) => update({ email })}
            onResend={() => void resendVerification()}
            resendBusy={verifyBusy}
            resendNote={verifyNote}
          />
        </section>

        {/* YOUR PLAN */}
        <PlanSection
          planStatus={config.planStatus}
          trialEndsAt={config.trialEndsAt}
          graceUntil={config.graceUntil}
          currency={config.currency}
          billingCurrencyLocked={config.billingCurrencyLocked}
          timezone={config.timezone}
          onCurrencyChange={(currency) => update({ currency })}
        />
      </div>

      {saveState === "error" ? (
        <div role="alert" className="mt-[14px] rounded-chip border border-line-soft bg-tint-warm px-4 py-3 text-center font-sans text-[12px] text-body">
          <span>{saveError ?? "Changes could not be saved."}</span>{" "}
          <button
            type="button"
            onClick={retrySave}
            className="min-h-[44px] px-2 font-semibold text-bronze-ink"
          >
            Try again
          </button>
        </div>
      ) : (
        <p role="status" aria-live="polite" className="mt-[14px] text-center font-sans text-[11.5px] text-body">
          {saveState === "saving"
            ? "Saving changes…"
            : saveState === "saved"
              ? "Changes saved."
              : "Changes save as you make them."}
        </p>
      )}
    </div>
  );
}
