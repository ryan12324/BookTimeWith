import { NextResponse, type NextRequest } from "next/server";

/**
 * Domain split enforcement (README "Domain architecture").
 *
 *  - booktimewith.com  → marketing + owner app (/, /app/*, /api/*). Owner
 *    session cookies live here only.
 *  - booktimewith.link → public booking (/[handle]) and client manage
 *    (/manage/*). No owner login surface, so a booking page can never
 *    impersonate the product or read an owner session.
 *
 * Locally everything is one origin (localhost), so this is a no-op unless the
 * request actually arrives on one of the two production hosts. That keeps
 * `next dev` friction-free while documenting and enforcing the real boundary.
 */
const OWNER_ONLY = [/^\/app(\/|$)/, /^\/api\//, /^\/emails(\/|$)/];
const PUBLIC_ONLY = [/^\/manage(\/|$)/];

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const { pathname } = req.nextUrl;

  const isLink = host.startsWith("booktimewith.link");
  const isCom = host.startsWith("booktimewith.com") || host.startsWith("www.booktimewith.com");

  // On the .link domain, keep owner/product surfaces off it entirely.
  if (isLink && OWNER_ONLY.some((re) => re.test(pathname))) {
    return NextResponse.redirect(new URL(pathname, "https://booktimewith.com"));
  }

  // On the .com domain, client manage links belong on .link.
  if (isCom && PUBLIC_ONLY.some((re) => re.test(pathname))) {
    return NextResponse.redirect(new URL(pathname, "https://booktimewith.link"));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
