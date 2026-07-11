# Book Time With

**The un-software for booking clients.** A service professional claims one
`booktimewith.link/handle`, paints their weekly availability, and clients book
without creating an account.

The interface follows the design handoff in
[`project/design_handoff_booktimewith/README.md`](project/design_handoff_booktimewith/README.md).
Product intent and design principles live in [`PRODUCT.md`](PRODUCT.md).

## What is implemented

- Multi-owner signup and magic-link sign-in, with exact tenant scoping on every
  private read and write.
- One service per owner, painted half-hour availability, away dates, owner
  timezone, 4-hour notice, and a 60-day booking horizon.
- Public booking and tokenized client-manage flows with transactional overlap
  protection, idempotent actions, and a 24-hour change cutoff.
- Durable email outbox with dedupe, retries, `.ics` confirmations, email
  verification, reminders, summaries, and honest delivery status.
- Google and Outlook OAuth, encrypted tokens, access-token refresh, busy-time
  reads, and create/move/cancel event reconciliation.
- Stripe Checkout/Portal with a pre-bound customer, open-Checkout reuse,
  customer-wide subscription reconciliation, and signature-verified,
  replay-safe webhook state for paid access, grace, restart, and retention.
- Persistent rate limits, disposable-email rejection, and conditional
  Cloudflare Turnstile challenges.
- CSV booking export, account deletion, DB health checks, security headers,
  Docker/Coolify deployment, and a five-minute recovery scheduler.

## Stack

- Next.js App Router, React, TypeScript, Tailwind CSS
- Pooled PostgreSQL (`node-postgres`) with Drizzle ORM and SQL migrations
- React Email, Zod, date-fns, and date-fns-tz
- Vitest and ESLint

`DATABASE_URL` is required in every environment. The runtime uses a bounded
`node-postgres` pool and applies generated migrations under a PostgreSQL
advisory lock, so simultaneous app starts cannot race the migration ledger.
Use a direct/session-capable connection URL and the provider-required
`sslmode` query parameter. The Node runtime is intended for Docker/Coolify, not
an edge worker without a compatible PostgreSQL adapter.

## Run locally

```bash
npm install
docker run --name booktimewith-postgres \
  -e POSTGRES_DB=booktimewith \
  -e POSTGRES_USER=booktimewith \
  -e POSTGRES_PASSWORD=local-only-password \
  -p 5432:5432 -d postgres:16-alpine
cp .env.example .env.local  # then set the matching DATABASE_URL/password
npm run dev          # http://localhost:3000
npm run check        # lint + typecheck + tests + production build
```

Local email stays in the PostgreSQL outbox and can be inspected at `/emails`;
no external message is delivered unless `EMAIL_WEBHOOK_URL` is configured.

Useful routes:

| Route | Purpose |
|---|---|
| `/` | Marketing page |
| `/app/setup` | Claim a handle and publish the first service |
| `/signin` | Request a 15-minute owner sign-in link |
| `/app/bookings` | Move, cancel, restore, and set away dates |
| `/app/settings` | Link, service, hours, calendar, email, plan, export, deletion |
| `/:handle` | A published owner’s public booking page |
| `/manage/:token` | Client reschedule/cancel page |
| `/emails` | Email previews and the scoped local outbox |
| `/api/health` | Database readiness probe |

## Deploy with Docker/Coolify

The included [`Dockerfile`](Dockerfile) builds Next’s standalone server.
[`docker-compose.yml`](docker-compose.yml) runs the app, a five-minute general
scheduler, and isolated one-minute auth-mail and booking-mail recovery workers.
It also runs PostgreSQL 16; the application containers are stateless and only
the database service mounts the durable volume. For managed PostgreSQL, deploy
the Dockerfile with the provider's `DATABASE_URL` instead.

Production readiness requires strong `AUTH_TOKEN_SECRET` and `CRON_SECRET`
values plus an HTTPS outbound email transport (passwordless sign-in depends on
it). Copy
[`.env.example`](.env.example), supply the relevant integration credentials,
and complete [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md).

