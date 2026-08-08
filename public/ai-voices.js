/* AI Voice Generator page logic */

function buildWave(id, n, activeRatio){
  const el = document.getElementById(id);
  if(!el) return;
  let html = '';
  for(let i=0;i<n;i++){
    const h = 4 + Math.round(Math.abs(Math.sin(i*0.5))*10 + Math.random()*14);
    const active = i < n*activeRatio;
    html += `<span class="${active?'active':''}" style="height:${h}px;"></span>`;
  }
  el.innerHTML = html;
}

function formatTime(t){
  if(!isFinite(t)) return '0:00';
  const m = Math.floor(t/60), s = Math.floor(t%60);
  return `${m}:${s.toString().padStart(2,'0')}`;
}

function highlightWave(id, pct){
  const el = document.getElementById(id);
  const bars = el.querySelectorAll('span');
  const activeCount = Math.round(bars.length * pct);
  bars.forEach((b,i) => b.classList.toggle('active', i < activeCount));
}

/* ---------------- ElevenLabs API wiring ---------------- */
// The frontend never talks to ElevenLabs directly — it only ever calls our
// own backend (server.js), which holds the real API key server-side.
const API_BASE = '';

let currentAudioUrl = null;

async function loadVoices(){
  const select = document.getElementById('voiceSelect');
  try{
    const res = await fetch(`${API_BASE}/api/voices`);
    if(!res.ok) throw new Error('Failed to load voices (' + res.status + ')');
    const data = await res.json();
    const voices = data.voices || [];
    select.innerHTML = voices.map(v =>
      `<option value="${v.voice_id}">${v.name}${v.category ? ' — ' + v.category : ''}</option>`
    ).join('');
    if(voices.length === 0){
      select.innerHTML = '<option value="">No voices found on this account</option>';
    }
  } catch(err){
    select.innerHTML = '<option value="">Could not load voices — check server</option>';
    console.error(err);
  }
}

async function generatePreview(){
  const btn = document.getElementById('genBtn');
  const label = document.getElementById('genBtnLabel');
  const errBox = document.getElementById('genError');
  const text = document.getElementById('ttsText').value.trim();
  const voiceId = document.getElementById('voiceSelect').value;
  const modelId = document.getElementById('modelSelect').value;

  errBox.style.display = 'none';
  if(!text){ errBox.textContent = 'Enter some script text first.'; errBox.style.display='block'; return; }
  if(!voiceId){ errBox.textContent = 'Choose a voice first.'; errBox.style.display='block'; return; }

  btn.disabled = true;
  label.textContent = 'GENERATING…';

  try{
    const res = await fetch(`${API_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: voiceId, model_id: modelId })
    });

    if(!res.ok){
      if(res.status === 401){
        window.location.href = '/login?redirect=/ai-voices';
        return;
      }
      const errText = await res.text();
      throw new Error(errText || ('Request failed (' + res.status + ')'));
    }

    const blob = await res.blob();
    if(currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(blob);

    const audio = document.getElementById('ttsAudio');
    audio.src = currentAudioUrl;

    const dlBtn = document.getElementById('aiDownloadBtn');
    dlBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = currentAudioUrl;
      a.download = 'voice-forge-preview.mp3';
      a.click();
    };

    buildWave('aiWave', 60, 0);
    audio.onloadedmetadata = () => {
      document.getElementById('aiTimeLabel').textContent = `0:00 / ${formatTime(audio.duration)}`;
    };
    audio.ontimeupdate = () => {
      const pct = audio.duration ? audio.currentTime / audio.duration : 0;
      highlightWave('aiWave', pct);
      document.getElementById('aiTimeLabel').textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    };
    audio.onended = () => {
      document.getElementById('aiPlayBtn').querySelector('i').classList.replace('fa-pause','fa-play');
    };

    audio.play();
    document.getElementById('aiPlayBtn').querySelector('i').classList.replace('fa-play','fa-pause');

  } catch(err){
    console.error(err);
    errBox.textContent = 'Generation failed: ' + err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    label.textContent = 'GENERATE PREVIEW';
  }
}

function toggleAiPlayback(){
  const audio = document.getElementById('ttsAudio');
  if(!audio.src) return;
  const icon = document.getElementById('aiPlayBtn').querySelector('i');
  if(audio.paused){ audio.play(); icon.classList.replace('fa-play','fa-pause'); }
  else { audio.pause(); icon.classList.replace('fa-pause','fa-play'); }
}

async function initAiVoicesPage(){
  try{
    const meRes = await fetch('/api/me');
    if(!meRes.ok){
      window.location.href = '/login?redirect=/ai-voices';
      return;
    }
  } catch(err){
    console.error(err);
  }

  document.getElementById('aiGateLoading').style.display = 'none';
  document.getElementById('ai').style.display = 'block';

  buildWave('aiWave', 60, 0.3);
  loadVoices();
}

initAiVoicesPage();
