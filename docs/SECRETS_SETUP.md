# Production secrets and provider setup

This is the source of truth for configuring Book Time With in Coolify. Create
separate test/staging and production credentials, enable MFA on every provider,
and never paste a real secret into Git, an issue, or a support message.

The production application uses these exact public URLs:

```text
Owner application:  https://booktimewith.com
Public booking:     https://booktimewith.link
Calendar callback:  https://booktimewith.com/api/calendar/callback
Stripe webhook:     https://booktimewith.com/api/billing/webhook
Health check:       https://booktimewith.com/api/health
```

Complete credential inventory:

| Variables | Source |
|---|---|
| `AUTH_TOKEN_SECRET`, `CRON_SECRET`, `RATE_LIMIT_SECRET`, `CALENDAR_TOKEN_SECRET` | Generate locally with OpenSSL |
| `DATABASE_URL` | Coolify/managed PostgreSQL connection details |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account overview |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Cloudflare API token with Email Sending: Edit |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Microsoft Entra app registration |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile widget |
| `STRIPE_SECRET_KEY` | Stripe live API-key page |
| `STRIPE_WEBHOOK_SECRET` | The live Stripe webhook endpoint |
| `STRIPE_BILLING_PORTAL_URL` | Stripe Dashboard customer-portal login link |
| `STRIPE_PRICE_GBP`, `STRIPE_PRICE_USD`, `STRIPE_PRICE_EUR`, `STRIPE_PRICE_AUD` | Stripe recurring Price objects |

## 1. Generate the application-owned secrets

Run this from the repository root. It creates four independent 256-bit secrets
in `.env.production.local`, which Git already ignores. Do not reuse a value for
more than one setting. It refuses to overwrite an existing file.

```bash
umask 077
SECRETS_FILE=.env.production.local
if [ -e "$SECRETS_FILE" ]; then
  printf '%s already exists; move or remove it first.\n' "$SECRETS_FILE" >&2
  exit 1
fi
{
  printf 'AUTH_TOKEN_SECRET=%s\n' "$(openssl rand -hex 32)"
  printf 'CRON_SECRET=%s\n' "$(openssl rand -hex 32)"
  printf 'RATE_LIMIT_SECRET=%s\n' "$(openssl rand -hex 32)"
  printf 'CALENDAR_TOKEN_SECRET=%s\n' "$(openssl rand -hex 32)"
} > "$SECRETS_FILE"
chmod 600 "$SECRETS_FILE"
```

Copy each value into Coolify as a secret environment variable, then remove the
local file after recording the values in your password/secret manager:

```bash
rm .env.production.local
```

What each value does:

| Variable | Purpose | Rotation effect |
|---|---|---|
| `AUTH_TOKEN_SECRET` | Signs owner sessions and capability tokens | Signs every owner out and invalidates outstanding auth links |
| `CRON_SECRET` | Authenticates the three scheduled-task requests | Update all three Coolify tasks at the same time |
| `RATE_LIMIT_SECRET` | Pseudonymizes rate-limit identities | Existing rate-limit buckets no longer match |
| `CALENDAR_TOKEN_SECRET` | Encrypts Google/Microsoft tokens in PostgreSQL | Existing connections cannot be decrypted; preserve it across migrations/restores and plan reconnection before rotation |

`AUTH_TOKEN_SECRET` and `CRON_SECRET` are mandatory in production and must be
at least 32 characters. `RATE_LIMIT_SECRET` and `CALENDAR_TOKEN_SECRET` have
secure fallbacks, but independent values are strongly recommended for
production.

## 2. PostgreSQL

Provision PostgreSQL 16 or newer in Coolify or a managed provider. Copy its
private/internal connection URL into `DATABASE_URL`; do not use the public URL
when the app and database share a private network. A managed database normally
requires its documented `sslmode` query parameter.

If you need to generate the database user's password yourself:

```bash
openssl rand -hex 32
```

Use the provider-generated connection URL when possible because it correctly
URL-encodes the password. The final form is:

```text
postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
```

Set `DATABASE_POOL_MAX` so `pool size x app replicas` remains below the server's
connection limit. The default is `10`. The connect and idle timeouts can keep
their defaults unless database monitoring shows a reason to tune them.

## 3. Outbound email transport

Passwordless sign-in makes a working email transport mandatory in production.
The application now calls Cloudflare Email Service's REST API directly through
a provider-neutral transport interface and factory; no separate Worker, SMTP
server, or webhook adapter is required.

Cloudflare Email Service requires Cloudflare DNS. On a Workers Paid account:

1. Open **Compute > Email Service > Email Sending** and select **Onboard
   Domain**.
2. Onboard `mail.booktimewith.com` (or the exact domain chosen below) and let
   Cloudflare install/verify its return-path, SPF, and DKIM DNS records.
3. Copy the 32-character account ID from the Cloudflare account overview.
4. Create an account API token restricted to this account with only **Email
   Sending: Edit**. Copy the token once into your secret manager.
