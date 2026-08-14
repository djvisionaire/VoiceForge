// server.js
// Minimal backend for Voice Forge Studios.
// Keeps the ElevenLabs API key on the server — the browser never sees it.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const Stripe = require('stripe');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

// In-memory uploads — files get forwarded straight to ElevenLabs, never
// written to disk. Size limits keep server memory usage sane.
const uploadAudio = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });      // 25MB — voice cloning samples, audio cleanup
const uploadMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } });     // 150MB — dubbing can be audio or video

const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'contact-messages.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const USAGE_FILE = path.join(DATA_DIR, 'tool-usage.json');
const CREDIT_PURCHASES_FILE = path.join(DATA_DIR, 'credit-purchases.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(BOOKINGS_FILE)) fs.writeFileSync(BOOKINGS_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(USAGE_FILE)) fs.writeFileSync(USAGE_FILE, '{}');
if (!fs.existsSync(CREDIT_PURCHASES_FILE)) fs.writeFileSync(CREDIT_PURCHASES_FILE, '[]');

function readJsonFile(file){
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function writeJsonFile(file, data){
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readBookings(){ return readJsonFile(BOOKINGS_FILE); }
function writeBookings(bookings){ writeJsonFile(BOOKINGS_FILE, bookings); }
function readUsers(){
  const users = readJsonFile(USERS_FILE);
  // Backfill billing fields for accounts created before the Tools billing
  // system existed — keeps every user object shape consistent everywhere.
  users.forEach(u => {
    if (!u.plan) u.plan = 'free';
    if (u.stripeCustomerId === undefined) u.stripeCustomerId = null;
    if (u.stripeSubscriptionId === undefined) u.stripeSubscriptionId = null;
    if (u.planRenewsAt === undefined) u.planRenewsAt = null;
    if (!u.credits) u.credits = { clone: 0, dub: 0, cleanup: 0 };
    if (!u.savedClones) u.savedClones = [];
  });
  return users;
}
function writeUsers(users){ writeJsonFile(USERS_FILE, users); }
function readMessages(){ return readJsonFile(MESSAGES_FILE); }
function writeMessages(messages){ writeJsonFile(MESSAGES_FILE, messages); }

// ---------------- Tools billing: plans, credit packs, saved clones ----------------
// These three tools cost real ElevenLabs credits per call, unlike basic TTS —
// tracked per-user, per-day, reset automatically at midnight (server's local date).
// Free accounts get a daily allotment; once that's used up, purchased credits
// (if any) cover additional uses. Pro accounts just get a bigger daily allotment.

const PLAN_LIMITS = {
  free: {
    clone: parseInt(process.env.DAILY_LIMIT_CLONE || '3', 10),
    dub: parseInt(process.env.DAILY_LIMIT_DUB || '3', 10),
    cleanup: parseInt(process.env.DAILY_LIMIT_CLEANUP || '5', 10)
  },
  pro: {
    clone: parseInt(process.env.DAILY_LIMIT_CLONE_PRO || '20', 10),
    dub: parseInt(process.env.DAILY_LIMIT_DUB_PRO || '15', 10),
    cleanup: parseInt(process.env.DAILY_LIMIT_CLEANUP_PRO || '40', 10)
  }
};

const PRO_MONTHLY_PRICE_CENTS = parseInt(process.env.PRO_MONTHLY_PRICE_CENTS || '1500', 10); // $15/mo default

// "10 dubbing credits for $15" etc. — one-time purchases that cover extra
// uses once the daily plan allotment for that tool is used up.
const CREDIT_PACKS = {
  clone:   { credits: 5,  priceCents: parseInt(process.env.CLONE_PACK_PRICE_CENTS || '1200', 10) },   // 5 for $12
  dub:     { credits: 10, priceCents: parseInt(process.env.DUB_PACK_PRICE_CENTS || '1500', 10) },      // 10 for $15
  cleanup: { credits: 15, priceCents: parseInt(process.env.CLEANUP_PACK_PRICE_CENTS || '1000', 10) }   // 15 for $10
};

const SAVE_CLONE_PRICE_CENTS = parseInt(process.env.SAVE_CLONE_PRICE_CENTS || '1900', 10); // $19 one-time

function getUserPlan(user){
  return user && user.plan === 'pro' ? 'pro' : 'free';
}

function readUsage(){
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeUsage(data){
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

function todayStr(){
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getSessionUser(req){
  if (!req.session.userId) return null;
  return readUsers().find(u => u.id === req.session.userId) || null;
}

function getSessionEmail(req){
  const user = getSessionUser(req);
  return user ? user.email : null;
}

// Returns current plan, usage, limits, and credit balances for a user —
// used to render "X of Y used today" plus credit balances in the UI.
function getUsageSnapshot(email){
  const user = readUsers().find(u => u.email === email);
  const plan = getUserPlan(user);
  const limits = PLAN_LIMITS[plan];
  const credits = user ? user.credits : { clone: 0, dub: 0, cleanup: 0 };

  const usage = readUsage();
  const today = todayStr();
  const record = (usage[email] && usage[email].date === today) ? usage[email] : { date: today, clone: 0, dub: 0, cleanup: 0 };

  const build = (tool) => ({
    used: record[tool] || 0,
    limit: limits[tool],
    credits: credits[tool] || 0
  });

  return {
    plan,
    planRenewsAt: user ? user.planRenewsAt : null,
    clone: build('clone'),
    dub: build('dub'),
    cleanup: build('cleanup')
  };
}

// Consumes one unit of usage for a tool: prefers the daily plan allotment
// first, then falls back to purchased credits once that's exhausted.
// Consumes on attempt (not just success) — simplest way to stop someone
// retrying a failed call in a loop to bypass the cap.
function checkAndConsumeUsage(email, tool){
  const users = readUsers();
  const user = users.find(u => u.email === email);
  const plan = getUserPlan(user);
  const limit = PLAN_LIMITS[plan][tool];

  const usage = readUsage();
  const today = todayStr();
  if (!usage[email] || usage[email].date !== today) {
    usage[email] = { date: today, clone: 0, dub: 0, cleanup: 0 };
  }
  const used = usage[email][tool] || 0;

  if (used < limit) {
    usage[email][tool] = used + 1;
    writeUsage(usage);
    return { allowed: true, source: 'daily', used: used + 1, limit };
  }

  // Daily allotment exhausted — fall back to purchased credits, if any.
  const creditsAvailable = user ? (user.credits[tool] || 0) : 0;
  if (user && creditsAvailable > 0) {
    user.credits[tool] = creditsAvailable - 1;
    writeUsers(users);
    return { allowed: true, source: 'credit', used, limit, creditsRemaining: creditsAvailable - 1 };
  }

  return { allowed: false, used, limit, creditsRemaining: creditsAvailable };
}

if (!ELEVENLABS_API_KEY) {
  console.warn('⚠️  ELEVENLABS_API_KEY is not set. Add it to a .env file before starting real requests.');
}

if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET is not set in .env — using an insecure default. Fine for local testing, not for a real deployment.');
}

if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠️  ADMIN_PASSWORD is not set in .env — the admin dashboard will reject all login attempts until it is.');
}

// ---------------- Payments (Stripe) ----------------
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const DEPOSIT_PERCENT = parseInt(process.env.DEPOSIT_PERCENT || '100', 10); // 100 = full payment upfront, 50 = half deposit

if (!stripe) {
  console.warn('⚠️  STRIPE_SECRET_KEY is not set — bookings will save but no payment will be collected.');
}

// Pricing for each combination selectable in the booking form. These are
// the actual project-type/script-length/delivery options in the "Book a
// Session" card — keep this in sync if those dropdowns ever change.
const BOOKING_BASE_PRICE = {
  'Commercial': 150,
  'Radio Ad': 130,
  'Audiobook Narration': 120,
  'Explainer Video': 200,
  'Custom Take': null // no fixed price — skips payment, studio follows up with a manual quote
};
const BOOKING_LENGTH_MULTIPLIER = {
  'Up to 60 Seconds': 1,
  '60–120 Seconds': 1.6,
  'Full Audiobook Chapter': 3
};
const BOOKING_DELIVERY_MULTIPLIER = {
  'Standard (3-5 Days)': 1,
  'Rush (24-48 Hours)': 1.25,
  'Same Day': 1.5
};

// Returns the price to charge in cents, or null if this combination has no
// fixed price (Custom Take — those bookings skip payment entirely).
function computeBookingPriceCents(projectType, scriptLength, deliveryTime){
  const base = BOOKING_BASE_PRICE[projectType];
  if (base == null) return null;

  const lengthMult = BOOKING_LENGTH_MULTIPLIER[scriptLength] ?? 1;
  const deliveryMult = BOOKING_DELIVERY_MULTIPLIER[deliveryTime] ?? 1;

  const fullPrice = base * lengthMult * deliveryMult;
  const chargedPrice = fullPrice * (DEPOSIT_PERCENT / 100);
  return Math.round(chargedPrice * 100); // Stripe wants cents
}

// A "pending" booking created while someone is mid-checkout only holds the
// slot for this long — after that, it no longer blocks the slot for anyone
// else. Avoids someone abandoning checkout and permanently squatting a time.
const PENDING_HOLD_MINUTES = 15;

function isBookingActive(booking){
  if (booking.status === 'cancelled') return false;
  if (booking.status !== 'pending') return true; // confirmed/completed always active
  if (booking.paid) return true;
  if (booking.priceCents == null) return true; // Custom Take — pending indefinitely until the studio manually follows up, never auto-expires
  const ageMinutes = (Date.now() - new Date(booking.createdAt).getTime()) / 60000;
  return ageMinutes < PENDING_HOLD_MINUTES;
}

// ---------------- Email notifications ----------------
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL; // where booking alerts get sent
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

let mailer = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE, // true for port 465, false for 587/25
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
} else {
  console.warn('⚠️  Email notifications are not configured. Add SMTP_HOST/SMTP_USER/SMTP_PASS/NOTIFY_EMAIL to .env to get booking emails.');
}

async function sendBookingNotification(booking){
  if (!mailer || !NOTIFY_EMAIL) return; // silently skip if not configured

  const subject = `New Booking: ${booking.projectType} — ${booking.date} at ${booking.time}`;
  const text =
`New session booking received.

Confirmation #: ${booking.bookingId}
Date/Time: ${booking.date} at ${booking.time}
Project Type: ${booking.projectType}
Script Length: ${booking.scriptLength}
Delivery: ${booking.deliveryTime}

Client: ${booking.name}
Email: ${booking.email}
Phone: ${booking.phone || '(not provided)'}

Booked at: ${booking.createdAt}`;

  const html = `
    <h2 style="margin:0 0 12px;">New Session Booking</h2>
    <p><b>Confirmation #:</b> ${booking.bookingId}</p>
    <p><b>Date/Time:</b> ${booking.date} at ${booking.time}</p>
    <p><b>Project Type:</b> ${booking.projectType}<br>
       <b>Script Length:</b> ${booking.scriptLength}<br>
       <b>Delivery:</b> ${booking.deliveryTime}</p>
    <p><b>Client:</b> ${booking.name}<br>
       <b>Email:</b> ${booking.email}<br>
       <b>Phone:</b> ${booking.phone || '(not provided)'}</p>
    <p style="color:#888;font-size:12px;">Booked at ${booking.createdAt}</p>
  `;

  try {
    await mailer.sendMail({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      replyTo: booking.email,
      subject, text, html
    });
  } catch (err) {
    // A failed email should never fail the booking itself — just log it.
    console.error('Failed to send booking notification email:', err.message);
  }
}

// ---------------- Formspree (secondary notification channel) ----------------
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xdenabjo';

async function sendBookingToFormspree(booking){
  try {
    await fetch(FORMSPREE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        name: booking.name,
        email: booking.email,
        phone: booking.phone || '(not provided)',
        projectType: booking.projectType,
        message: `New booking — ${booking.date} at ${booking.time}. ${booking.scriptLength}, ${booking.deliveryTime} delivery. Confirmation #${booking.bookingId}.`,
        _subject: `New Booking: ${booking.projectType} — ${booking.date} at ${booking.time}`
      })
    });
  } catch (err) {
    // Same rule as the email notification — never let this fail the booking itself.
    console.error('Failed to send booking notification to Formspree:', err.message);
  }
}

