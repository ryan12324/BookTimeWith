# Handoff: Book Time With — full product spec

## Overview

**Book Time With** (booktimewith.com) is deliberately minimal scheduling software for service businesses — therapists, coaches, consultants, contractors, tutors, and small practices of 2–10. The whole product is one booking link: the owner claims `booktimewith.link/handle`, paints weekly availability, and clients book a slot in three taps with **no account, ever**. The positioning is anti-feature: no CRM, no AI, no workflows. "The un-software for booking clients." Every product decision should be filtered through: *does this keep setup under 5 minutes and the settings on one page?*

Company is UK-based; default currency is GBP with localised pricing.

## About the Design Files

The `.dc.html` files in this bundle are **design references created in HTML** — interactive prototypes showing intended look and behavior, **not production code**. Your task is to recreate these designs in a Next.js + Tailwind codebase using the stack specified below. Open each file directly in a browser to explore it (they are self-contained with `support.js`).

## Fidelity

**High-fidelity.** Colors, typography, spacing, copy, and interaction states are final and should be recreated pixel-faithfully. All copy in the designs is final copy — the plainspoken, anti-hype voice ("No account needed. Ever.", "This is the whole setup. There is no step 4.") is part of the brand; do not paraphrase it.

The prototypes were drawn desktop-width, but **build mobile-first** — most clients open booking links from a text or Instagram bio on a phone. The Responsive section below defines how each screen adapts; where it's silent, stack single-column and keep tap targets ≥ 44px.

## Files

| File | Contents |
|---|---|
| `Book Time With — Landing.dc.html` | Marketing landing page (hero, "what we said no to", how it works, quote, pricing with currency switcher, footer CTA) |
| `Book Time With — Prototype.dc.html` | The app: owner onboarding (3 steps), client booking flow, owner bookings management, owner settings page, client manage-booking page. Tab bar switches the five views. |
| `Book Time With — Emails.dc.html` | All 8 transactional email designs (4 booking + 4 billing) with From/Subject lines |
| `support.js` | Runtime for the prototypes — reference only, not part of the product |

---

## Tech stack (required)

