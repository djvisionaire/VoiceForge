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
