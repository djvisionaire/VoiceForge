// server.js
// Minimal backend for Voice Forge Studios.
// Keeps the ElevenLabs API key on the server — the browser never sees it.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

if (!ELEVENLABS_API_KEY) {
  console.warn('⚠️  ELEVENLABS_API_KEY is not set. Add it to a .env file before starting real requests.');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

app.listen(PORT, () => {
  console.log(`Voice Forge Studios running at http://localhost:${PORT}`);
});