app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));
app.use(express.static(path.join(__dirname, 'public')));

// Clean URLs for standalone pages
const PAGES = ['tools', 'pricing', 'about', 'contact', 'portfolio', 'login', 'account', 'reset-password', 'admin-login', 'admin'];
PAGES.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
});

// Old URL, kept working for anyone with it bookmarked
app.get('/ai-voices', (req, res) => res.redirect(301, '/tools'));

// Gate on being logged in — used for the AI Voice Generator's API routes
function requireAuth(req, res, next){
  if (!req.session.userId) {
    return res.status(401).json({ error: 'You need to be logged in to use this.' });
  }
  next();
}

// GET /api/voices — list available voices for the account
app.get('/api/voices', requireAuth, async (req, res) => {
  try {
    const response = await fetch(`${ELEVENLABS_BASE}/v1/voices`, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();
    // Only forward the fields the frontend actually needs
    const voices = (data.voices || []).map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category
    }));
    res.json({ voices });
  } catch (err) {
    console.error('Error fetching voices:', err);
    res.status(500).json({ error: 'Failed to reach ElevenLabs API' });
  }
});

// POST /api/generate — text-to-speech
// body: { text, voice_id, model_id }
app.post('/api/generate', requireAuth, async (req, res) => {
  const { text, voice_id, model_id } = req.body;

  if (!text || !voice_id) {
    return res.status(400).json({ error: 'text and voice_id are required' });
  }

  try {
    const response = await fetch(
      `${ELEVENLABS_BASE}/v1/text-to-speech/${voice_id}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: model_id || 'eleven_flash_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).send(errText);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (err) {
    console.error('Error generating speech:', err);
    res.status(500).json({ error: 'Failed to reach ElevenLabs API' });
  }
});

// ---------------- Voice Cloning ----------------

// POST /api/clone-voice — multipart form: name, files[] (1-3 audio samples)
app.post('/api/clone-voice', requireAuth, uploadAudio.array('files', 3), async (req, res) => {
  const { name, removeBackgroundNoise } = req.body;

  if (!name || !req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'A voice name and at least one audio sample are required.' });
  }

  const email = getSessionEmail(req);
  const usage = checkAndConsumeUsage(email, 'clone');
  if (!usage.allowed) {
    return res.status(429).json({ error: `Daily limit reached (${usage.limit} free voice clones today) and no purchased credits remaining. Try again tomorrow, upgrade to Pro, or buy more credits.` });
  }

  try {
    const form = new FormData();
    form.append('name', name);
    form.append('remove_background_noise', removeBackgroundNoise === 'true' ? 'true' : 'false');
    for (const file of req.files) {
      form.append('files', new Blob([file.buffer]), file.originalname);
    }

    const response = await fetch(`${ELEVENLABS_BASE}/v1/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: form
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).send(errText);
    }

    const data = await response.json();
    res.json({ voice_id: data.voice_id, name });
  } catch (err) {
    console.error('Error cloning voice:', err);
    res.status(500).json({ error: 'Failed to reach ElevenLabs API' });
  }
});

