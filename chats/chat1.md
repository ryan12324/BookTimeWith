# Simple scheduling for service businesses

_Started 2026-07-08 16:08 UTC_

---

## User

Small business owners and freelancers are drowning in overly complex scheduling software packed with features they'll never use, making it harder to actually book appointments instead of easier. The problem matters because every extra feature adds confusion, steeper learning curves, and higher costs — when people just need something that lets clients book time slots without friction. This frustration hits service-based businesses hardest: therapists, consultants, coaches, and contractors who'd rather spend time serving clients than learning enterprise software. The founder found real traction by stripping everything away and focusing on one job done well, which suggests there's genuine demand for boring, simple tools that just work.

## Assistant

_[tool: questions_v2]_

## User

Questions answered:
- deliverable: Landing page for the product, Interactive prototype of the booking app, Pitch deck around this problem
- product_name: Book Time With

domain booktimewith.com
- context: No — start fresh
- audience: Solo service pros (therapists, coaches), Small teams (2–10 people)
- vibe: Explore a few options
- color_tone: Explore a few options
- scope: Client booking a slot, Owner setting up availability
- variation_focus: Visual style, Layout / structure, UX / interaction ideas, Mix of everything
- copy_tone: Decide for me
- anything_else: do some research on competitors

## Assistant

_[tool: update_todos]_

_[tool: read_skill_prompt]_

_[tool: web_search]_

_[tool: dc_write]_

_[tool: web_search]_

_[tool: update_todos]_

_[tool: ready_for_verification]_

Three directions are up, each with a landing hero + client booking slice:

- **1a** Calm & utilitarian — warm paper, serif headline, "nothing to learn"
- **1b** Sharp Swiss — mono specs table ("features you won't use: 0"), one blue signal
- **1c** Warm & human — rounded, soft green, friendly copy

Pick one (or a mix) and I'll build the full landing page, then the booking + setup prototype, then the deck.

## User

1a i like the language on 1b though

## Assistant

Building the full landing page: 1a's warm paper + serif visuals, 1b's blunt anti-feature copy voice.

_[tool: dc_write]_

_[tool: update_todos]_

_[tool: ready_for_verification]_

Full landing page is up — 1a's warm paper + serif, 1b's voice throughout: "un-software" hero with the mono specs table, a "what we said no to" section, 3-step setup, one quote, two-price pricing ("There aren't enough features to make a grid"). Hero time slots are clickable, and the demo handle is tweakable.

Next: the booking + availability-setup prototype, then the deck — say go, or tweak this first.

## User

dont like th emono

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: grep]_

_[tool: grep]_

_[tool: grep]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

All mono type replaced with Libre Franklin (letterspaced caps for the specs table, section numbers, and pricing labels). Ready for the prototype and deck whenever you are.On-brand fix: everyone pays, but the trial is generous and honest — Solo becomes $6/mo with 30 days free, no card upfront.

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: grep]_

_[tool: grep]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Pricing now makes money: Solo is $6/mo ("less than one no-show costs you"), Team stays $8/person, and everything starts with a 30-day free trial — no card, no "talk to sales." Hero got a matching "30 days free" line.

## User

reframe the wierd table it doesnt fit with the design

## Assistant

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

The table is now an editorial serif line — "**Five** minutes to set up. **One** settings page. **Zero** accounts for your clients…" — matching the rest of the design's voice.

## User

even simpilar. just one price

## Assistant

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

One price: $8/person/mo, everything included, 30 days free. Single card, no plans to compare.

## User

need localised pricing

## User

Live before your coffee is. is wierd phrasing

## User

Live before your coffee is. is wierd phrasing

## Assistant

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Changed to "Set up in less time than a coffee break."

## User

we need a none phishable domain as the users domain i think..

## Assistant

Good instinct — same pattern as GitHub (github.com vs github.io): user pages live on a separate domain so a malicious booking page can never impersonate the product or share its cookies. `booktimewith.me` keeps the sentence-read ("book time with .me/dana" ≈ "book time with Dana") while `.com` stays the app.

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

User booking links now live on `booktimewith.me/yourname` — a separate domain from the `.com` app, so user pages can't impersonate the product. The nav wordmark still shows `.com` as the product domain; happy to adjust if you'd rather brand around `.me`.

## User

we cant get .me

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Switched to `booktimewith.page` — reads naturally as "your booking page," it's an HTTPS-only TLD, and stays clearly distinct from the `.com`. (`booktimewith.link` is a decent backup if `.page` is taken.)

## User

use .link then continue with everything else

## Assistant

_[tool: dc_html_str_replace]_

_[tool: read_skill_prompt]_

Domain switched to `.link`. Now the prototype — client booking flow + owner setup in one file.

_[tool: dc_write]_

_[tool: ready_for_verification]_

Prototype is up. Now the deck.

_[tool: copy_starter_component]_

_[tool: dc_write]_

_[tool: update_todos]_

_[tool: ready_for_verification]_

All three deliverables are done, all on `.link` and the 1a aesthetic:

- **Landing** — updated to booktimewith.link
- **Prototype** — owner setup (claim link → name service → paint weekly hours with drag) and client booking (day → slot → two-field form → confirmed); the handle/service you set flow through to the client view
- **Deck** — 9 slides: problem → who it hurts → competitor gap → product → what we deleted → £6 pricing → why now → close, with speaker notes

