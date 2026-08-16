# Voice Forge Studios — with live ElevenLabs generation

This is the Voice Forge Studios site wired up to the real ElevenLabs API.
The key rule: **the ElevenLabs key never touches the browser.** The page
only ever talks to this small server (`server.js`), and the server is the
only thing that holds the key and calls `api.elevenlabs.io`.

## Run it

1. Make sure you have Node.js 18+ installed.
2. In this folder, install dependencies:
   ```
   npm install
   ```
3. Open `.env` and put in your own ElevenLabs API key (Settings → API Keys
   in your ElevenLabs dashboard). If you were previously using a key that
   got shared anywhere outside your own machine, treat it as exposed and
   generate a fresh one instead.
4. Start the server:
   ```
   npm start
   ```
5. Open `http://localhost:3000` in your browser. The "AI Voice Generator"
   panel will load your real voices and generate real audio previews.

## Email notifications for new bookings

When someone books a session, the server can email you the details automatically.
This is optional — leave the SMTP fields in `.env` blank and bookings will
still save normally, just without an email.

To enable it, fill in these fields in `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password_here
NOTIFY_EMAIL=owner_email@example.com
```

- `SMTP_USER` / `SMTP_PASS` — the account the email gets *sent from*.
- `NOTIFY_EMAIL` — the address that *receives* the booking alert (can be the same address, or different).
- **If using Gmail:** you can't use your normal Gmail password here — Google
  requires an "App Password." Turn on 2-Step Verification on the Google
  account, then go to myaccount.google.com → Security → App Passwords,
  generate one, and use that as `SMTP_PASS`.
- **Using Outlook, Yahoo, or a work email instead?** Same idea — just swap
  `SMTP_HOST` (e.g. `smtp.office365.com`) and use that provider's SMTP
  password or app password.
- Restart the server (`Ctrl+C` then `npm start`) after editing `.env` —
  it's only read at startup.

If the email fails to send for any reason, the booking itself still saves
successfully — check the server terminal for a logged error if emails
aren't arriving.

## Login / accounts

Clicking "LOGIN" in the nav goes to `/login`, where people can sign up or
log in. Once logged in, the nav button becomes their first name and links
to `/account`, which shows the bookings tied to their email address.

- Passwords are hashed with bcrypt before being stored — never saved in plain text.
- Accounts are stored in `data/users.json` (same file-based pattern as bookings/messages — fine for local testing, not a real production setup).
- Sessions are cookie-based and last 7 days. Set `SESSION_SECRET` in `.env` to any long random string — this signs the session cookie, so a real value matters even for local testing if you don't want sessions to be easily forgeable.
- **Note:** sessions currently live in server memory, so restarting the server logs everyone out. Fine for local dev; a real deployment would want a persistent session store (e.g. `connect-pg-simple`, Redis) instead.

### Forgot password

"Forgot your password?" on the login page sends a reset link valid for 1 hour.

- If SMTP is configured (see the email section above), the link is emailed to the account's address.
- **If SMTP is not configured**, the reset link is printed to your server terminal instead, so you can still test the flow locally without setting up email.
- `APP_BASE_URL` in `.env` controls what domain the reset link points to — defaults to `http://localhost:3000`. Change this if you deploy somewhere with a real domain.
- The reset endpoint always responds with success whether or not the email exists, so it can't be used to check who has an account.

## Admin dashboard

`/admin` shows every booking and contact/quote message submitted through
the site — separate from customer logins entirely, protected by a single
shared password.

- Set `ADMIN_PASSWORD` in `.env` to something only you know.
- Log in at `/admin-login`.
- **Bookings tab**: every booking, with a status dropdown (Pending → Confirmed → Completed, or Cancelled) you can update on the spot.
- **Messages tab**: every contact form and "email me this quote" submission, with a read/unread toggle. The badge on the tab shows the unread count.
- This is a single admin password, not a full admin-user system — anyone with the password has full access. Fine for a one-person studio; if you ever have multiple staff who need different access levels, this would need to grow into a real role-based system.

## Formspree (secondary notification channel)

Contact form submissions, "email me this quote" requests, and new
bookings all also get sent to Formspree (endpoint `xdenabjo`), in
addition to your own backend. This runs alongside everything above —
it doesn't replace the admin dashboard, availability checking, or your
own data files, which all keep working exactly as before.

- **First submission:** Formspree requires you to confirm the connected
  email address the first time a submission comes in — check your inbox
  (including spam) after testing this for the first time, or nothing
  will show up until you confirm.
- Free Formspree plans have a monthly submission cap — worth checking
  Formspree's dashboard if notifications seem to stop arriving.
