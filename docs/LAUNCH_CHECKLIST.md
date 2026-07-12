# Launch checklist

Code can enforce application invariants; it cannot configure providers, review
legal text, or prove that backups restore. Complete and record these checks for
each environment before accepting real client data. Use
[`SECRETS_SETUP.md`](SECRETS_SETUP.md) for the exact secret-generation commands,
provider-console settings, callback URLs, scopes, and webhook events.

## Infrastructure

- [ ] Route `booktimewith.com` and `booktimewith.link` to the same app and verify
  HTTPS, redirects, and cookie host isolation on both domains.
- [ ] Provision PostgreSQL 16+ (or a compatible managed service), set the
  secret `DATABASE_URL`, and include the provider-required TLS `sslmode`.
- [ ] Configure the Coolify application to build the repository Dockerfile;
  do not attach an application data volume or add a Compose deployment layer.
- [ ] Budget `DATABASE_POOL_MAX × app replicas` below the database connection
  limit, leaving capacity for migrations, operators, backups, and maintenance.
- [ ] Enable encrypted PostgreSQL backups/point-in-time recovery and document
  retention. Do not treat an application container filesystem as durable.
- [ ] Restore the latest backup into a separate environment and complete a real
  booking/export flow from the restored data.
- [ ] For a PGlite-era upgrade, stop the old app, copy its data directory, run
  `npm run db:import:pglite` against an empty target, retain the existing
  calendar encryption secret, compare every printed row count, and rehearse
  rollback before directing traffic to PostgreSQL.
- [ ] Configure uptime checks for `/api/health`, request-error reporting, disk
  capacity alerts, email failures, calendar degradation, and failed cron runs.
- [ ] Configure Coolify scheduled tasks so `/api/cron` runs every five minutes
  and `/api/cron/auth-mail` plus `/api/cron/booking-mail` run every minute, all
  with the production cron bearer token.
- [ ] Configure the edge/reverse proxy to discard client-supplied
  `CF-Connecting-IP`, `X-Forwarded-For`, and `X-Real-IP` values and set one
  trustworthy client address before requests reach the app; keep the origin
  private, then set `TRUST_PROXY_HEADERS=true`.

## Secrets and access

- [ ] Generate independent production `AUTH_TOKEN_SECRET`, `CRON_SECRET`,
  `RATE_LIMIT_SECRET`, and `CALENDAR_TOKEN_SECRET` values in the deployment
  secret store. Never reuse examples or commit real values.
- [ ] Document rotation procedures. Rotating the auth key signs out owners;
  rotating the calendar key requires a token re-encryption/reconnect plan.
- [ ] Restrict production and backup access to named operators and enable audit
  logs/MFA in Coolify and every third-party provider.
- [ ] Verify `/emails` and `/api/outbox` reject an anonymous production request.

## Email

- [ ] Onboard the sending domain in Cloudflare Email Service, then configure
  `EMAIL_TRANSPORT=cloudflare`, the account ID, a scoped Email Sending API
  token, and the real from-domain.
- [ ] Confirm production `/api/health` returns 503 when the email transport or
  any Cloudflare credential is absent, and 200 only after it is configured.
- [ ] Publish and validate SPF, DKIM, and DMARC for the sending domain.
- [ ] Deliver sign-in, verification, confirmation with `.ics`, move, cancel,
  reminder, billing, and summary emails to at least Gmail and Outlook.
- [ ] Confirm a new page rejects bookings before email verification; then change
  the owner email and verify the old address/session remains authoritative until
  the exact pending-address link is consumed and older links stop working.
- [ ] Confirm Reply-To reaches the correct owner and provider bounces/complaints
  are monitored.
- [ ] Verify failed messages retry and delivered production rows redact message
  bodies and attachments.

## Stripe

- [ ] Create the product and GBP/USD/EUR/AUD recurring prices, then set all price
  IDs and live secret keys.
- [ ] Register `/api/billing/webhook` and subscribe only to the event types the
  route handles: Checkout completion, invoice paid/payment failed, and customer
  subscription updated/deleted.
- [ ] Enable Stripe Checkout’s
  [“limit customers to one subscription” redirect](https://docs.stripe.com/payments/checkout/limit-subscriptions)
  and keep the Customer Portal login link enabled. The app reconciles duplicate
  subscriptions defensively, but the Stripe-side guard prevents double billing.
- [ ] Exercise Stripe CLI/test-clock flows for trial, payment recovery, grace
  expiry, cancellation at period end, fully-ended restart, replay, sibling
  subscriptions, and out-of-order delivery of an old cancellation after restart.
- [ ] When upgrading a running pre-customer-binding deployment, wait at least 24
  hours for old email-only Checkout Sessions to expire (or expire them through
  Stripe) before enabling account deletion. New Sessions always use the locally
  bound Customer and are safe to delete concurrently.
- [ ] Have an accountant/legal adviser decide Stripe Tax, invoice requirements,
  VAT/GST registration, refunds, and displayed pricing obligations. They are not
  automated by this repository.

## Calendar and abuse controls

- [ ] Register the exact production callback
  `https://booktimewith.com/api/calendar/callback` with Google and Microsoft.
- [ ] Complete provider consent-screen/publisher verification and use the least
  calendar scopes shown by the app.
- [ ] Connect, refresh an expired access token, block a busy event, create a
  booking, move it, cancel it, reconnect a degraded account, and disconnect.
- [ ] Configure matching Turnstile secret/site keys for the public booking domain
  and confirm a rate-limited booking can complete the challenge.

## Privacy, policy, and support

- [ ] Obtain jurisdiction-appropriate legal review for Terms, Privacy Notice,
  cookie disclosure, processor/subprocessor terms, and a DPA where required.
- [ ] Document the lawful basis and retention period for owner/client contact,
  booking, calendar, billing, log, outbox, and backup data.
- [ ] Reflect the enforced client-data window in the Privacy Notice: 730 days
  after an appointment ends, the scheduler removes client identity, contact,
  address, timezone, links, provider/request metadata, action reasons, manage
  tokens, and rendered booking mail while retaining anonymous service/time/status
  history. Document any shorter manual deletion process separately.
- [ ] Exercise the client-PII job with more than 100 eligible bookings and the
  owner scheduler with more than 50 accounts; confirm batches rotate across
  successive runs and a failing owner does not starve later accounts.
- [ ] Test owner CSV export, immediate account deletion, local calendar-token
  removal, provider-side grant removal, and the 90-day post-cancellation purge.
  Define how deletion propagates to backups.
- [ ] Publish a security/privacy contact, incident response path, and client data
  correction/deletion process.

## Release gate

```bash
npm ci
npm run check
docker build -t booktimewith:release .
```

- [ ] Start the release image against an empty temporary PostgreSQL database and
  confirm migrations 0000 onward plus `/api/health` succeed. Start two app
  instances together once and confirm the advisory migration lock serializes
  them without duplicate/failed migrations.
- [ ] Smoke-test two independent owners: signup, sign-in, tenant isolation,
  booking, concurrent-slot conflict, move, cancel, export, and deletion.
- [ ] Test keyboard-only and mobile booking/manage flows, reduced motion, and
  owner/client timezone differences around a DST transition.
- [ ] Record the image digest, migration set, backup timestamp, test result, and
  rollback owner for the release.
