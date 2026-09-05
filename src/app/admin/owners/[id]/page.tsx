"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { SectionLabel } from "@/components/ui";

interface OwnerDetail {
  id: string;
  email: string;
  pendingEmail: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  name: string;
  handle: string;
  publicUrl: string;
  timezone: string;
  currency: string;
  planStatus: string;
  trialEndsAt: string | null;
  accessEndsAt: string | null;
  graceUntil: string | null;
  hasStripe: boolean;
  hasSubscription: boolean;
  stripeCustomerIdTruncated: string | null;
  stripeSubscriptionIdTruncated: string | null;
  setupComplete: boolean;
  setupCompletedAt: string | null;
  createdAt: string;
  notifyOnChange: boolean;
  notifyMorningSummary: boolean;
}

interface ServiceDetail {
  name: string;
  durationMinutes: number;
  locationMode: string;
  hasOwnerAddress: boolean;
  hasMeetingLink: boolean;
}

interface CalendarDetail {
  provider: string;
  syncStatus: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  connectedAt: string;
}

interface BookingStats {
  total: number;
  confirmed: number;
  cancelled: number;
  moved: number;
}

interface RecentBooking {
  id: string;
  startsAt: string;
  status: string;
  clientName: string;
  createdAt: string;
}

interface OwnerDetailResponse {
  owner: OwnerDetail;
  service: ServiceDetail | null;
  calendar: CalendarDetail | null;
  bookingStats: BookingStats;
  recentBookings: RecentBooking[];
  availabilitySlots: number;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <SectionLabel className="mb-1">{label}</SectionLabel>
      <div className="font-sans text-[13px] text-ink">{value ?? "-"}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-bronze text-paper",
    trialing: "bg-tint-warm text-bronze-ink",
    past_due: "bg-line-soft text-body",
    paused: "bg-line-soft text-body",
    cancelled: "bg-line-soft text-faint",
  };
  return (
    <span
      className={`inline-block rounded-[4px] px-[6px] py-[2px] font-sans text-[10px] font-semibold uppercase tracking-wide ${colors[status] ?? "bg-line-soft text-body"}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

export default function OwnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<OwnerDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/owners/${id}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "Failed to load owner");
        }
        const json = (await res.json()) as OwnerDetailResponse;
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load owner");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [id]);

  if (loading) {
    return (
      <div className="mt-9">
        <Link href="/admin" className="font-sans text-[13px] text-bronze-ink hover:underline">
          ← Back to directory
        </Link>
        <div className="mt-6 rounded-card border border-line-soft bg-white px-6 py-12 text-center shadow-card">
          <p className="font-sans text-[13px] text-body">Loading owner details...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mt-9">
        <Link href="/admin" className="font-sans text-[13px] text-bronze-ink hover:underline">
          ← Back to directory
        </Link>
        <div className="mt-6 rounded-card border border-line-soft bg-white px-6 py-12 text-center shadow-card">
          <p className="font-sans text-[13px] text-body">{error ?? "Owner not found"}</p>
        </div>
      </div>
    );
  }

  const { owner, service, calendar, bookingStats, recentBookings, availabilitySlots } = data;

  return (
    <div className="mt-9">
      <Link href="/admin" className="font-sans text-[13px] text-bronze-ink hover:underline">
        ← Back to directory
      </Link>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-[28px] tracking-[-.01em]">{owner.handle}</h1>
          <p className="mt-1 font-sans text-[15px] text-body">{owner.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={owner.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="min-h-[40px] rounded-input border border-line bg-white px-4 font-sans text-[12px] font-semibold text-ink hover:bg-tint-warm"
          >
            Open public page
          </a>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-card border border-line-soft bg-white p-6 shadow-card">
          <h2 className="mb-4 font-serif text-[18px]">Account</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" value={owner.email} />
            <Field
              label="Email verified"
              value={owner.emailVerified ? `Yes, ${formatDate(owner.emailVerifiedAt!)}` : "No"}
            />
            {owner.pendingEmail && <Field label="Pending email" value={owner.pendingEmail} />}
            <Field label="Timezone" value={owner.timezone} />
            <Field label="Currency" value={owner.currency} />
            <Field label="Created" value={formatDateTime(owner.createdAt)} />
            <Field
              label="Setup complete"
              value={owner.setupComplete ? `Yes, ${formatDate(owner.setupCompletedAt!)}` : "No"}
            />
            <Field
              label="Notifications"
              value={[
                owner.notifyOnChange ? "Bookings" : null,
                owner.notifyMorningSummary ? "Morning summary" : null,
              ]
                .filter(Boolean)
                .join(", ") || "None"}
            />
          </div>
        </div>

        <div className="rounded-card border border-line-soft bg-white p-6 shadow-card">
          <h2 className="mb-4 font-serif text-[18px]">Billing</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Plan status"
              value={<StatusBadge status={owner.planStatus} />}
            />
            {owner.trialEndsAt && (
              <Field label="Trial ends" value={formatDate(owner.trialEndsAt)} />
            )}
            {owner.accessEndsAt && (
              <Field label="Access ends" value={formatDate(owner.accessEndsAt)} />
            )}
            {owner.graceUntil && (
              <Field label="Grace until" value={formatDate(owner.graceUntil)} />
            )}
            <Field
              label="Stripe"
              value={
                owner.hasStripe
                  ? `Customer: ${owner.stripeCustomerIdTruncated}`
                  : "Not connected"
              }
            />
            <Field
              label="Subscription"
              value={
                owner.hasSubscription
                  ? owner.stripeSubscriptionIdTruncated
                  : "None"
              }
            />
          </div>
        </div>

        <div className="rounded-card border border-line-soft bg-white p-6 shadow-card">
          <h2 className="mb-4 font-serif text-[18px]">Service</h2>
          {service ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" value={service.name} />
              <Field label="Duration" value={`${service.durationMinutes} min`} />
              <Field
                label="Location"
                value={
                  service.locationMode === "mine"
                    ? "Client comes to owner"
                    : service.locationMode === "theirs"
                      ? "Owner goes to client"
                      : "Virtual"
                }
              />
              <Field label="Availability slots" value={availabilitySlots} />
              {service.locationMode === "mine" && (
                <Field
                  label="Address configured"
                  value={service.hasOwnerAddress ? "Yes" : "No"}
                />
              )}
              {service.locationMode === "virtual" && (
                <Field
                  label="Meeting link"
                  value={service.hasMeetingLink ? "Yes" : "Not set"}
                />
              )}
            </div>
          ) : (
            <p className="font-sans text-[13px] text-body">No service configured.</p>
          )}
        </div>

        <div className="rounded-card border border-line-soft bg-white p-6 shadow-card">
          <h2 className="mb-4 font-serif text-[18px]">Calendar</h2>
          {calendar ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Provider" value={calendar.provider} />
              <Field label="Sync status" value={calendar.syncStatus} />
              <Field
                label="Last synced"
                value={calendar.lastSyncedAt ? formatDateTime(calendar.lastSyncedAt) : "Never"}
              />
              <Field label="Connected" value={formatDateTime(calendar.connectedAt)} />
              {calendar.lastError && (
                <div className="col-span-2">
                  <Field label="Last error" value={calendar.lastError} />
                </div>
              )}
            </div>
          ) : (
            <p className="font-sans text-[13px] text-body">No calendar connected.</p>
          )}
        </div>

        <div className="rounded-card border border-line-soft bg-white p-6 shadow-card lg:col-span-2">
          <h2 className="mb-4 font-serif text-[18px]">Bookings</h2>
          <div className="mb-4 grid gap-4 sm:grid-cols-4">
            <Field label="Total" value={bookingStats.total} />
            <Field label="Confirmed" value={bookingStats.confirmed} />
            <Field label="Cancelled" value={bookingStats.cancelled} />
            <Field label="Moved" value={bookingStats.moved} />
          </div>

          {recentBookings.length > 0 && (
            <>
              <SectionLabel className="mb-2 mt-6">Recent bookings</SectionLabel>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className="px-3 py-2 font-sans text-[11px] font-semibold uppercase tracking-label text-body">
                        Client
                      </th>
                      <th className="px-3 py-2 font-sans text-[11px] font-semibold uppercase tracking-label text-body">
                        Scheduled
                      </th>
                      <th className="px-3 py-2 font-sans text-[11px] font-semibold uppercase tracking-label text-body">
                        Status
                      </th>
                      <th className="px-3 py-2 font-sans text-[11px] font-semibold uppercase tracking-label text-body">
                        Booked
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentBookings.map((booking) => (
                      <tr key={booking.id} className="border-b border-hairline last:border-0">
                        <td className="px-3 py-2 font-sans text-[12px] text-ink">
                          {booking.clientName}
                        </td>
                        <td className="px-3 py-2 font-sans text-[12px] text-body">
                          {formatDateTime(booking.startsAt)}
                        </td>
                        <td className="px-3 py-2 font-sans text-[11px] text-body">
                          {booking.status}
                        </td>
                        <td className="px-3 py-2 font-sans text-[12px] text-body">
                          {formatDate(booking.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
