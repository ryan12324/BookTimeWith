"use client";

import { useEffect, useState } from "react";

export type OutboxDelivery =
  | "pending"
  | "processing"
  | "delivered"
  | "failed"
  | "skipped"
  | "expired";

interface OutboxEmail {
  id: string;
  to: string;
  from: string;
  replyTo: string | null;
  subject: string;
  template: string;
  createdAt: string;
  html: string;
  attachments: { filename: string }[];
  delivery: OutboxDelivery;
}

export function outboxDeliveryLabel(delivery: OutboxDelivery) {
  switch (delivery) {
    case "delivered":
      return null;
    case "pending":
      return "queued for delivery";
    case "processing":
      return "delivery in progress";
    case "failed":
      return "✗ delivery failed";
    case "skipped":
      return "not delivered — no transport configured";
    case "expired":
      return "expired or superseded before delivery";
  }
}

/**
 * The dev outbox: everything the email pipeline queued (in production
 * these go through the selected email transport; locally they spool to the DB).
 * Click a row to read the rendered email.
 */
export function Outbox() {
  const [emails, setEmails] = useState<OutboxEmail[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/outbox")
      .then((r) => r.json())
      .then((d: { emails: OutboxEmail[] }) => setEmails(d.emails))
      .catch(() => setEmails([]));
  }, []);

  if (!emails) return null;

  return (
    <section className="mb-10">
      <h2 className="font-sans text-[13px] font-semibold text-ink">Outbox</h2>
      <p className="mb-[14px] mt-1 font-sans text-[12px] text-faint">
        {emails.length
          ? "Every email the app queued, newest first — book something and watch it progress."
          : "Nothing queued yet — finish setup or book a time on your page and the emails land here."}
      </p>
      <div className="flex max-w-[720px] flex-col gap-2">
        {emails.map((e) => {
          const deliveryLabel = outboxDeliveryLabel(e.delivery);
          return (
            <div
              key={e.id}
              className="overflow-hidden rounded-card border border-line bg-white shadow-card-sm"
            >
              <button
                type="button"
                onClick={() => setOpen(open === e.id ? null : e.id)}
                className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-[18px] py-3 text-left hover:bg-paper"
              >
                <span className="font-sans text-[12.5px] font-semibold text-ink">
                  {e.subject}
                </span>
                <span className="font-sans text-[11.5px] text-faint">
                  to {e.to} · from {e.from}
                  {e.replyTo ? ` · reply-to ${e.replyTo}` : ""}
                  {e.attachments?.length
                    ? ` · 📎 ${e.attachments.map((a) => a.filename).join(", ")}`
                    : ""}{" "}
                  · {new Date(e.createdAt).toLocaleTimeString()}
                  {deliveryLabel && (
                    <span
                      className={
                        e.delivery === "failed" || e.delivery === "expired"
                          ? "text-body"
                          : ""
                      }
                    >
                      {" "}· {deliveryLabel}
                    </span>
                  )}
                </span>
              </button>
              {open === e.id && (
                <iframe
                  title={e.id}
                  srcDoc={e.html}
                  className="block w-full border-0 border-t border-hairline bg-paper-dim"
                  style={{ height: 560 }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
