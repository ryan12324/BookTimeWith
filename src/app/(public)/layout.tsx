/**
 * Public surface (booktimewith.link): booking pages and client magic-link manage
 * pages. Deliberately a separate domain from the owner app — no owner cookies or
 * login surface here, so a booking page can never impersonate the product.
 * (Locally these render under the same origin; production routes them by host —
 * see README "Domain architecture".)
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-paper py-0 sm:py-6">{children}</div>;
}