Caveat: deck traction stays qualitative (no invented numbers). Next steps if useful: real photography for the avatar placeholders, PPTX/PDF export of the deck.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Fixed: booking-card text bumped to 24px, and step 01 no longer wraps — the 01/02/03 rhythm holds.

## User

Booking confirmation email + ability to change it. + reminder email (for client + owner)

## Assistant

_[tool: dc_write]_

_[tool: ready_for_verification]_

Four emails, one system:

- **Client — confirmation**: booking card, add-to-calendar, and a "Change or cancel" magic link (no account, matching the booking flow)
- **Client — 24h reminder**: join-call button + same change/cancel
- **Owner — new booking**: client details, reschedule/cancel ("Alex gets a polite email with your available times — you never have to write it")
- **Owner — morning of**: today's schedule at a glance

Each shows its From/Subject line. Want the reschedule flow itself (what the client sees after tapping "Change or cancel") added to the prototype?

## User

prototype needs a we are open weekends button

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Added a "We're open weekends" toggle above the availability grid — switching it on adds SAT/SUN columns you can paint; switching it off clears any weekend hours.

## User

we need a client comes to me or i go to client option which then does the obvious

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Added a WHERE choice in setup step 2 — "Clients come to me" (with an address field, only shared after booking) or "I go to clients." The obvious follows through: the second option adds a "Your address" field to the client's booking form, and the confirmation screen shows the right location either way.

## User

and then rethink how LENGTH works. to be simpilar but more open to lengths

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

LENGTH is now a single stepper — one control, any length from 15 min to 4 hr in 5-minute steps, displayed human-style ("50 min", "1 hr 30"). The length flows through everywhere (rail, live summary, client's booking page).

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Each hour block now splits into two half-hour halves — click or drag paints at 30-minute granularity, and the summary counts halves ("16.5 hours open per week").

## User

some people might start before 8 and finish after 6??

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

The grid now grows on demand: "+ Start earlier (7am)" above and "+ Finish later (6pm)" below extend the day an hour per click (down to 5am, up to 11pm) — so the default stays compact and early birds/night owls just tap to reveal what they need.

## User

can we create the settings page for owners and the client page for when they manage

## Assistant

_[tool: read_file]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Two new tabs in the prototype:

- **3 · Your settings** — literally one page ("This is all of them."): link (with 90-day redirect note), service + length + where, the full hours grid, two email toggles, and plan/billing with trial date
- **4 · Client manages** — the no-login page from the email's "Change or cancel": view booking → pick a new time (full reschedule picker) or cancel, each with its "Dana's been told" confirmation

Settings shares live state with setup — change the service name there and it updates everywhere.

## User

settings needs link with calendar

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Added a CALENDAR section to settings — connect Google Calendar, Outlook, or Apple Calendar; once connected it shows the two-way sync status ("busy events block booking slots · bookings appear in your calendar") with a quiet Disconnect.

## User

we need all the billing emails too.

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

_[tool: dc_html_str_replace]_

Added the four billing emails below the booking set, all in the same honest voice:

- **Trial ending (7 days out)** — shows the value ("14 bookings"), one button, and what happens if you do nothing (page pauses, kept 90 days)
- **Monthly receipt** — "Paid. Nothing to do." + PDF invoice for the accountant
- **Payment failed** — "no rush": 14-day grace, retry dates, clients notice nothing
- **Cancelled** — runs to the paid date, CSV export, 90-day grace then proper deletion

## User

also we need a my bookings page where the owner can manage all that stuff too

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

New **3 · Your bookings** tab (tabs renumbered to five): upcoming appointments grouped by day, each row with **Move** (inline picker of alternative times) and **Cancel** (strikethrough + Undo). Every action notes "client emailed" — the polite email is written for you, tying into the emails set.

## User

we need a full project spec including all the features. we want to build with next.js, cloudflare email sending, stripe for billing, tailwind css, and anything else you think we need. We are going to export this to claude code

## Assistant

_[tool: read_skill_prompt]_

_[tool: copy_files]_

_[tool: write_file]_

_[tool: present_fs_item_for_download]_

Handoff package is ready above — README spec (all screens, the 8 emails, Stripe billing rules with trial/dunning/localised pricing, Cloudflare email architecture, the .com/.link security split, data model, Tailwind token table, and an explicit "do not add" list) plus the three design files as high-fidelity references.

Point Claude Code at `design_handoff_booktimewith/README.md`. Want screenshots of each screen included in the bundle too?

## User

look through the Readme and add any missing features

## Assistant

_[tool: read_file]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: present_fs_item_for_download]_

Updated bundle above. The README now covers the gaps I found — 4 more emails (sign-in magic link, owner notified of client changes, the system-written "polite email" to clients, welcome), scheduling engine rules (min notice, horizon, race protection, DST, time-off/"Away" control, video-link source, reserved handles), booking-page states (paused/away), anti-abuse, GDPR + Stripe Tax + deliverability, accessibility, team plan flagged as phase 2 — plus a full **mobile-first section**: 375px-first, 44px targets, sticky bottom CTA and edge-to-edge card on the client flow, touch drag-painting, and per-screen stacking rules.

One honest caveat: the prototypes themselves are still desktop drawings — if you want, I can redraw the client booking flow in a phone frame so Claude Code has a visual reference for the mobile layout, not just the written rules.