// DELETE /api/voices/:voiceId — remove a cloned voice (cleanup, since clones
// count against the ElevenLabs account's voice slot limit)
app.delete('/api/voices/:voiceId', requireAuth, async (req, res) => {
  try {
    const response = await fetch(`${ELEVENLABS_BASE}/v1/voices/${req.params.voiceId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).send(errText);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting voice:', err);
    res.status(500).json({ error: 'Failed to reach ElevenLabs API' });
  }
});

// ---------------- Audio Cleanup (Voice Isolator) ----------------

// POST /api/isolate-audio — multipart form: audio (single file)
app.post('/api/isolate-audio', requireAuth, uploadAudio.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'An audio file is required.' });
  }

  const email = getSessionEmail(req);
  const usage = checkAndConsumeUsage(email, 'cleanup');
  if (!usage.allowed) {
    return res.status(429).json({ error: `Daily limit reached (${usage.limit} free cleanups today) and no purchased credits remaining. Try again tomorrow, upgrade to Pro, or buy more credits.` });
  }

  try {
    const form = new FormData();
    form.append('audio', new Blob([req.file.buffer]), req.file.originalname);

    const response = await fetch(`${ELEVENLABS_BASE}/v1/audio-isolation`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: form
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).send(errText);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (err) {
    console.error('Error isolating audio:', err);
    res.status(500).json({ error: 'Failed to reach ElevenLabs API' });
  }
});

// ---------------- Dubbing ----------------
// Asynchronous on ElevenLabs' side: kick off the job, then the frontend
// polls /api/dub/:id/status until it's done, then fetches the result.

// POST /api/dub — multipart form: media (single file), target_lang, source_lang (optional)
app.post('/api/dub', requireAuth, uploadMedia.single('media'), async (req, res) => {
  const { target_lang, source_lang } = req.body;

  if (!req.file || !target_lang) {
    return res.status(400).json({ error: 'A media file and target language are required.' });
  }

  const email = getSessionEmail(req);
  const usage = checkAndConsumeUsage(email, 'dub');
  if (!usage.allowed) {
    return res.status(429).json({ error: `Daily limit reached (${usage.limit} free dubs today) and no purchased credits remaining. Try again tomorrow, upgrade to Pro, or buy more credits.` });
  }

  try {
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer]), req.file.originalname);
    form.append('target_lang', target_lang);
    form.append('source_lang', source_lang || 'auto');

    const response = await fetch(`${ELEVENLABS_BASE}/v1/dubbing`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: form
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).send(errText);
    }

    const data = await response.json();
    res.json({ dubbing_id: data.dubbing_id, target_lang });
  } catch (err) {
    console.error('Error starting dub:', err);
    res.status(500).json({ error: 'Failed to reach ElevenLabs API' });
  }
});

// GET /api/dub/:dubbingId/status
app.get('/api/dub/:dubbingId/status', requireAuth, async (req, res) => {
  try {
    const response = await fetch(`${ELEVENLABS_BASE}/v1/dubbing/${req.params.dubbingId}`, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).send(errText);
    }
    const data = await response.json();
    res.json({ status: data.status, error_message: data.error_message || null });
  } catch (err) {
    console.error('Error checking dub status:', err);
    res.status(500).json({ error: 'Failed to reach ElevenLabs API' });
  }
});

// GET /api/dub/:dubbingId/result?lang=xx
app.get('/api/dub/:dubbingId/result', requireAuth, async (req, res) => {
  const lang = req.query.lang;
  if (!lang) return res.status(400).json({ error: 'lang query param is required' });

  try {
    const response = await fetch(
      `${ELEVENLABS_BASE}/v1/dubbing/${req.params.dubbingId}/audio/${lang}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).send(errText);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
    res.send(buffer);
  } catch (err) {
    console.error('Error fetching dub result:', err);
    res.status(500).json({ error: 'Failed to reach ElevenLabs API' });
  }
});