- If you decide you don't want this later, it's safe to remove: delete
  the `<script src="formspree.js"></script>` tags and the
  `submitToFormspree(...)` calls in `contact.js`, `quote.js`, and the
  inline script in `index.html`, plus `sendBookingToFormspree(...)` in
  `server.js`.

## SEO

Every public page (Home, Pricing, About, Portfolio, Contact, AI Voices)
now has a meta description, keywords, canonical link, and Open
Graph/Twitter card tags — so links shared on social media or iMessage
show a proper preview card instead of a bare URL.

- **Update the domain before deploying.** All of this currently uses a
  placeholder domain: `https://www.voiceforgestudios.com`. Once you have
  your real domain, find-and-replace that string across every `.html`
  file, `robots.txt`, and `sitemap.xml` — search your editor across the
  whole `public/` folder for `voiceforgestudios.com` and swap it.
- The social preview image is `images/logo-full.png` (the square
  black-background version) — swap that file if you want a different
  preview image later.
- Private/utility pages (`login`, `account`, `reset-password`, `admin`,
  `admin-login`) are marked `noindex, nofollow` and blocked in
  `robots.txt` — they intentionally don't show up in search results.
- `robots.txt` and `sitemap.xml` are static files in `public/`, served
  automatically — no server code needed for those two.

## Audio Editor

A fifth tab on the Tools page — runs entirely in the browser via the Web
Audio API, no server calls involved in the editing itself:

- Upload any audio file, or click the "send to editor" button that now
  appears next to results from the Voice Generator, Cloning, Dubbing, and
  Cleanup tools, to edit them directly without downloading and
  re-uploading.
- Click-drag on the waveform to select a region, then **Trim to
  Selection** or **Delete Selection**. A plain click (no drag) seeks
  playback there instead.
- **Fade In / Fade Out** — applies over the current selection if one
  exists, otherwise a default 1-second fade at the start/end of the clip.
- **Normalize** scales the loudest peak up to just under 0dB.
- A volume slider (±24dB) with an explicit "Apply" step, so adjusting it
  doesn't commit until you're sure.
- Full **undo/redo** — every edit is a new snapshot, never a mutation of
  a previous state, so undo always restores exactly what was there before.
- **Download** exports a 16-bit PCM WAV file, encoded by hand in
  JavaScript (the Web Audio API has no built-in encoder).

### Effects

Four effects, each rendered via `OfflineAudioContext` (a real Web Audio
signal graph, not just sample math) and applied to the whole clip:

- **Echo** — adjustable delay time and number of repeats (feedback amount).
- **Reverb** — algorithmic, using a synthetically generated impulse
  response (decaying noise) rather than a recorded sample — adjustable
  room size (decay length) and wet/dry mix.
- **Chorus** — an LFO-modulated delay line for a thickened, doubled-voice
  effect. Fixed parameters, one-click.
- **Telephone/Lo-Fi** — a band-pass filter (300Hz–3.4kHz, the classic
  phone-line range) plus light waveshaper saturation for grit. Fixed
  parameters, one-click.

Rendering happens asynchronously — the button disables and shows
"RENDERING…" while it works, since a reverb tail on a longer clip can take
a moment. Every effect application is its own undo/redo step, same as
trim/fade/normalize.

Since this is 100% client-side, it doesn't count against any of the
daily usage limits or credits — it's free and unlimited regardless of
plan.

## Tools billing: Pro subscription, credit packs, saved clones

The Tools page is now a real product with three ways to pay, all on top
of Stripe (same integration as booking payments):

### 1. Tools Pro subscription
- `$15/mo` (set via `PRO_MONTHLY_PRICE_CENTS`) — raises daily limits on
  all three tools (defaults: 20 clones/day, 15 dubs/day, 40 cleanups/day
  vs. 3/3/5 on Free — adjust via the `*_PRO` env vars).
- "Upgrade to Pro" in the Tools page billing panel starts a Stripe
  subscription checkout. Confirmed the same way booking payments are —
  verified directly against Stripe on return, not just trusted from the
  redirect.
