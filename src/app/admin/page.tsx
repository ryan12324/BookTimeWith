"use client";

import { useCallback, useEffect, useState, useId } from "react";
import Link from "next/link";

interface Owner {
  id: string;
  email: string;
  pendingEmail: string | null;
  emailVerified: boolean;
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
  setupComplete: boolean;
  setupCompletedAt: string | null;
  createdAt: string;
  serviceName: string | null;
  serviceDuration: number | null;
  serviceLocation: string | null;
  calendarConnected: boolean;
  calendarProvider: string | null;
  calendarSyncStatus: string | null;
  bookingCount: number;
}

interface OwnersResponse {
  owners: Owner[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 50;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function PlanBadge({ status }: { status: string }) {
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="ml-1 rounded px-1 font-sans text-[10px] text-bronze-ink hover:bg-tint-warm"
      title="Copy link"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function AdminPage() {
  const searchId = useId();
  const [data, setData] = useState<OwnersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("q", debouncedQuery);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      const res = await fetch(`/api/admin/owners?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to load owners");
      }
      const json = (await res.json()) as OwnersResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load owners");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="mt-9">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-[28px] tracking-[-.01em]">Owner directory</h1>
          <p className="mt-1 font-sans text-[13px] text-body">
            All booking links across the system.
          </p>
        </div>
        <div className="font-sans text-[13px] text-body">
          {data && !loading ? `${data.total} owner${data.total === 1 ? "" : "s"}` : "Loading..."}
        </div>
      </div>

      <div className="mt-6">
        <label htmlFor={searchId} className="sr-only">
          Search by handle or email
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by handle or email..."
          className="w-full max-w-md rounded-input border border-line bg-white px-4 py-3 font-sans text-[14px] text-ink placeholder:text-faint focus:border-bronze focus:outline-none"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-card border border-line-soft bg-white px-6 py-8 text-center font-sans text-[13.5px] leading-[1.6] text-body shadow-card"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 min-h-[44px] rounded-input px-4 font-semibold text-bronze-ink"
          >
            Try again
          </button>
        </div>
      )}

      {!error && (
        <div className="mt-6 overflow-x-auto rounded-card border border-line-soft bg-white shadow-card">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-hairline">
                <th className="px-4 py-3 font-sans text-[11.5px] font-semibold uppercase tracking-label text-body">
                  Handle
                </th>
                <th className="px-4 py-3 font-sans text-[11.5px] font-semibold uppercase tracking-label text-body">
                  Email
                </th>
                <th className="px-4 py-3 font-sans text-[11.5px] font-semibold uppercase tracking-label text-body">
                  Plan
                </th>
                <th className="px-4 py-3 font-sans text-[11.5px] font-semibold uppercase tracking-label text-body">
                  Bookings
                </th>
                <th className="px-4 py-3 font-sans text-[11.5px] font-semibold uppercase tracking-label text-body">
                  Created
                </th>
                <th className="px-4 py-3 font-sans text-[11.5px] font-semibold uppercase tracking-label text-body">
                  Status
                </th>
                <th className="px-4 py-3 font-sans text-[11.5px] font-semibold uppercase tracking-label text-body">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center font-sans text-[13px] text-body">
                    Loading owners...
                  </td>
                </tr>
              )}
              {data?.owners.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center font-sans text-[13px] text-body">
                    {debouncedQuery ? "No owners match your search." : "No owners yet."}
                  </td>
                </tr>
              )}
              {data?.owners.map((owner) => (
                <tr key={owner.id} className="border-b border-hairline last:border-0 hover:bg-tint-warm/50">
                  <td className="px-4 py-3">
                    <div className="font-sans text-[13px] font-semibold text-ink">
                      {owner.handle}
                    </div>
                    <div className="mt-0.5 font-sans text-[11px] text-body">
                      {owner.name}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-sans text-[12px] text-ink">{owner.email}</div>
                    <div className="mt-0.5 flex items-center gap-1 font-sans text-[11px]">
                      {owner.emailVerified ? (
                        <span className="text-bronze-ink">Verified</span>
                      ) : (
                        <span className="text-faint">Unverified</span>
                      )}
                      {owner.calendarConnected && (
                        <span className="text-body">
                          · {owner.calendarProvider ?? "Calendar"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <PlanBadge status={owner.planStatus} />
                    {owner.hasStripe && (
                      <div className="mt-1 font-sans text-[10px] text-faint">
                        Stripe
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-sans text-[13px] font-semibold text-ink">
                      {owner.bookingCount}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-sans text-[12px] text-body">
                      {formatDate(owner.createdAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {owner.setupComplete ? (
                      <span className="font-sans text-[11px] text-bronze-ink">Live</span>
                    ) : (
                      <span className="font-sans text-[11px] text-faint">Setup incomplete</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <a
                        href={owner.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-sans text-[11px] font-semibold text-bronze-ink hover:underline"
                      >
                        Open
                      </a>
                      <CopyButton text={owner.publicUrl} />
                      <Link
                        href={`/admin/owners/${owner.id}`}
                        className="font-sans text-[11px] font-semibold text-body hover:text-ink"
                      >
                        Details
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="font-sans text-[12px] text-body">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="min-h-[36px] rounded-input border border-line bg-white px-4 font-sans text-[12px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= data.total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="min-h-[36px] rounded-input border border-line bg-white px-4 font-sans text-[12px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