// ---------------- Auth ----------------

// POST /api/signup — { name, email, password }
app.post('/api/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const users = readUsers();
  const normalizedEmail = email.trim().toLowerCase();

  if (users.some(u => u.email === normalizedEmail)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: crypto.randomBytes(6).toString('hex'),
    name, email: normalizedEmail, passwordHash,
    createdAt: new Date().toISOString()
  };
  users.push(user);
  writeUsers(users);

  req.session.userId = user.id;
  res.status(201).json({ success: true, user: { name: user.name, email: user.email } });
});

// POST /api/login — { email, password }
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const users = readUsers();
  const normalizedEmail = email.trim().toLowerCase();
  const user = users.find(u => u.email === normalizedEmail);

  if (!user) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  req.session.userId = user.id;
  res.json({ success: true, user: { name: user.name, email: user.email } });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// POST /api/forgot-password — { email }
// Always responds with success (whether or not the email exists) so this
// endpoint can't be used to check which emails have accounts.
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const users = readUsers();
  const normalizedEmail = email.trim().toLowerCase();
  const user = users.find(u => u.email === normalizedEmail);

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetTokenExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    writeUsers(users);

    const resetUrl = `${APP_BASE_URL}/reset-password?email=${encodeURIComponent(user.email)}&token=${rawToken}`;

    if (mailer) {
      try {
        await mailer.sendMail({
          from: FROM_EMAIL,
          to: user.email,
          subject: 'Reset your Voice Forge Studios password',
          text: `We received a request to reset your password. This link expires in 1 hour:\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
          html: `
            <p>We received a request to reset your password. This link expires in 1 hour:</p>
            <p><a href="${resetUrl}">${resetUrl}</a></p>
            <p style="color:#888;">If you didn't request this, you can ignore this email.</p>
          `
        });
      } catch (err) {
        console.error('Failed to send password reset email:', err.message);
      }
    } else {
      // No SMTP configured — log the link so it's still usable during local dev/testing.
      console.log(`⚠️  Email not configured. Password reset link for ${user.email}:\n${resetUrl}`);
    }
  }

  res.json({ success: true, message: 'If an account exists for that email, a reset link has been sent.' });
});

// POST /api/reset-password — { email, token, password }
app.post('/api/reset-password', async (req, res) => {
  const { email, token, password } = req.body;
  if (!email || !token || !password) {
    return res.status(400).json({ error: 'email, token, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const users = readUsers();
  const normalizedEmail = email.trim().toLowerCase();
  const user = users.find(u => u.email === normalizedEmail);

  if (!user || !user.resetTokenHash || !user.resetTokenExpires) {
    return res.status(400).json({ error: 'That reset link is invalid or has expired.' });
  }
  if (Date.now() > user.resetTokenExpires) {
    return res.status(400).json({ error: 'That reset link has expired. Please request a new one.' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  if (tokenHash !== user.resetTokenHash) {
    return res.status(400).json({ error: 'That reset link is invalid or has expired.' });
  }

  user.passwordHash = await bcrypt.hash(password, 10);
  delete user.resetTokenHash;
  delete user.resetTokenExpires;
  writeUsers(users);

  res.json({ success: true });
});

// GET /api/me — current logged-in user, or 401 if not logged in
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });

  const users = readUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  res.json({ user: { name: user.name, email: user.email } });
});

// GET /api/billing/pricing — current plan/credit/save-clone prices, so the
// frontend never has to hardcode numbers that could drift from .env
app.get('/api/billing/pricing', (req, res) => {
  res.json({
    proMonthlyPriceCents: PRO_MONTHLY_PRICE_CENTS,
    creditPacks: CREDIT_PACKS,
    saveClonePriceCents: SAVE_CLONE_PRICE_CENTS,
    planLimits: PLAN_LIMITS
  });
});

// GET /api/tool-usage — today's usage/limit for cloning, dubbing, and cleanup
app.get('/api/tool-usage', requireAuth, (req, res) => {
  const email = getSessionEmail(req);
  res.json(getUsageSnapshot(email));
});

// ---------------- Billing: Pro subscription ----------------

// POST /api/billing/subscribe — starts a Stripe subscription checkout
app.post('/api/billing/subscribe', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments are not configured on the server.' });

  const user = getSessionUser(req);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          recurring: { interval: 'month' },
          product_data: { name: 'Voice Forge Studios — Tools Pro' },
          unit_amount: PRO_MONTHLY_PRICE_CENTS
        },
        quantity: 1
      }],
      customer_email: user.email,
      success_url: `${APP_BASE_URL}/tools?billing_success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/tools?billing_cancelled=1`
    });
    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('Error creating subscription checkout:', err.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// GET /api/billing/confirm-subscription?session_id=...
app.get('/api/billing/confirm-subscription', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments are not configured.' });
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'] });
    if (session.status !== 'complete') {
      return res.status(402).json({ error: 'Subscription payment not completed.' });
    }

    const users = readUsers();
    const user = users.find(u => u.id === req.session.userId);
    if (!user) return res.status(401).json({ error: 'Not logged in' });

    user.plan = 'pro';
    user.stripeCustomerId = session.customer;
    user.stripeSubscriptionId = session.subscription ? (session.subscription.id || session.subscription) : null;
    if (session.subscription && session.subscription.current_period_end) {
      user.planRenewsAt = new Date(session.subscription.current_period_end * 1000).toISOString();
    }
    writeUsers(users);

    res.json({ success: true, plan: 'pro' });
  } catch (err) {
    console.error('Error confirming subscription:', err.message);
    res.status(500).json({ error: 'Could not confirm subscription.' });
  }
});

// POST /api/billing/cancel-subscription — downgrades back to Free
app.post('/api/billing/cancel-subscription', requireAuth, async (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  if (stripe && user.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(user.stripeSubscriptionId);
    } catch (err) {
      console.error('Error cancelling Stripe subscription:', err.message);
      return res.status(500).json({ error: 'Could not cancel with Stripe. Please try again or contact support.' });
    }
  }

  user.plan = 'free';
  user.stripeSubscriptionId = null;
  user.planRenewsAt = null;
  writeUsers(users);

  res.json({ success: true, plan: 'free' });
});

// ---------------- Billing: credit packs ----------------

// POST /api/billing/buy-credits — body: { tool }
app.post('/api/billing/buy-credits', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments are not configured on the server.' });

  const { tool } = req.body;
  const pack = CREDIT_PACKS[tool];
  if (!pack) return res.status(400).json({ error: 'Unknown credit pack.' });

  const email = getSessionEmail(req);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Voice Forge Studios — ${pack.credits} ${tool} credits` },
          unit_amount: pack.priceCents
        },
        quantity: 1
      }],
      customer_email: email,
      success_url: `${APP_BASE_URL}/tools?credits_success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/tools?billing_cancelled=1`
    });

    const purchases = readJsonFile(CREDIT_PURCHASES_FILE);
    purchases.push({
      id: crypto.randomBytes(4).toString('hex'),
      email, type: 'credits', tool, credits: pack.credits,
      stripeSessionId: session.id, fulfilled: false,
      createdAt: new Date().toISOString()
    });
    writeJsonFile(CREDIT_PURCHASES_FILE, purchases);

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('Error creating credit pack checkout:', err.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// GET /api/billing/confirm-credits?session_id=...
app.get('/api/billing/confirm-credits', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments are not configured.' });
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed.' });
    }

    const purchases = readJsonFile(CREDIT_PURCHASES_FILE);
    const purchase = purchases.find(p => p.stripeSessionId === session_id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

    if (!purchase.fulfilled) {
      const users = readUsers();
      const user = users.find(u => u.email === purchase.email);
      if (user) {
        user.credits[purchase.tool] = (user.credits[purchase.tool] || 0) + purchase.credits;
        writeUsers(users);
      }
      purchase.fulfilled = true;
      writeJsonFile(CREDIT_PURCHASES_FILE, purchases);
    }

    res.json({ success: true, tool: purchase.tool, credits: purchase.credits });
  } catch (err) {
    console.error('Error confirming credit purchase:', err.message);
    res.status(500).json({ error: 'Could not confirm purchase.' });
  }
});

