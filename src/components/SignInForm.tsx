"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { T } from "@/lib/tokens";

/**
 * Magic-link sign-in. No password field exists — the emailed link is the login.
 * Preserves ?next so "Claim it" → sign in → onboarding keeps the chosen handle.
 */
export function SignInForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = params.get("expired") === "1";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), next: params.get("next") ?? "/app" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        const message = typeof body?.error === "string" ? body.error : null;
        setError(
          response.status === 429
            ? message ?? "Too many sign-in links requested. Try again shortly."
            : message ?? "We couldn't request a sign-in link. Please try again.",
        );
        return;
      }
      setSent(true);
    } catch {
      setError("We couldn't reach the sign-in service. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-[420px] rounded-card-lg border border-line-soft bg-white p-8 shadow-float">
      {!sent ? (
        <>
          <h1 className="font-serif text-[26px] tracking-[-.01em]">Sign in.</h1>
          <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
            {expired
              ? "That link had expired — they only live 15 minutes. Enter your email and we'll send a fresh one."
              : "No password — we email you a link and that's the whole login."}
          </p>
          <form onSubmit={submit}>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="you@example.com"
              aria-label="Your email"
              aria-describedby={error ? "signin-error" : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="email"
              className="mt-5 w-full rounded-chip border border-line px-[15px] py-[13px] font-medium text-ink outline-none"
              style={{ fontSize: 16 }}
            />
            {error && (
              <p id="signin-error" role="alert" className="mt-2 font-sans text-[12px] text-ink">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="mt-4 w-full rounded-chip py-[13px] text-center font-sans text-[14px] font-semibold text-paper"
              style={{ background: email.trim() && !submitting ? T.ink : T.disabled }}
              disabled={!email.trim() || submitting}
            >
              {submitting ? "Requesting link…" : "Email me a sign-in link"}
            </button>
          </form>
          <p className="mt-[14px] text-center font-sans text-[11.5px] text-faint">
            Works once, expires in 15 minutes.
          </p>
        </>
      ) : (
        <>
          <h1 className="font-serif text-[26px] tracking-[-.01em]">Check your inbox.</h1>
          <p className="mt-2 font-sans text-[13.5px] leading-[1.6] text-body">
            If {email.trim()} has an account, a sign-in link is on its way. Tap it
            and you&apos;re in.
          </p>
          <p className="mt-[14px] font-sans text-[11.5px] text-faint">
            Running locally? The email lands in the{" "}
            <Link href="/emails" className="font-semibold text-bronze">
              outbox
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}
