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

const app = express();
const PORT = process.env.PORT || 3000;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'contact-messages.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(BOOKINGS_FILE)) fs.writeFileSync(BOOKINGS_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

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
function readUsers(){ return readJsonFile(USERS_FILE); }
function writeUsers(users){ writeJsonFile(USERS_FILE, users); }

if (!ELEVENLABS_API_KEY) {
  console.warn('⚠️  ELEVENLABS_API_KEY is not set. Add it to a .env file before starting real requests.');
}

if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET is not set in .env — using an insecure default. Fine for local testing, not for a real deployment.');
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
const PAGES = ['ai-voices', 'pricing', 'about', 'contact', 'portfolio', 'login', 'account', 'reset-password'];
PAGES.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
});

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

// GET /api/my-bookings — bookings belonging to the logged-in user's email
app.get('/api/my-bookings', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });

  const users = readUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  const bookings = readBookings().filter(b => b.email.toLowerCase() === user.email);
  res.json({ bookings });
});

// GET /api/availability?date=YYYY-MM-DD — which time slots are already booked that day
app.get('/api/availability', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const bookings = readBookings();
  const taken = bookings.filter(b => b.date === date).map(b => b.time);
  res.json({ date, taken });
});

// POST /api/bookings — create a new session booking
// body: { projectType, scriptLength, deliveryTime, date, time, name, email, phone }
app.post('/api/bookings', (req, res) => {
  const { projectType, scriptLength, deliveryTime, date, time, name, email, phone } = req.body;

  if (!date || !time || !name || !email) {
    return res.status(400).json({ error: 'date, time, name, and email are required' });
  }

  const bookings = readBookings();

  const conflict = bookings.some(b => b.date === date && b.time === time);
  if (conflict) {
    return res.status(409).json({ error: 'That time slot was just booked. Please choose another.' });
  }

  const booking = {
    bookingId: crypto.randomBytes(4).toString('hex').toUpperCase(),
    projectType, scriptLength, deliveryTime,
    date, time, name, email, phone: phone || null,
    createdAt: new Date().toISOString()
  };

  bookings.push(booking);
  writeBookings(bookings);

  sendBookingNotification(booking); // fire-and-forget — logs its own errors, never blocks the response

  res.status(201).json({ success: true, bookingId: booking.bookingId });
});

// POST /api/contact — store a contact form submission
// body: { name, email, company, phone, projectType, budget, message }
app.post('/api/contact', (req, res) => {
  const { name, email, company, phone, projectType, budget, message } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  const messages = readJsonFile(MESSAGES_FILE);
  const entry = {
    id: crypto.randomBytes(4).toString('hex').toUpperCase(),
    name, email,
    company: company || null,
    phone: phone || null,
    projectType: projectType || null,
    budget: budget || null,
    message: message || null,
    createdAt: new Date().toISOString()
  };
  messages.push(entry);
  writeJsonFile(MESSAGES_FILE, messages);

  res.status(201).json({ success: true, id: entry.id });
});

app.listen(PORT, () => {
  console.log(`Voice Forge Studios running at http://localhost:${PORT}`);
});
