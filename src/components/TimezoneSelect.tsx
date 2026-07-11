"use client";

import { useEffect, useId, useState } from "react";

const FALLBACK_ZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Asia/Singapore",
  "Asia/Dubai",
  "Asia/Kolkata",
] as const;

type IntlWithTimeZones = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function TimezoneSelect({
  value,
  onChange,
  label = "Timezone",
  description = "Your painted hours and owner reminders use this timezone.",
  className = "",
}: {
  value: string;
  onChange: (timezone: string) => void;
  label?: string;
  description?: string;
  className?: string;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const [zones, setZones] = useState<string[]>([value]);

  useEffect(() => {
    const detected = browserTimeZone();
    const supported = (Intl as IntlWithTimeZones).supportedValuesOf?.("timeZone") ?? [
      ...FALLBACK_ZONES,
    ];
    setZones(
      [...new Set([value, detected, ...supported].filter((zone): zone is string => Boolean(zone)))].sort(),
    );
  }, [value]);

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block font-sans text-[11.5px] font-semibold uppercase tracking-label text-body"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={descriptionId}
        className="mt-2 min-h-[44px] w-full max-w-[420px] rounded-chip border border-line bg-white px-3 font-sans text-[14px] font-medium text-ink"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replaceAll("_", " ")}
          </option>
        ))}
      </select>
      <p id={descriptionId} className="mt-2 font-sans text-[11.5px] leading-[1.5] text-body">
        {description}
      </p>
    </div>
  );
}