5. Add these runtime variables in Coolify:

```text
EMAIL_TRANSPORT=cloudflare
EMAIL_FROM_DOMAIN=mail.booktimewith.com
CLOUDFLARE_ACCOUNT_ID=YOUR_32_CHARACTER_ACCOUNT_ID
CLOUDFLARE_EMAIL_API_TOKEN=YOUR_SCOPED_API_TOKEN
```

The factory currently accepts `cloudflare`; another provider can be added by
implementing `EmailTransport` and registering it in the factory without
changing the outbox. The adapter sends HTML, Reply-To, calendar attachments,
and a provider-visible delivery correlation header. The durable PostgreSQL
outbox remains responsible for retries and deduplication.

Cloudflare's official [Email Sending setup](https://developers.cloudflare.com/email-service/get-started/send-emails/)
and [REST API guide](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
document domain onboarding, the required token permission, attachments, and
current service limits. Publish a DMARC policy as well, then send real tests to
Gmail and Outlook before launch.

## 4. Google Calendar OAuth

In [Google Cloud Console](https://console.cloud.google.com/):

1. Create/select the production project and enable the Google Calendar API.
2. Configure the OAuth consent screen, app domains, privacy/terms URLs, support
   email, and production publishing status. Complete Google's verification if
   it is required for the requested calendar scopes.
3. Create an OAuth client with application type **Web application**.
4. Add this exact authorized redirect URI (no trailing slash):

   ```text
   https://booktimewith.com/api/calendar/callback
   ```

5. Copy the client ID and client secret into `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.

The code requests only these scopes:

```text
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.freebusy
```

Google requires the redirect URI to match exactly, including scheme, case, and
trailing slash. See Google's official [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

For local OAuth testing, add this second redirect URI to a non-production
client and use separate test credentials:

```text
http://localhost:3000/api/calendar/callback
```

## 5. Microsoft Outlook OAuth

In the [Microsoft Entra admin center](https://entra.microsoft.com/):

1. Open **Entra ID > App registrations > New registration**.
2. Choose **Accounts in any organizational directory and personal Microsoft
   accounts**. The application uses Microsoft's `common` OAuth endpoint.
3. Under **Authentication**, add a **Web** redirect URI:

   ```text
   https://booktimewith.com/api/calendar/callback
   ```

4. Under **API permissions > Microsoft Graph > Delegated permissions**, add
   `Calendars.ReadWrite`. The application also requests `offline_access` so it
   can refresh access when an owner is not present. Grant/admin-consent it if
   your tenant policy requires that.
5. Copy **Overview > Application (client) ID** to `MICROSOFT_CLIENT_ID`.
6. Open **Certificates & secrets > Client secrets > New client secret**. Copy
   the secret **Value**, not its ID, immediately to `MICROSOFT_CLIENT_SECRET`;
   Microsoft displays the value only once. Record its expiry and create an
   alert well before that date.

The delegated permission lets the app read/write the connected user's calendar
and is available to personal Microsoft accounts; see the official
[Graph permission reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
and [app-registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/howto-create-service-principal-portal).

Use `http://localhost:3000/api/calendar/callback` only on a separate development
registration or as an additional development redirect.

## 6. Cloudflare Turnstile

In **Cloudflare Dashboard > Turnstile**, create a production widget and restrict
its hostnames to `booktimewith.link` plus any real booking-domain aliases you
serve. Copy:

```text
TURNSTILE_SITE_KEY=the public sitekey
TURNSTILE_SECRET_KEY=the private secret key
```

Both values must be configured together. The site key is intentionally public;
the secret key must remain in Coolify. Use a separate widget or Cloudflare's
documented test keys for local/staging work. See the official
[Turnstile setup](https://developers.cloudflare.com/turnstile/get-started/)
and [hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/).

## 7. Stripe billing

Create and verify the Stripe account first. Build/test in a Stripe sandbox,
then repeat or copy the product to live mode. The app needs one monthly product
with four recurring prices matching its displayed amounts:

| Variable | Price |
|---|---:|
| `STRIPE_PRICE_GBP` | GBP 6.00/month |
| `STRIPE_PRICE_USD` | USD 8.00/month |
| `STRIPE_PRICE_EUR` | EUR 7.00/month |
| `STRIPE_PRICE_AUD` | AUD 12.00/month |

You can create the sandbox objects with the Stripe CLI. Install it, run
`stripe login`, and have `jq` available, then run:

```bash
PRODUCT_ID="$(stripe products create --name 'Book Time With' | jq -r '.id')"

STRIPE_PRICE_GBP="$(stripe prices create --product "$PRODUCT_ID" \
  --currency gbp --unit-amount 600 \
  -d 'recurring[interval]=month' | jq -r '.id')"
STRIPE_PRICE_USD="$(stripe prices create --product "$PRODUCT_ID" \
  --currency usd --unit-amount 800 \
  -d 'recurring[interval]=month' | jq -r '.id')"
STRIPE_PRICE_EUR="$(stripe prices create --product "$PRODUCT_ID" \
  --currency eur --unit-amount 700 \
  -d 'recurring[interval]=month' | jq -r '.id')"
STRIPE_PRICE_AUD="$(stripe prices create --product "$PRODUCT_ID" \
  --currency aud --unit-amount 1200 \
  -d 'recurring[interval]=month' | jq -r '.id')"

printf 'STRIPE_PRICE_GBP=%s\nSTRIPE_PRICE_USD=%s\nSTRIPE_PRICE_EUR=%s\nSTRIPE_PRICE_AUD=%s\n' \
  "$STRIPE_PRICE_GBP" "$STRIPE_PRICE_USD" "$STRIPE_PRICE_EUR" "$STRIPE_PRICE_AUD"
```

Stripe amounts use the currency's lowest unit, so GBP 6.00 is `600`. Review
the objects in Stripe before using them. Add `--live` to every creation command
only when you deliberately create the live objects. Stripe's official docs
cover [products and prices](https://docs.stripe.com/products-prices/manage-prices).

In Stripe live mode, open **Workbench/Developers > API keys**, reveal the live
secret key, and set it as `STRIPE_SECRET_KEY` (`sk_live_...`). This server-only
integration does not need a publishable key. Stripe documents test/live keys in
its [API-key guide](https://docs.stripe.com/keys).

Create a live webhook event destination for:

```text
https://booktimewith.com/api/billing/webhook
```

Subscribe to only these five events:

```text
checkout.session.completed
invoice.paid
invoice.payment_failed
customer.subscription.updated
customer.subscription.deleted
```

Reveal that endpoint's signing secret (`whsec_...`) and set it as
`STRIPE_WEBHOOK_SECRET`. A CLI listener has a different signing secret and is
only for local testing:

```bash
stripe listen \
  --events checkout.session.completed,invoice.paid,invoice.payment_failed,customer.subscription.updated,customer.subscription.deleted \
  --forward-to http://localhost:3000/api/billing/webhook
```

Copy the `whsec_...` printed by `stripe listen` into local
`STRIPE_WEBHOOK_SECRET`; never use it for the live endpoint. See Stripe's
official [webhook guide](https://docs.stripe.com/webhooks).

Finally enable Checkout's one-subscription limit/redirect and configure the
Customer Portal in the same Stripe mode.

## 8. Coolify environment

Add these non-secret production values:

```text
APP_URL=https://booktimewith.com
BOOKING_URL=https://booktimewith.link
PORT=3000
DATABASE_POOL_MAX=10
DATABASE_CONNECT_TIMEOUT_MS=10000
DATABASE_IDLE_TIMEOUT_MS=30000
TRUST_PROXY_HEADERS=false
EMAIL_FROM_DOMAIN=mail.booktimewith.com
```

In Coolify, disable **Build Variable** and leave **Runtime Variable** enabled
for these values. The application reads them at runtime; its Docker build does
not need credentials. This also avoids recording ordinary build arguments in
image metadata. See Coolify's official
[environment-variable guide](https://coolify.io/docs/knowledge-base/environment-variables).

Set `TRUST_PROXY_HEADERS=true` only after the origin is private and the trusted
edge strips/replaces client-provided forwarding headers. Add all acquired and
generated values from the sections above. Secret/private values are:

```text
DATABASE_URL
AUTH_TOKEN_SECRET
CRON_SECRET
RATE_LIMIT_SECRET
CALENDAR_TOKEN_SECRET
CLOUDFLARE_EMAIL_API_TOKEN
GOOGLE_CLIENT_SECRET
MICROSOFT_CLIENT_SECRET
TURNSTILE_SECRET_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

Cloudflare's account ID, OAuth client IDs, Turnstile's site key, Stripe price
IDs, canonical URLs, and the email from-domain are identifiers/configuration,
not credentials, but keeping them in the same Coolify environment is
convenient.

Configure these Coolify scheduled tasks against the running application
container. The production image includes `wget`:

```bash
# every 5 minutes
wget -qO- --header="Authorization: Bearer ${CRON_SECRET}" http://127.0.0.1:3000/api/cron

# every minute
wget -qO- --header="Authorization: Bearer ${CRON_SECRET}" http://127.0.0.1:3000/api/cron/auth-mail

# every minute
wget -qO- --header="Authorization: Bearer ${CRON_SECRET}" http://127.0.0.1:3000/api/cron/booking-mail
```

Recommended schedules are `*/5 * * * *`, `* * * * *`, and `* * * * *`.

## 9. Verify before accepting users

After redeploying, the health endpoint must return HTTP 200:

```bash
curl --fail-with-body https://booktimewith.com/api/health
```

Then complete the end-to-end provider checks in
[`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md). In particular, send a real magic
link and booking email, connect both calendar providers, force a Turnstile
challenge, and complete a Stripe sandbox subscription/webhook cycle before
switching Stripe to live values.
