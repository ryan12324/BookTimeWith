/**
 * Calendar-event helpers: a minimal .ics builder (attached to confirmation
 * emails and downloadable from the booked screen) plus the Google / Outlook
 * "add to calendar" deep links the README requires on the booked screen.
 */

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  url?: string;
  uid?: string;
}

/** 2026-07-14T09:00:00Z → "20260714T090000Z" */
function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildIcs(ev: CalendarEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//booktimewith.com//booking//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid ?? `${icsStamp(ev.start)}@booktimewith.com`}`,
    `DTSTAMP:${icsStamp(new Date(ev.start))}`,
    `DTSTART:${icsStamp(ev.start)}`,
    `DTEND:${icsStamp(ev.end)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    ...(ev.description ? [`DESCRIPTION:${icsEscape(ev.description)}`] : []),
    ...(ev.location ? [`LOCATION:${icsEscape(ev.location)}`] : []),
    ...(ev.url ? [`URL:${ev.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/** Data URI for a client-side .ics download (the booked screen). */
export function icsDataUri(ev: CalendarEvent): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(buildIcs(ev))}`;
}

export function googleCalendarUrl(ev: CalendarEvent): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${icsStamp(ev.start)}/${icsStamp(ev.end)}`,
  });
  if (ev.description) p.set("details", ev.description);
  if (ev.location) p.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function outlookCalendarUrl(ev: CalendarEvent): string {
  const p = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: ev.title,
    startdt: ev.start.toISOString(),
    enddt: ev.end.toISOString(),
  });
  if (ev.description) p.set("body", ev.description);
  if (ev.location) p.set("location", ev.location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p.toString()}`;
}