// ---------------- Billing: permanently save a voice clone ----------------

// POST /api/billing/save-clone — body: { voice_id, name }
app.post('/api/billing/save-clone', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments are not configured on the server.' });

  const { voice_id, name } = req.body;
  if (!voice_id || !name) return res.status(400).json({ error: 'voice_id and name are required' });

  const email = getSessionEmail(req);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Voice Forge Studios — Save voice clone "${name}" permanently` },
          unit_amount: SAVE_CLONE_PRICE_CENTS
        },
        quantity: 1
      }],
      customer_email: email,
      success_url: `${APP_BASE_URL}/tools?clone_saved=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/tools?billing_cancelled=1`
    });

    const purchases = readJsonFile(CREDIT_PURCHASES_FILE);
    purchases.push({
      id: crypto.randomBytes(4).toString('hex'),
      email, type: 'save-clone', voice_id, name,
      stripeSessionId: session.id, fulfilled: false,
      createdAt: new Date().toISOString()
    });
    writeJsonFile(CREDIT_PURCHASES_FILE, purchases);

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('Error creating save-clone checkout:', err.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// GET /api/billing/confirm-clone-save?session_id=...
app.get('/api/billing/confirm-clone-save', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments are not configured.' });
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed.' });
    }

    const purchases = readJsonFile(CREDIT_PURCHASES_FILE);
    const purchase = purchases.find(p => p.stripeSessionId === session_id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

    if (!purchase.fulfilled) {
      const users = readUsers();
      const user = users.find(u => u.email === purchase.email);
      if (user) {
        user.savedClones.push({ voice_id: purchase.voice_id, name: purchase.name, purchasedAt: new Date().toISOString() });
        writeUsers(users);
      }
      purchase.fulfilled = true;
      writeJsonFile(CREDIT_PURCHASES_FILE, purchases);
    }

    res.json({ success: true, voice_id: purchase.voice_id, name: purchase.name });
  } catch (err) {
    console.error('Error confirming clone save:', err.message);
    res.status(500).json({ error: 'Could not confirm purchase.' });
  }
});

// GET /api/my-saved-clones
app.get('/api/my-saved-clones', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  res.json({ savedClones: (user && user.savedClones) || [] });
});

// GET /api/my-bookings — bookings belonging to the logged-in user's email
app.get('/api/my-bookings', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });

  const users = readUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  const bookings = readBookings().filter(b => b.email.toLowerCase() === user.email && isBookingActive(b));
  res.json({ bookings });
});

// GET /api/availability?date=YYYY-MM-DD — which time slots are already booked that day
app.get('/api/availability', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const bookings = readBookings();
  const taken = bookings.filter(b => b.date === date && isBookingActive(b)).map(b => b.time);
  res.json({ date, taken });
});

// POST /api/bookings — create a new session booking.
// If the selected combination has a fixed price, this creates a *pending*
// booking (holding the slot) and returns a Stripe Checkout URL — the
// booking only becomes confirmed, and notifications only get sent, once
// payment actually completes (see /api/bookings/confirm below). Custom Take
// bookings have no fixed price and skip payment entirely.
app.post('/api/bookings', async (req, res) => {
  const { projectType, scriptLength, deliveryTime, date, time, name, email, phone } = req.body;

  if (!date || !time || !name || !email) {
    return res.status(400).json({ error: 'date, time, name, and email are required' });
  }

  const bookings = readBookings();

  const conflict = bookings.some(b => b.date === date && b.time === time && isBookingActive(b));
  if (conflict) {
    return res.status(409).json({ error: 'That time slot was just booked. Please choose another.' });
  }

  const priceCents = computeBookingPriceCents(projectType, scriptLength, deliveryTime);

  const booking = {
    bookingId: crypto.randomBytes(4).toString('hex').toUpperCase(),
    projectType, scriptLength, deliveryTime,
    date, time, name, email, phone: phone || null,
    status: 'pending',
    paid: false,
    priceCents: priceCents,
    stripeSessionId: null,
    createdAt: new Date().toISOString()
  };

  // Custom Take (or Stripe not configured) — no payment step, save as-is
  // and notify immediately, same as before payments existed.
  if (priceCents == null || !stripe) {
    booking.status = 'pending'; // studio follows up manually either way
    bookings.push(booking);
    writeBookings(bookings);

    sendBookingNotification(booking);
    sendBookingToFormspree(booking);

    return res.status(201).json({ success: true, bookingId: booking.bookingId, requiresPayment: false });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Voice Forge Studios — ${projectType}`,
            description: `${scriptLength} • ${deliveryTime} delivery • ${date} at ${time}`
          },
          unit_amount: priceCents
        },
        quantity: 1
      }],
      customer_email: email,
      success_url: `${APP_BASE_URL}/?booking_success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/?booking_cancelled=1&session_id={CHECKOUT_SESSION_ID}`
    });

    booking.stripeSessionId = session.id;
    bookings.push(booking);
    writeBookings(bookings);

    res.status(201).json({ success: true, bookingId: booking.bookingId, requiresPayment: true, checkoutUrl: session.url });
  } catch (err) {
    console.error('Error creating Stripe checkout session:', err.message);
    res.status(500).json({ error: 'Could not start payment. Please try again.' });
  }
});

