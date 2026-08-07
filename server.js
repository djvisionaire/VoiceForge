// server.js
// Minimal backend for Voice Forge Studios.
// Keeps the ElevenLabs API key on the server — the browser never sees it.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'contact-messages.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(BOOKINGS_FILE)) fs.writeFileSync(BOOKINGS_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');

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

if (!ELEVENLABS_API_KEY) {
  console.warn('⚠️  ELEVENLABS_API_KEY is not set. Add it to a .env file before starting real requests.');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Clean URLs for standalone pages
const PAGES = ['ai-voices', 'pricing', 'about', 'contact', 'portfolio'];
PAGES.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
});

// GET /api/voices — list available voices for the account
app.get('/api/voices', async (req, res) => {
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
app.post('/api/generate', async (req, res) => {
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