```bash
export AUTH_TOKEN_SECRET="$(openssl rand -base64 48)"
export CRON_SECRET="$(openssl rand -base64 32)"
export POSTGRES_PASSWORD="$(openssl rand -hex 32)" # URL-safe
export EMAIL_WEBHOOK_URL="https://your-mail-transport.example/send"
docker compose up --build
```

Migrations run on first database access under an advisory lock and the
container health check calls `/api/health`. Back up PostgreSQL (or configure
managed point-in-time recovery) and rehearse a restore before accepting real
bookings. Tune `DATABASE_POOL_MAX` per app replica against the server's
connection limit; its default is 10.

### One-time import from the old PGlite runtime

If upgrading an installation that already has `.data/btw`, stop the old app,
back it up, and import a consistent copy into an **empty** PostgreSQL database:

```bash
cp -a .data/btw /tmp/booktimewith-pglite-import
PGLITE_DATA_DIR=/tmp/booktimewith-pglite-import \
DATABASE_URL='postgresql://user:password@host:5432/booktimewith?sslmode=require' \
npm run db:import:pglite
```

The importer applies current migrations to the target, copies tables in foreign
key order inside one transaction, verifies every row count, and refuses to run
when any application table in PostgreSQL is already populated. Keep the same
`CALENDAR_TOKEN_SECRET` so copied OAuth credentials remain decryptable, verify
the new `/api/health` and booking/export flows, then retain the PGlite backup
until the PostgreSQL restore drill succeeds.

Production domain routing expects:

- `booktimewith.com` for marketing, sign-in, owner app, and owner APIs
- `booktimewith.link` for public handles, manage links, and their allowlisted APIs

## Reliability and security model

- Owner cookies are HMAC-signed, HTTP-only, host-scoped, SameSite=Lax, and
  checked against a live owner record.
- Public owner data is resolved only from an explicit handle or manage token and
  is reduced before returning to the browser.
- A page cannot accept client data until the owner proves the active email.
  Address changes remain pending, keep the trusted identity/session intact, and
  take effect only when a capability bound to that exact new address is used.
- Booking confirmation locks the owner configuration, revalidates the selected
  instant, and relies on a Postgres exclusion constraint for concurrent overlap.
- Booking requests and actions bind idempotency keys to normalized intent. Each
  booking has one stable, hashed manage capability; calendar and missing outbox
  side effects are safely reconciled after crashes.
- Email is inserted into a durable deduplicated outbox before delivery; failed
  and abandoned processing rows retry with bounded backoff, then age out under
  the documented retention limit.
- Stripe signatures have a five-minute tolerance. Event IDs are replay-ledgered,
  owner/customer metadata must agree, and each locked owner is reconciled from
  all app-owned subscriptions so an old cancellation cannot override a new plan.
- OAuth access and refresh tokens are AES-GCM encrypted at rest. Provider calls
  are timed out and connection health is visible in Settings. Disconnect and
  deletion remove local credentials immediately; owners can remove the wider
  provider grant from Google/Microsoft security settings without risking a
  grant-wide revoke that breaks another owner using the same provider account.
- Exported client fields are guarded against spreadsheet formula injection.

## Data retention implemented by the scheduler

- The five-minute scheduler rotates through at most 50 setup-complete owners per
  run. Per owner, it considers at most 25 upcoming reminders and a complete,
  owner-local day of at most 100 non-overlapping appointments.
- 730 days after an appointment ends, a bounded 100-booking pass replaces the
  client name/email with anonymous placeholders and clears contact, address,
  timezone, meeting-link, calendar-provider, request-key, error, action-reason,
  manage-token, and rendered-email data. Service, time, and status remain as
  anonymous appointment history.
- Cancelling an account still uses its separate `purgeAfter` deadline and hard
  deletes the owner plus all dependent rows. Backup operators must apply the
  same documented deletion windows to off-host copies.

## Deliberately out of scope

Apple/CalDAV, teams, multiple services, photo upload, CRM, intake-form builders,
booking payments, packages, memberships, client accounts, and native apps.
Stripe Tax and jurisdiction-specific invoicing still require dedicated
integration work. Legal terms, privacy/DPA review, DNS/email authentication,
monitoring, provider verification, and backup operations are deployment tasks,
not claims made by this repository.