// GET /api/bookings/confirm?session_id=... — called when the browser returns
// from a successful Stripe Checkout. Verifies payment directly with Stripe
// (never trusts the redirect alone), then confirms the booking and fires
// the same notifications a non-payment booking would.
app.get('/api/bookings/confirm', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id || !stripe) return res.status(400).json({ error: 'session_id is required' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed.' });
    }

    const bookings = readBookings();
    const booking = bookings.find(b => b.stripeSessionId === session_id);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    if (!booking.paid) {
      booking.paid = true;
      booking.status = 'confirmed';
      writeBookings(bookings);

      sendBookingNotification(booking);
      sendBookingToFormspree(booking);
    }

    res.json({ success: true, booking });
  } catch (err) {
    console.error('Error confirming booking payment:', err.message);
    res.status(500).json({ error: 'Could not confirm payment.' });
  }
});

// GET /api/bookings/cancel?session_id=... — called when someone backs out
// of Stripe Checkout. Releases the held slot immediately rather than
// waiting for the 15-minute hold to expire on its own.
app.get('/api/bookings/cancel', (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });

  const bookings = readBookings();
  const booking = bookings.find(b => b.stripeSessionId === session_id);
  if (booking && !booking.paid) {
    booking.status = 'cancelled';
    writeBookings(bookings);
  }

  res.json({ success: true });
});

