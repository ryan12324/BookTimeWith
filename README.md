# Book Time With

**The un-software for booking clients.** Deliberately minimal scheduling for
service businesses — therapists, coaches, consultants, contractors, tutors. The
whole product is one booking link: the owner claims `booktimewith.link/handle`,
paints weekly availability, and clients book a slot in three taps with **no
account, ever**.

This repo implements the [Claude Design handoff](project/design_handoff_booktimewith/README.md)
in Next.js + Tailwind, pixel-faithfully. The original HTML design references live
under [`project/`](project/); the full product spec is in
[`project/design_handoff_booktimewith/README.md`](project/design_handoff_booktimewith/README.md).

## Stack

- **Next.js** (App Router, TypeScript) — plain `next dev`/`next build`, structured
  Cloudflare-ready (add `@opennextjs/cloudflare` to deploy; no source changes).
- **Tailwind CSS** — design tokens in [`tailwind.config.ts`](tailwind.config.ts).
- **React Email** — the 8 transactional templates (+ 4 written to spec).
- **Drizzle / Zod / date-fns-tz** — phase-2 data model, validation, timezone math.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

### Where to look

| Route | What |
|---|---|
| `/` | Landing page (booktimewith.com) |
| `/app/setup` | Owner onboarding — claim link → service/length/where → paint hours → live |
| `/app/bookings` | Owner bookings — move / cancel / undo, clients auto-emailed |
| `/app/settings` | The one settings page (link, service, hours, calendar, emails, plan) |
| `/dana` | Public booking page (booktimewith.link/`handle`) |
| `/manage/:token` | Client magic-link manage page (reschedule / cancel, no login) |
| `/emails` | Dev gallery of all 12 email templates, rendered to real HTML |

The owner config (handle, service, hours, …) persists to `localStorage` as a
stand-in for the phase-2 server, so edits in the owner app flow through to the
public booking page — the "live" feel of the design prototype, without a backend.

## Project structure

```
src/
  app/
    (marketing)/        landing page          → booktimewith.com
    app/                owner app (nav + provider), setup / bookings / settings
    (public)/           [handle] booking + manage/[token]   → booktimewith.link
    api/                handle-available, bookings (Zod-validated stubs)
    emails/             email preview gallery
  components/           AvailabilityGrid, DurationStepper, Toggle, client/ owner/ landing/
  emails/               React Email templates + registry
  lib/                  format, tokens, availability, scheduling, handles, store, mock
  db/                   Drizzle schema (phase-2 Postgres)
  middleware.ts         .com / .link domain-split enforcement
```

## Design fidelity

Colors, type, spacing, copy, and interaction states follow the handoff spec
exactly. **All copy is final** — the plainspoken, anti-hype voice ("No account
needed. Ever.", "This is the whole setup. There is no step 4.") is the brand; it
isn't paraphrased. Fonts are **Source Serif 4** (display) and **Libre Franklin**
(UI), loaded via `next/font`. The striped avatar is a placeholder — photo upload
is a real phase-2 feature.

Built mobile-first (375px): the client booking + manage cards go edge-to-edge on
phones with a sticky bottom CTA; the availability grid drag-paints with touch;
tap targets are ≥ 44px.

## Phase 2 — integrations (not built here)

The UI, interactions, data model, API contracts, and email templates are done.
These integrations were scoped out for phase 2 and need live credentials
(see [`.env.example`](.env.example)):

- **Stripe** — one product, multi-currency prices (£6/$8/€7/A$12), 30-day
  card-less trial, Smart Retries mapped to the 14-day grace, Customer Portal,
  webhooks driving billing emails + page state.
- **Cloudflare Email** — send the 8+ templates from `mail.booktimewith.com`
  (SPF/DKIM/DMARC); client From is "{Owner} via booktimewith.com", Reply-To the
  owner. Attach `.ics` to confirmations.
- **Database** — wire Drizzle ([`src/db/schema.ts`](src/db/schema.ts)) to Postgres/D1.
- **Auth** — owner email magic-link (no passwords); clients never have accounts.
- **Calendar sync** — Google Calendar + Microsoft Graph (Apple/CalDAV later);
  two-way busy blocking; auto Google Meet links.
- **Cron** — client reminders (T-24h), owner morning summaries (7am local),
  trial-ending notices, dunning.
- **Scheduling engine** — rules are coded in [`src/lib/scheduling.ts`](src/lib/scheduling.ts)
  (slot generation, 4h min-notice, 60-day horizon, race protection); feed them
  real bookings + synced busy time.

## Out of scope (deliberately)

CRM, intake-form builder, payments-for-bookings, packages/memberships/gift cards,
AI features, multi-service menus, per-client accounts, native apps. *If a feature
needs a second settings page, it's out.*