- **Next.js** (App Router, TypeScript) — deployed on Cloudflare Pages/Workers via `@opennextjs/cloudflare`, or Vercel if Cloudflare deploy fights back; email sending stays on Cloudflare either way
- **Tailwind CSS** — design tokens below go in the Tailwind theme
- **Stripe** — subscription billing (Checkout + Customer Portal + webhooks)
- **Cloudflare Email** — outbound transactional email via a Cloudflare Worker (Email Workers / MailChannels binding). All 8 templates in the emails design. React Email (or MJML) for authoring; render to HTML with inline styles
- Suggested additions (implementer's choice, keep it boring):
  - **Postgres** (Neon/Supabase) + **Drizzle** or Prisma; or Cloudflare D1 if staying all-Cloudflare
  - **Auth**: email magic-link only for owners (no passwords — fits the brand). Clients NEVER have accounts
  - **Zod** for validation, **date-fns-tz** for timezone math
  - **Google Calendar API + Microsoft Graph** for calendar sync; **CalDAV** for Apple (or ship Google/Outlook first, Apple later)
  - Cron (Cloudflare Cron Triggers) for reminders, morning summaries, trial-ending emails, Stripe retry notifications

## Domain architecture (security requirement)

Two domains, deliberately separated (GitHub .com/.io pattern, anti-phishing):

- **booktimewith.com** — marketing site + owner app (dashboard, settings, billing). Owner sessions/cookies live here only.
- **booktimewith.link** — user-generated content: public booking pages (`/handle`) and client magic-link manage pages. No owner cookies, no owner login surface on this domain. A malicious booking page must never be able to impersonate the product or steal an owner session.
- Changing a handle keeps a 301 redirect from the old handle for **90 days**.

---

## Screens / Views

### 1. Landing page (`Landing.dc.html`) — booktimewith.com

- **Nav**: serif wordmark `booktimewith` + gray `.com`; links: How it works, Pricing; ink button "Get your link".
- **Hero**: two-column grid (1.1fr / 0.9fr, 64px gap). Left: serif headline "The un-software for booking clients." (54px), subhead, claim-your-link input (`booktimewith.link/` prefix + handle) with "Claim it" button, microcopy "Live in 5 minutes · 30 days free, no card needed", and an editorial serif line: "**Five** minutes to set up. **One** settings page. **Zero** accounts for your clients — and zero features you'll never use." Right: a live booking-card demo with clickable time slots (selecting updates the CTA label).
- **"Everything we said no to" band** (dark ink background): ✕ list (CRM pipelines, AI receptionists, lead routing, marketing automations, gift cards & memberships, 40-question intake forms) then ✓ list (clients book time slots; calendar sync both ways; reminders that stop no-shows).
- **How it works**: "Set up in less time than a coffee break." — 3 numbered steps (01 claim link on its own domain, 02 mark when you work, 03 send the link).
- **Quote**: single testimonial, serif 25px.
- **Pricing**: "One price. Obviously." Single card: big serif price + currency switcher chips (GBP £6 default / USD $8 / EUR €7 / AUD A$12 — auto-detect region in production). Copy: "Everything, for everyone…" Footnote: "Starts with 30 days free. No credit card, no 'talk to sales', no feature grid — there aren't enough features to make a grid."
- **Footer CTA**: "Boring software that just works." + claim input again.

### 2. Owner onboarding (Prototype, tab 1) — 3 steps + done

Left step rail (220px) with live-updating subtitles; right panel (white card).

1. **Claim your link** — handle input with `booktimewith.link/` prefix; input sanitised to `[a-z0-9-]`; availability hint under it ("✓ booktimewith.link/dana is available" in bronze).
2. **Name your service** — service name input; **LENGTH**: a − / value / + stepper, 5-minute steps, clamp 15 min–4 hr, human-formatted ("50 min", "1 hr 30"); **WHERE**: two option cards — "Clients come to me" (reveals owner address input, note "Only shared after someone books.") / "I go to clients" (client will supply address at booking).
3. **Paint when you work** — weekly grid, columns MON–FRI (SAT/SUN added by a "We're open weekends" toggle switch; turning it off clears weekend cells). Rows default 8am–6pm; dashed "+ Start earlier (7am)" / "+ Finish later (6pm)" buttons extend one hour per click (bounds 5am–11pm). **Each hour cell is split into two half-hour halves**; click or drag-paint at 30-min granularity (mousedown starts add/remove mode by the first cell's state; mouseenter paints while held; mouseup anywhere ends). Summary "16.5 hours open per week". Bronze = open.
4. **You're live** — ✓ badge, summary line, copyable link, "See what clients see →".

Rail footer: "This is the whole setup. There is no step 4."

### 3. Client booking page (Prototype, tab 2) — booktimewith.link/handle

420px centered card. Header: avatar, owner name, "{Service} · {length}".

- **Pick**: 3 day tabs (with real dates) → slot grid (3 cols) filtered per day; selecting a slot fills the CTA "Book Tuesday at 10:00 →" (disabled gray "Pick a time" until selected). Microcopy: "No account needed. Ever."
- **Details**: summary chip with "change" link back; fields: name, email, **plus address iff owner chose "I go to clients"**. Confirm disabled until valid. Microcopy: "Two fields. That's the whole form."
- **Booked**: ✓ badge, "Booked.", summary, location line ("At {owner address} — address is in your confirmation." or "Dana comes to you: {client address}"), "Confirmation and a reminder are on their way to {email}."
- Footer under card: "powered by booktimewith.com".
- Slots must be computed from: painted availability − existing bookings − synced-calendar busy time − service length; timezone = client's local, displayed explicitly.

### 4. Owner bookings page (Prototype, tab 3) — booktimewith.com app

"Your bookings" + count. Grouped cards by day ("TODAY · TUESDAY 14"). Each row: time, client name, "{service} · {length}", and actions:

- **Move** → inline row of 3 alternative time chips + "never mind"; picking one marks the row "Moved to {time} · {FirstName} emailed".
- **Cancel** → row struck through, "Cancelled · {FirstName} emailed", with **Undo**.
- Footer note: "Move or cancel here and the client gets a polite email with your reason and available times — you never have to write it." (i.e. system-authored client emails on owner actions).

### 5. Owner settings (Prototype, tab 4) — ONE page, product promise

Header: "Settings" / "This is all of them." Single white card, sections divided by hairlines:

- **YOUR LINK** — handle input; note "Changing it redirects your old link for 90 days."
- **YOUR SERVICE** — name input, length stepper, where picker (+ address if "come to me").
- **YOUR HOURS** — same paintable grid as onboarding (weekends toggle, earlier/later, half-hours) with live summary.
- **CALENDAR** — disconnected: "Connect your calendar and busy time blocks itself — both ways." + provider buttons (Google Calendar, Outlook, Apple Calendar). Connected: status card "{Provider} connected — busy events block booking slots · bookings appear in your calendar" + Disconnect.
- **EMAILS TO YOU** — two toggles: "When someone books, reschedules or cancels" and "Morning summary of the day's appointments".
- **YOUR PLAN** — "£6 a month · free trial ends {date}" + "Manage billing" (→ Stripe Customer Portal) + "Delete account".
- Footer: "Changes save as you make them." (autosave, no Save button).

### 6. Client manage page (Prototype, tab 5) — booktimewith.link, magic link

Reached ONLY from the "Change or cancel" button in client emails — a signed, expiring token URL; no login. Same card chrome as booking.

- **View**: "YOUR BOOKING" summary card + "Pick a new time" (primary) + "Cancel booking" (secondary). Note: "Free to change until 24 hours before."
- **Reschedule**: banner "Moving your Tuesday 10:00 booking — keep it" + the same day/slot picker; CTA "Move to Wednesday at 2:00 →".
- **Moved**: ✓ "Moved." + "Dana's been told. A fresh confirmation is in your inbox."
- **Cancelled**: neutral "—" badge, "Cancelled. … Dana's been told." + "Book a new time instead".

---

## Transactional emails (all 8 in `Emails.dc.html`)

All emails share the layout: warm paper body (#faf8f4), serif headline, white detail card, buttons, footer strip. Client emails send **From: {Owner name} via booktimewith.com**; system/billing emails **From: booktimewith.com**. Every client email includes the magic manage link. Attach `.ics` to confirmation emails.

**Booking set**
1. **Client confirmation** (on booking) — "You're booked, {name}." Detail card, "Add to calendar" + "Change or cancel", reassurance copy about changing plans.
2. **Client reminder** (24h before) — "See you tomorrow at {time}." Join-video-call button in card (when virtual), "Change or cancel" + "Free until 24 hours before".
3. **Owner new booking** — "{Client} booked you." Details + client email; Reschedule / Cancel buttons; "It's already on your calendar…" note.
4. **Owner morning summary** (morning of, if enabled) — "Tuesday: three sessions." List of time/client/service rows; "Open your day"; "Everyone's been reminded already".

**Billing set**
5. **Trial ending** (7 days before) — value recap ("your link has taken 14 bookings"), "Add a card — £6/mo", honest do-nothing consequence: page pauses, link + settings kept 90 days.
6. **Receipt** (monthly) — "Paid. Nothing to do." Amount card (VAT included), "Download invoice (PDF) — for your accountant".
7. **Payment failed** — "Your card didn't go through." **14-day grace**, page keeps working, retry dates listed, "Update card".
8. **Cancelled** — "Done — you're cancelled." Runs to paid-through date, bookings/reminders still honoured, "Export your bookings (CSV)", 90-day retention then real deletion.

**Not designed yet — write in the same voice and layout:**
9. **Owner sign-in magic link** — owners have no passwords; this is the login. "Here's your sign-in link." One button, 15-minute expiry, plain footer.
10. **Owner: client rescheduled/cancelled** (variant of #3) — "{Client} moved to Thursday at 2:00." / "{Client} cancelled Tuesday." Respects the notifications toggle.
11. **Client: owner moved/cancelled your booking** — the system-written "polite email" promised on the bookings page: apology tone, owner's reason if given, and for cancels a "Pick a new time" button with live availability.
12. **Welcome** (on signup) — restating the 3 steps and the trial terms. No onboarding drip sequence — one email is the brand.

## Billing rules (Stripe)

- One plan. **Localised pricing**: £6 GBP (default), $8 USD, €7 EUR, A$12 AUD — Stripe multi-currency prices on one product; detect region, let user switch.
- Per person per month for teams (2–10 seats), quantity = seats.
- **30-day trial, no card required** (`trial_period_days`, collect card later via trial-ending email → Checkout).
- Dunning: Stripe Smart Retries mapped to the 14-day grace period; page pauses (booking page shows a gentle "not taking bookings right now" state) only after grace expires. Nothing deleted.
- Cancellation: `cancel_at_period_end`; 90-day data retention post-expiry, then hard delete.
- Webhooks: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted/updated` → drive emails 5–8 and page state.

## Data model (suggested)

- `owners` — id, email, name, handle (unique, + `handle_redirects` with expiry), timezone, notification prefs (book/reschedule/cancel, morning summary), stripe_customer_id, plan status, trial_ends_at
- `services` — owner_id, name, duration_minutes (15–240, step 5), location_mode (`mine`|`theirs`), owner_address
- `availability` — owner_id, weekday (0–6), start/end at 30-min granularity (store painted half-hour blocks; UI bounds 05:00–23:00; weekend flag implicit in data)
- `bookings` — id, owner_id, service_id, starts_at (UTC), client_name, client_email, client_address?, status (`confirmed`|`moved`|`cancelled`), manage_token (signed/expiring), audit of who moved/cancelled (owner vs client)
- `calendar_connections` — owner_id, provider, oauth tokens, sync state
- `email_log` — idempotency for cron sends
- `away_periods` — owner_id, start_date, end_date
- `login_tokens` / `manage_tokens` — hashed, single-use, expiring (owner sign-in 15 min; client manage links live until the appointment ends, refreshed in each new email)

## Interactions & behavior notes

- Drag-paint: pointer events; mousedown sets paint mode from target's current state, mouseenter applies while active, global mouseup ends. Support touch.
- Autosave settings (debounced), optimistic UI.
- All destructive/notifying actions confirm inline (strikethrough + Undo pattern), never modal-heavy.
- Reminder cron: client reminder at T-24h; owner morning summary at 7am owner-local; skip if disabled.
- 24-hour reschedule/cancel cutoff enforced on client manage page (owner can always override from their bookings page).

## Responsive / mobile-first (required)

Tailwind mobile-first breakpoints; design for 375px first, enhance at `md`/`lg`. Tap targets ≥ 44px everywhere (slot chips, day tabs, toggles, grid cells).

- **Client booking + client manage (most important — phone is the primary device)**: the 420px card is already phone-shaped — render it full-width edge-to-edge (no card border below `sm`, paper background is the page), sticky bottom CTA ("Book Tuesday at 10:00 →") so the confirm button is always thumb-reachable, day tabs horizontally scrollable if more days are added, inputs `font-size ≥ 16px` to prevent iOS zoom.
- **Landing**: hero collapses to single column (headline → claim input → booking-card demo); "what we said no to" grid → single column; pricing card stacks price above copy; nav collapses to wordmark + "Get your link" (no hamburger — there are only two links, inline them in the footer).
- **Owner onboarding**: step rail becomes a horizontal progress strip above the panel (numbers + current title only); panels full-width.
- **Availability grid on touch**: half-hour drag-painting must work with touch events (pointer events + `touch-action: none` on the grid); on narrow screens show 5 weekday columns compressed (they fit at 375px with 4px gaps) and let the earlier/later buttons handle vertical growth; weekend toggle adds columns — allow horizontal scroll of the grid only if 7 columns can't fit.
- **Owner bookings**: rows keep time/name left; Move/Cancel actions stay inline (they're small text buttons); inline move-chips wrap.
- **Settings**: already single-column — sections just lose horizontal padding.
- **Emails**: single-column 600px max-width tables; they already stack — test at 320px in Gmail/Apple Mail.

## Scheduling engine rules (implied by the designs, spell them out in code)

- **Slot generation**: painted half-hour availability − confirmed bookings − synced-calendar busy events, stepped by service length; slot start times snap to 30-min marks.
- **Min notice**: no booking less than N hours ahead (default 4h, owner-tunable later — hardcode default for v1). **Horizon**: bookable up to 60 days out.
- **Race protection**: unique constraint on (owner, starts_at) + transactional slot re-check on confirm; the second booker gets a friendly "that time just went — here's what's still open".
- **Timezones**: availability is stored in the owner's timezone; slots render in the client's local timezone with the zone named explicitly on the booking page ("Times in London (BST)" if they differ). DST transitions must not shift painted hours.
- **Time off**: a weekly grid can't say "I'm away the first week of August". Add a minimal **"Away" control** on the bookings page (date-range picker, blocks all slots, one line of copy: "Away 3–10 Aug · clients see nothing available"). Keep it one control — no half-day rules, no recurring holidays.
- **Video calls**: where the reminder's "Join video call" link comes from — auto-created Google Meet when Google Calendar is connected; otherwise an optional "meeting link" field on the service (owner pastes their static Zoom/Meet URL). No native video.
- **Reserved handles**: block `www`, `api`, `admin`, `help`, `billing`, `mail`, profanity list; minimum 3 chars.
- **Handle availability check**: live endpoint driving the "✓ … is available" hint as the owner types (debounced).

## Public booking page extras

- **SEO/OG**: each `booktimewith.link/handle` page gets title "Book time with {Owner}", OG image generated from name + service (paper background, serif type — match tokens), `noindex` optional per owner later.
- **States**: paused (grace expired / trial lapsed) → "{Owner} isn't taking bookings right now."; away → normal page, no slots, "Nothing available in the next few weeks."; cancelled-owner after 90 days → 404.
- **Anti-abuse**: rate-limit bookings per IP/email, disposable-email blocklist, Turnstile (Cloudflare) only when rate limits trip — never a visible CAPTCHA on the happy path.
- **Add to calendar**: Google/Outlook deep links + downloadable `.ics` on the booked screen, not just in email.

## Design tokens (→ Tailwind theme)

Fonts (Google Fonts): **Source Serif 4** (display/serif, weights 400/600) · **Libre Franklin** (UI/body, 400–700).

| Token | Value | Use |
|---|---|---|
| `paper` | `#faf8f4` | page/app background |
| `paper-dim` | `#f0ede6` | app canvas background |
| `paper-tint` | `#f3efe7` / `#f7f3ea` | selected-day bg, hover, selected option bg |
| `ink` | `#26221c` | text, primary buttons, selected slots |
| `ink-soft` | `#3d372e` | primary button hover; dark-section hairlines |
| `body` | `#6b6357` | secondary text |
| `faint` | `#a89f90` | tertiary text, placeholders |
| `bronze` | `#8a7a5c` | accent: confirm CTAs, painted cells, ✓ badges, links |
| `bronze-hover` | `#776a50` | bronze button hover |
| `line` | `#ddd5c8` | input/card borders |
| `line-soft` | `#e6dfd3` / `#efe9de` | card borders, hairline dividers |
| `disabled` | `#d6cdbc` | disabled CTA bg, toggle-off track |
| dark section text | `#d6cdbc` on `#26221c` | landing dark band |

Radii: inputs/buttons 6–7px, cards 10–12px, chips/day tabs 7px, grid cells 4px, pills 999px. Shadows: cards `0 12px 32px rgba(38,34,28,.06)`, floating booking card `0 16px 44px rgba(38,34,28,.09)`. Section labels: 11–11.5px Libre Franklin 600, letter-spacing .06em, uppercase, `faint`. Toggle: 30×17px track, 13px knob, bronze when on. Avatar placeholder: repeating 45° stripes `#e6dfd3`/`#efe9de` (replace with real upload in production).

## Assets

No image assets — avatars are striped placeholders (owner photo upload is a real feature to build). Wordmark is set in Source Serif 4, no logo file yet.

## Compliance & operations (UK company)

- **GDPR/UK GDPR**: client PII (name, email, address) held on behalf of owners — privacy policy, DPA for owners, data export (the bookings CSV doubles as this), hard delete on request and after the 90-day retention window. "Delete account" in settings must actually cascade.
- **Stripe Tax** for VAT (prices are VAT-inclusive per the receipt email); invoices must be VAT invoices.
- **Email deliverability**: send from a subdomain (`mail.booktimewith.com`), SPF/DKIM/DMARC configured on Cloudflare; client-facing From is "{Owner} via booktimewith.com" with Reply-To set to the owner's real email so replies go to the owner, not us.
- **Accessibility**: full keyboard path through booking (day tabs → slots → form → confirm), visible focus states (bronze outline per tokens), grid painting needs a keyboard alternative (arrow keys + space toggles half-hours), WCAG AA contrast (`faint` #a89f90 on paper is decorative-only — never for essential text).

## Team plan (phase 2 — designed only on the landing page)

Landing pricing promises "solo or a practice of ten": one booking page for the practice, clients pick a person **or** just a time (first available). Per-seat billing already covered in Stripe rules. No prototype exists — design before building; do not invent UI beyond this.

## Out of scope (deliberately — do not add)

CRM, intake form builder, payments-for-bookings, packages/memberships/gift cards, AI features, multi-service menus beyond "add another service later", per-client accounts, native apps. If a feature needs a second settings page, it's out.
