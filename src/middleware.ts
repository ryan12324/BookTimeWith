import { NextResponse, type NextRequest } from "next/server";
import { RESERVED_HANDLES } from "@/lib/handles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Domain split enforcement (README "Domain architecture").
 *
 *  - booktimewith.com  → marketing, /signin, owner app (/app/*), /emails, and
 *    the owner/system APIs. Owner session cookies live here only (cookies are
 *    host-scoped — .link never sees them).
 *  - booktimewith.link → user-generated content: public booking pages
 *    (/[handle]), client manage pages (/manage/*), and ONLY the APIs those
 *    surfaces call (public config subset, slots, booking create, manage).
 *    No owner login surface, no owner data, so a malicious booking page can
 *    never impersonate the product or read an owner session.
 *
 * Page routes on the wrong host redirect; API calls on the wrong host get a
 * 404 (a redirect would just fail CORS for fetches — fail explicitly).
 *
 * Locally everything is one origin (localhost), so the split is a no-op unless
 * the request arrives on one of the two production hosts (or a spoofed Host
 * header in tests). The public handle server page consults `handle_redirects`,
 * so a changed handle keeps a 301 from the old handle for 90 days.
 */
const OWNER_PAGES = [/^\/app(\/|$)/, /^\/emails(\/|$)/, /^\/signin(\/|$)/];
const PUBLIC_PAGES = [/^\/manage(\/|$)/];
// The only API surface the .link domain exposes:
const LINK_APIS: { re: RegExp; methods?: string[] }[] = [
  { re: /^\/api\/owner$/, methods: ["GET"] }, // public subset (?public=1)
  { re: /^\/api\/slots$/, methods: ["GET"] },
  { re: /^\/api\/bookings$/, methods: ["POST"] }, // create only — no listing
  { re: /^\/api\/manage\/[^/]+$/ },
];
// A public booking page path: one segment of handle characters. Requests are
// matched case-insensitively because the page resolver normalises handles too;
// otherwise `/DANA` could render UGC on the owner-cookie domain.
const HANDLE_PATH = /^\/([a-z0-9-]{3,30})\/?$/i;
const SECURITY_PATH_BASE = new URL("https://security.invalid");
const UNRESERVED_PATH_BYTE = /^[A-Za-z0-9._~-]$/;

/**
 * Next routes some percent-encoded page segments after decoding them, while the
 * middleware receives the encoded pathname. Decode URL-unreserved bytes for the
 * security decision and reject every remaining escape/control/backslash form so
 * routing and authorization cannot disagree about which page was requested.
 */
function securityPathname(pathname: string): string | null {
  if (/[\\\u0000-\u001f\u007f]/.test(pathname)) return null;
  const decoded = pathname.replace(/%([0-9a-f]{2})/gi, (encoded, value: string) => {
    const character = String.fromCharCode(Number.parseInt(value, 16));
    return UNRESERVED_PATH_BYTE.test(character) ? character : encoded;
  });
  // Reject encoded reserved bytes (including slash/backslash), controls,
  // malformed escapes, and double-encoding instead of guessing how Next will
  // normalize them later in the routing pipeline.
  if (decoded.includes("%")) return null;
  try {
    const resolved = new URL(decoded, SECURITY_PATH_BASE);
    return resolved.origin === SECURITY_PATH_BASE.origin
      ? resolved.pathname
      : null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":", 1)[0].toLowerCase();
  const rawPathname = req.nextUrl.pathname;
  const pathname = securityPathname(rawPathname);
  const { search } = req.nextUrl;
  if (!pathname) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  const isLink = host === "booktimewith.link" || host === "www.booktimewith.link";
  const isCom = host === "booktimewith.com" || host === "www.booktimewith.com";

  if (isLink) {
    // APIs: allowlist only what the booking/manage surfaces call.
    if (pathname.startsWith("/api/")) {
      if (pathname !== rawPathname) {
        return NextResponse.json({ error: "invalid path" }, { status: 400 });
      }
      const allowed = LINK_APIS.some(
        (a) => a.re.test(pathname) && (!a.methods || a.methods.includes(req.method)),
      );
      if (!allowed) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      // The .link domain only ever gets the public config subset.
      if (pathname === "/api/owner") {
        const headers = new Headers(req.headers);
        headers.set("x-btw-public", "1");
        return NextResponse.next({ request: { headers } });
      }
      return NextResponse.next();
    }
    // Owner/product pages (and the marketing root) belong on .com.
    if (pathname === "/" || OWNER_PAGES.some((re) => re.test(pathname))) {
      return NextResponse.redirect(new URL(pathname + search, "https://booktimewith.com"));
    }
    if (pathname !== rawPathname) {
      const canonical = req.nextUrl.clone();
      canonical.pathname = pathname;
      return NextResponse.redirect(canonical);
    }
    return NextResponse.next();
  }

  if (isCom) {
    // UGC belongs on .link: client manage links and public booking pages.
    if (PUBLIC_PAGES.some((re) => re.test(pathname))) {
      return NextResponse.redirect(new URL(pathname + search, "https://booktimewith.link"));
    }
    const handle = pathname.match(HANDLE_PATH)?.[1]?.toLowerCase();
    if (handle && !RESERVED_HANDLES.has(handle)) {
      return NextResponse.redirect(
        new URL(`/${handle}${search}`, "https://booktimewith.link"),
      );
    }
  }

  // Owner app requires a session (magic-link sign-in — the cookie is a
  // self-contained HMAC token, verified at the edge with no DB hit).
  // Exception: /app/setup is the SIGNUP flow — the server component and the
  // owner API enforce "account exists → sign in" themselves (needs the DB).
  // The email outbox/gallery is session-gated in production too: it contains
  // live sign-in and manage links; in dev it's the mail-catcher.
  const needsSession =
    (/^\/app(\/|$)/.test(pathname) && !/^\/app\/setup(\/|$)/.test(pathname)) ||
    (process.env.NODE_ENV === "production" &&
      (/^\/emails(\/|$)/.test(pathname) || pathname === "/api/outbox"));
  if (needsSession) {
    const ownerId = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!ownerId) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const signin = new URL("/signin", req.url);
      signin.searchParams.set("next", pathname + search);
      return NextResponse.redirect(signin);
    }
  }

  if (pathname !== rawPathname) {
    const canonical = req.nextUrl.clone();
    canonical.pathname = pathname;
    return NextResponse.redirect(canonical);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