- "Cancel Subscription" cancels with Stripe immediately and drops the
  account back to Free-tier limits right away (no proration handling —
  keep that in mind if you want prorated refunds, which this doesn't do).

### 2. Credit packs (pay-per-use, no subscription)
- Once someone's daily free allotment for a tool is used up, purchased
  credits kick in automatically as a fallback — no need to wait for a
  subscription decision.
- Defaults: 5 clone credits/$12, 10 dub credits/$15, 15 cleanup
  credits/$10 — adjust via `CLONE_PACK_PRICE_CENTS`,
  `DUB_PACK_PRICE_CENTS`, `CLEANUP_PACK_PRICE_CENTS` (pack sizes
  themselves are set directly in `CREDIT_PACKS` in `server.js`).
- Credits never expire and stack with Pro — a Pro subscriber who
  somehow blows through even the higher daily limit can still buy
  credits as extra overflow.

### 3. Permanently save a voice clone — $19 one-time
- Cloned voices are temporary by default (deletable, and they count
  against your ElevenLabs account's voice slot limit either way).
  Paying to "save" one just means the site remembers it for that user
  going forward — it doesn't change anything on ElevenLabs' side, since
  the clone already exists there the moment it's created.
- Saved clones show up under "My Saved Voices" in the Cloning tab, ready
  to generate speech from anytime without re-uploading samples or
  re-cloning.

### How usage tracking works now
`checkAndConsumeUsage()` in `server.js` tries the daily plan allotment
first, and only falls back to purchased credits once that's exhausted —
so Free-tier users who buy credits still get their daily free uses
first each day, credits are just the overflow.

### What this doesn't do yet
- **No webhooks** — same caveat as booking payments. Confirmation
  relies on the success-page redirect; a closed tab right after paying
  could leave something unconfirmed. A production deployment should add
  Stripe webhooks as a backup.
- **No proration** on subscription cancellation — cancelling drops
  someone to Free immediately regardless of when in their billing cycle
  they cancel.
- **No usage analytics/reporting** beyond what's visible per-user — if
  you want to see aggregate revenue or usage trends across all users,
  that'd need to be built on top of the Stripe dashboard or the raw
  data files.

## Real payment at booking (Stripe)

Booking a session now actually collects payment — here's the flow and
what you need to know before using it for real.

### Setup

1. Create a free Stripe account, then get a **test-mode** secret key from
   https://dashboard.stripe.com/test/apikeys (starts with `sk_test_`).
2. Put it in `.env` as `STRIPE_SECRET_KEY`.
3. `npm install` (adds the `stripe` package).
4. Test with Stripe's test card: `4242 4242 4242 4242`, any future
   expiry date, any 3-digit CVC, any ZIP.
5. When you're ready for real payments, switch to a **live** secret key
   (starts with `sk_live_`) — everything else works the same.

### How it works

- Prices are computed **server-side** from the project type, script
  length, and delivery time selected in the booking form — never trusted
  from the browser, so nothing can be tampered with before charging.
- Picking a date/time and filling in details shows a price preview, then
  hitting "Confirm & Pay" redirects to a Stripe-hosted checkout page —
  card details never touch this server directly.
- The booking is created immediately as **pending** (holding that time
  slot) the moment checkout starts, but only becomes **confirmed** — and
  only then do you get the booking notification email — once payment
  actually completes. This is verified directly against Stripe's API on
  return, not just trusted from the redirect URL.
- **Abandoned checkouts auto-release the slot.** If someone starts
  checkout and closes the tab without paying or cancelling, that pending
  hold stops blocking the slot after 15 minutes (`PENDING_HOLD_MINUTES`
  in `server.js`) — so a slot can't get stuck forever from someone who
  never finished paying.
- **Custom Take** bookings have no fixed price and skip payment
  entirely — they save as a pending booking for you to follow up with a
  manual quote, exactly like bookings worked before Stripe was added.
- `DEPOSIT_PERCENT` in `.env` controls how much gets charged upfront —
  `100` (default) charges the full price now, `50` charges half as a
  deposit with the rest presumably collected separately/in person.

### What this doesn't do yet

- **No webhooks.** Payment confirmation currently relies on the
  success-page redirect calling `/api/bookings/confirm`, which verifies
  directly with Stripe — this works for the normal flow, but if someone
  pays and then closes the browser tab before the redirect finishes
  loading, that booking could stay stuck as unpaid/pending even though
  Stripe successfully charged them. For a real production deployment,
  add a Stripe webhook (`checkout.session.completed`) as a backup
  confirmation path — that requires a publicly reachable HTTPS URL,
  which is why it's not included for local development.
- **No refunds UI.** Cancelling a booking in the admin dashboard just
  changes its status — it does not issue a Stripe refund. Refunds
  currently have to be done manually in the Stripe dashboard.
- Pricing is a flat estimate based on project type/length/delivery — it
  doesn't account for anything unusual about a specific project. Keep
  the numbers in `BOOKING_BASE_PRICE` (in `server.js`) in sync with
  whatever you actually want to charge.

## Daily usage limits (cloning, dubbing, cleanup)

Since these three tools cost real ElevenLabs credits per call, each
logged-in user gets a daily cap, tracked in `data/tool-usage.json` and
reset automatically at midnight:

```
DAILY_LIMIT_CLONE=3
DAILY_LIMIT_DUB=3
DAILY_LIMIT_CLEANUP=5
```

- Enforced server-side (`checkAndConsumeUsage` in `server.js`) — the
  frontend also shows "X of Y used today" next to each tool and disables
  the button at the limit, but that's just UX; the real enforcement is
  the 429 response from the server, so it can't be bypassed by editing
  the page.
- Quota is consumed on *attempt*, not just success — so retrying a
  failed call still counts against the limit. This is deliberate: it's
  the simplest way to stop someone from hammering a broken request in a
  loop to bypass the cap.
- Change the numbers in `.env` any time — takes effect on next server
  restart.
- This tracks usage per **account email**, not per browser/session — so
  the limit follows a person even if they log in from a different device.

## Tools page (formerly "AI Voices")

`/tools` (the old `/ai-voices` URL now redirects here) has four tabs, all
requiring login, all powered by your ElevenLabs key:

- **Voice Generator** — the original text-to-speech preview tool.
- **Voice Cloning** — upload 1–3 clean audio samples, get back a cloned
  voice you can immediately generate speech with, then delete when done
  testing. Cloned voices count against your ElevenLabs plan's voice slot
  limit, which is why there's a delete button built in.
- **Dubbing** — upload an audio or video file, pick a target language,
  and it translates + re-voices it. This runs asynchronously on
  ElevenLabs' servers (can take several minutes for longer files) — the
  page polls for completion automatically every 5 seconds, so it's safe
  to leave the tab open and wait.
- **Audio Cleanup** — upload a noisy recording, get back a cleaned
  version with background noise/hum/room tone removed.

A few things worth knowing:

- File uploads are handled in-memory (via `multer`) and forwarded
  straight to ElevenLabs — nothing gets written to disk on your server.
- Upload size limits: 25MB for voice cloning/audio cleanup, 150MB for
  dubbing (video files are bigger). Adjust `uploadAudio` / `uploadMedia`
  in `server.js` if you need different limits.
- All of this uses the same ElevenLabs API key as the Voice Generator —
  no additional `.env` setup needed, but each of these calls costs
  ElevenLabs credits separately, so keep an eye on usage if this gets
  real traffic.

## Deploying (Render)

`render.yaml` in this repo is a Render Blueprint — it defines the web
service, a persistent disk for `data/` (so bookings/users/messages
survive every redeploy), and every environment variable the app needs,
so most of the setup is automatic instead of clicked through by hand.

1. Push this repo to GitHub (if you haven't already).
2. In Render: **New → Blueprint**, connect this repo. Render reads
   `render.yaml` and shows you the service it's about to create.
3. Render will prompt you to fill in the values marked as secrets:
   `SESSION_SECRET`, `ADMIN_PASSWORD`, `APP_BASE_URL`,
   `ELEVENLABS_API_KEY`, `STRIPE_SECRET_KEY`, and the `SMTP_*` /
   `NOTIFY_EMAIL` vars if you want booking emails. Pricing/limit vars
   already have sensible defaults baked into `render.yaml` — change them
   in the dashboard any time without touching code.
4. Set `APP_BASE_URL` to whatever your Render URL will be (e.g.
   `https://voice-forge-studios.onrender.com`), or your custom domain if
   you're attaching one — update it again later if you add a custom domain.
5. Deploy. Render installs dependencies, starts `node server.js`, and
   the persistent disk mounts at `/opt/render/project/src/data`
   automatically — no manual disk setup needed.
6. **Turn off GitHub Pages** on the repo if you had it enabled (Settings
   → Pages → Source → None) — it can't run this app and will just serve
   a confusing static fallback instead.
7. Once it's live, come back and find-and-replace the placeholder domain
   (`voiceforgestudios.com`) across `public/*.html`, `robots.txt`, and
   `sitemap.xml` with your real domain, and switch `STRIPE_SECRET_KEY`
   to a live key (`sk_live_...`) when you're ready to take real payments.

## How the pieces fit together

- `public/index.html` — the site. The "Generate Preview" button calls
  `POST /api/generate` and the voice dropdown is filled from
  `GET /api/voices` — both same-origin requests to this server, no key
  involved on the frontend.
- `server.js` — reads `ELEVENLABS_API_KEY` from `.env`, and is the only
  place that ever sends it to ElevenLabs.
- `.env` — holds the real key. It's in `.gitignore` so it won't get
  committed if you push this to a repo.

## Before deploying anywhere public

- Never move the key into `public/index.html` or any client-side JS.
- Set `ELEVENLABS_API_KEY` as an environment variable on whatever host
  you deploy `server.js` to (Render, Railway, Fly.io, a VPS, etc.) rather
  than uploading the `.env` file itself.
- Consider adding basic rate limiting to `/api/generate` so a bored
  visitor can't burn through your ElevenLabs quota.
