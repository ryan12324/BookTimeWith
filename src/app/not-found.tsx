import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" className="min-h-screen bg-paper px-6 py-12">
      <section className="mx-auto mt-12 w-full max-w-[520px] rounded-card border border-line bg-white px-6 py-10 text-center shadow-card sm:px-9">
        <h1 className="font-serif text-[26px] tracking-[-.01em] text-ink">
          This page isn&apos;t here.
        </h1>
        <p className="mx-auto mt-3 max-w-[44ch] font-sans text-[13.5px] leading-[1.65] text-body">
          The link may be incomplete, expired, or no longer in use.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-[44px] items-center rounded-input px-4 font-sans text-[13px] font-semibold text-bronze-ink"
        >
          Return home
        </Link>
      </section>
    </main>
  );
}
