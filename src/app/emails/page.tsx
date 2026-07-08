import { render } from "@react-email/components";
import { EMAILS, type EmailMeta } from "@/emails/registry";
import { Wordmark } from "@/components/ui";

export const metadata = { title: "Transactional emails" };

/**
 * Dev preview gallery for all transactional emails. Each is rendered to real
 * email HTML (same output the Cloudflare Email Worker will send in phase 2) and
 * shown in an iframe, with its From/Subject annotated as in the design file.
 */
export default async function EmailsPage() {
  const rendered = await Promise.all(
    EMAILS.map(async (e) => ({ meta: e, html: await render(<e.Component />) })),
  );

  const groups: { title: string; note: string; ids: EmailMeta["category"] }[] = [
    { title: "Booking emails", note: "Sent as clients book, get reminded, and owners get notified.", ids: "booking" },
    { title: "Billing emails", note: "The same honest voice: clear grace periods, nothing deleted silently.", ids: "billing" },
    { title: "Written in the same voice", note: "Not in the design file — authored to the spec (sign-in, change notices, welcome).", ids: "system" },
  ];

  return (
    <main className="min-h-screen bg-[#e9e5dc] px-6 py-11 md:px-12">
      <Wordmark size={15} />
      <h1 className="mt-4 font-sans text-[15px] font-semibold">Transactional emails</h1>
      <p className="mb-8 mt-1 max-w-[640px] font-sans text-[12.5px] leading-[1.5] text-body">
        Eight emails, one system. Every client email carries a magic manage link —
        reschedule or cancel with no account. Billing emails follow the same honest
        voice: no urgency theatre, clear grace periods, nothing deleted silently.
      </p>

      {groups.map((g) => (
        <section key={g.ids} className="mb-10">
          <h2 className="font-sans text-[13px] font-semibold text-ink">{g.title}</h2>
          <p className="mb-[14px] mt-1 font-sans text-[12px] text-faint">{g.note}</p>
          <div className="flex flex-wrap items-start gap-9">
            {rendered
              .filter((r) => r.meta.category === g.ids)
              .map(({ meta, html }) => (
                <div key={meta.id} className="w-full max-w-[520px]">
                  <div className="mb-[10px] flex items-center gap-2">
                    <span className="font-sans text-[11px] font-semibold uppercase tracking-wide text-bronze">
                      {meta.tag}
                    </span>
                    {!meta.designed && (
                      <span className="rounded-full bg-white px-2 py-[2px] font-sans text-[10px] font-semibold text-faint">
                        to spec
                      </span>
                    )}
                  </div>
                  <div className="overflow-hidden rounded-card border border-line bg-white shadow-card-sm">
                    <div className="border-b border-hairline px-[22px] py-[14px] font-sans text-[11.5px] text-faint">
                      <div>
                        <span className="font-semibold text-body">From:</span> {meta.from}
                      </div>
                      <div className="mt-[3px]">
                        <span className="font-semibold text-body">Subject:</span>{" "}
                        <span className="font-medium text-ink">{meta.subject}</span>
                      </div>
                    </div>
                    <iframe
                      title={meta.id}
                      srcDoc={html}
                      className="block w-full border-0 bg-[#e9e5dc]"
                      style={{ height: 560 }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </section>
      ))}
    </main>
  );
}
