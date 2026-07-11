---
name: verify
description: Build, launch, and drive the Book Time With app end-to-end to verify changes at the running surface (booking flow, owner app, manage page, emails, OG image).
---

# Verifying Book Time With

## Build + launch

**NEVER run verification against the project's `.data/` — signups and bookings
persist and pollute the user's preview.** Isolate every test server:
`BTW_DATA_DIR=$(mktemp -d)/btw npx next start -p 3123`, and still
`rm -rf .data` + restart the preview if you forget.

```bash
npx next build                      # must pass first
npx next start -p 3123 &            # production server (dev server also fine)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3123/   # expect 200
```

## Drive it (browser)

No Playwright in the repo. Use `puppeteer-core` against system Chrome:

```bash
npm install --no-save puppeteer-core   # no lockfile change, no browser download
```

```js
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
});
```

If the driver script lives outside the repo (scratchpad), symlink
`node_modules` next to it — ESM ignores NODE_PATH.

## App state model (what to poke)

Everything lives in the embedded Postgres (PGlite) at `.data/` — served by the
API. `rm -rf .data` + server restart = factory reset (re-seeds Dana, un-setup,
unverified, fixture bookings).

- `GET/PATCH /api/owner` — the whole config (handle, service, cells, away,
  paused, email, emailVerified, setupComplete). PATCH `{"paused": true}` →
  `/dana` shows the paused state; PATCH an `away` range covering today →
  "Nothing available in the next few weeks."
- `GET /api/slots`, `POST /api/bookings` (409 on race — fire two concurrent
  POSTs at the same startsAt), `PATCH /api/bookings/[id]` (owner move/cancel),
  `GET|PATCH /api/manage/[token]` (24h cutoff → 403).
- `GET /api/outbox` — every email actually sent (also browsable at /emails).
  Manage/verify links inside the HTML are real — extract and follow them.
- **Setup IS the signup**: /app/setup is open (no session), collects handle
  (from ?handle=), name, email, service+address, painted hours — every field
  required per step, NOTHING autosaves until "You're done — go live", which
  commits the whole config in one PATCH, mints the session cookie, and sends
  welcome + verification. A fresh install is a BLANK account (placeholders
  only). During signup the nav is wordmark-only. Unknown handles 404.
- **/app is auth-gated**: unauthenticated hits redirect to /signin (next param
  preserved). Sign in by POSTing /api/auth/signin {email: the owner's email},
  then extracting the callback URL from the outbox sign-in email. Links are
  single-use, 15-min expiry.
- Billing states: the webhook REQUIRES STRIPE_WEBHOOK_SECRET (501 without,
  400 on bad signature). To test: start the server with
  `STRIPE_WEBHOOK_SECRET=whsec_test…` and sign payloads yourself —
  `v1 = HMAC_SHA256(secret, t + "." + payload)`, header
  `Stripe-Signature: t=<t>,v1=<hex>`. Billing state is never client-writable.
- Outbox/emails pages are session-gated in production builds (401/redirect);
  open only under `next dev`. Calendar connect without OAuth creds redirects
  to settings?calendar=unconfigured — no fake connections.
- Cron: GET /api/cron (add ?force=summary or ?force=trial to bypass the 7am /
  T-7d gates). Re-runs dedupe via email_log.
- Calendar: GET /api/calendar/connect?provider=google → demo connection
  (real OAuth when GOOGLE_CLIENT_ID/SECRET set).

## Flows worth driving

1. `/dana`: 3 real-date day tabs, "Times in {zone}" line, pick slot → CTA label,
   details form (inputs must be ≥16px), confirm → "Booked." + Google/Outlook/.ics
   links; ledger gets the row.
2. Race: book a slot in a second page while the first sits on the details form,
   then confirm the first → "That time just went — here's what's still open."
3. `/app/bookings`: TODAY/TOMORROW groups, Move/Cancel/Undo, Away date-range
   (set → bronze summary line; `/dana` shows nothing available).
4. `/app/setup`: handle input hint is live — "ab" → too short, "admin" →
   taken, real handle → "✓ … is available".
5. `/emails`: all 12 templates render.
6. OG image: read `meta[property="og:image"]` from `/dana` (the route has a
   content-hash suffix — don't guess the URL), fetch it, expect `image/png`.

## Gotchas

- Fonts: body must compute to "Libre Franklin", headings "Source Serif 4"
  (spec tokens — a past regression swapped in Source Sans 3).
- Slot instants are owner-tz wall clock → UTC via `fromZonedTime(string, tz)`;
  passing a `Date` there double-shifts by the host timezone (bug found by this
  verification, keep an eye on it).
- The server keeps running in the background — `pkill -f "next start -p 3123"`
  when done.
- **Never run `next dev` and `next start` (or `next build`) at the same time** —
  they share `.next/`, and whichever writes last clobbers the other's assets
  (pages then serve with 404'd JS/CSS chunks and no hydration). One server at a
  time; rebuild before restarting `next start`.
- Dev-only bugs are real bugs: StrictMode + on-demand compilation change effect
  timing (the ?handle= seeding race only reproduced under `next dev`). Verify
  state-hydration changes against both servers.