// POST /api/contact — store a contact form submission
// body: { name, email, company, phone, projectType, budget, message }
app.post('/api/contact', (req, res) => {
  const { name, email, company, phone, projectType, budget, message } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  const messages = readMessages();
  const entry = {
    id: crypto.randomBytes(4).toString('hex').toUpperCase(),
    name, email,
    company: company || null,
    phone: phone || null,
    projectType: projectType || null,
    budget: budget || null,
    message: message || null,
    read: false,
    createdAt: new Date().toISOString()
  };
  messages.push(entry);
  writeMessages(messages);

  res.status(201).json({ success: true, id: entry.id });
});

// ---------------- Admin dashboard ----------------
// Separate from customer logins entirely — a single shared password from .env.

function requireAdmin(req, res, next){
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin login required.' });
  }
  next();
}

// POST /api/admin/login — { password }
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(500).json({ error: 'Admin password is not configured on the server.' });
  }
  if (!password || password !== adminPassword) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  req.session.isAdmin = true;
  res.json({ success: true });
});

// POST /api/admin/logout
app.post('/api/admin/logout', (req, res) => {
  delete req.session.isAdmin;
  res.json({ success: true });
});

// GET /api/admin/me — whether the current session is an admin session
app.get('/api/admin/me', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Not logged in as admin' });
  res.json({ admin: true });
});

// GET /api/admin/bookings — all bookings, newest first
app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const bookings = readBookings().slice().reverse();
  res.json({ bookings });
});

// PATCH /api/admin/bookings/:bookingId — { status }
app.patch('/api/admin/bookings/:bookingId', requireAdmin, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  const bookings = readBookings();
  const booking = bookings.find(b => b.bookingId === req.params.bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  booking.status = status;
  writeBookings(bookings);
  res.json({ success: true });
});

// GET /api/admin/messages — all contact messages, newest first
app.get('/api/admin/messages', requireAdmin, (req, res) => {
  const messages = readMessages().slice().reverse();
  res.json({ messages });
});

// PATCH /api/admin/messages/:id — { read }
app.patch('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const messages = readMessages();
  const message = messages.find(m => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });

  message.read = !!req.body.read;
  writeMessages(messages);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Voice Forge Studios running at http://localhost:${PORT}`);
});
