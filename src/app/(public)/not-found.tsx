import Link from "next/link";

export default function PublicNotFound() {
  return (
    <section className="mx-auto mt-12 w-[calc(100%-3rem)] max-w-[520px] rounded-card border border-line bg-white px-6 py-10 text-center shadow-card sm:px-9">
      <h1 className="font-serif text-[26px] tracking-[-.01em] text-ink">
        This booking link isn&apos;t available.
      </h1>
      <p className="mx-auto mt-3 max-w-[44ch] font-sans text-[13.5px] leading-[1.65] text-body">
        Check the address with the person who shared it. The link may have changed or
        may not be live yet.
      </p>
      <Link
        href="https://booktimewith.com"
        className="mt-6 inline-flex min-h-[44px] items-center rounded-input px-4 font-sans text-[13px] font-semibold text-bronze-ink"
      >
        About booktimewith.com
      </Link>
    </section>
  );
}
