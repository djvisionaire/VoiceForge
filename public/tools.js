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

// Server error responses are sometimes JSON ({"error":"..."}) and sometimes
// plain text (passed straight through from ElevenLabs) — handle both.
async function parseErrorResponse(res, fallback){
  const raw = await res.text();
  try{
    const data = JSON.parse(raw);
    return data.error || fallback;
  } catch{
    return raw || fallback;
  }
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
        window.location.href = '/login?redirect=/tools';
        return;
      }
      const errMsg = await parseErrorResponse(res, 'Request failed (' + res.status + ')');
      throw new Error(errMsg);
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

/* ==================================================================
   VOICE CLONING
   ================================================================== */
let clonedVoiceId = null;
let clonedVoiceName = null;
let cloneAudioUrl = null;

function onCloneFilesChosen(){
  const files = document.getElementById('cloneFiles').files;
  const label = document.getElementById('cloneFileNames');
  label.textContent = files.length
    ? Array.from(files).map(f => f.name).join(', ')
    : '';
}

async function submitVoiceClone(){
  const name = document.getElementById('cloneName').value.trim();
  const files = document.getElementById('cloneFiles').files;
  const removeNoise = document.getElementById('cloneRemoveNoise').checked;
  const errBox = document.getElementById('cloneError');
  const btn = document.getElementById('cloneBtn');
  const label = document.getElementById('cloneBtnLabel');
  errBox.style.display = 'none';

  if(!name){ errBox.textContent = 'Enter a name for this voice.'; errBox.style.display = 'block'; return; }
  if(!files || files.length === 0){ errBox.textContent = 'Choose at least one audio sample.'; errBox.style.display = 'block'; return; }

  btn.disabled = true;
  label.textContent = 'CLONING…';

  try{
    const form = new FormData();
    form.append('name', name);
    form.append('removeBackgroundNoise', removeNoise ? 'true' : 'false');
    for(const f of files) form.append('files', f);

    const res = await fetch('/api/clone-voice', { method: 'POST', body: form });

    if(!res.ok){
      if(res.status === 401){ window.location.href = '/login?redirect=/tools'; return; }
      const errMsg = await parseErrorResponse(res, 'Request failed (' + res.status + ')');
      throw new Error(errMsg);
    }

    const data = await res.json();
    clonedVoiceId = data.voice_id;
    clonedVoiceName = data.name;

    document.getElementById('cloneResultName').textContent = clonedVoiceName;
    document.getElementById('cloneUploadStep').style.display = 'none';
    document.getElementById('cloneResultStep').style.display = 'block';
    document.getElementById('saveCloneBtn').style.display = 'block';
    document.getElementById('saveCloneBtn').disabled = false;
    document.getElementById('saveCloneBtnLabel').textContent = 'SAVE THIS CLONE PERMANENTLY — $19';
    document.querySelector('#cloneResultStep .btn-outline').style.display = 'block';
    document.getElementById('cloneTemporaryNote').style.display = 'block';
    buildWave('cloneAiWave', 60, 0.3);
  } catch(err){
    console.error(err);
    errBox.textContent = 'Cloning failed: ' + err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    label.textContent = 'CLONE VOICE';
    loadToolUsage();
  }
}

async function generateFromClone(){
  if(!clonedVoiceId) return;
  const text = document.getElementById('cloneTtsText').value.trim();
  const errBox = document.getElementById('cloneGenError');
  const btn = document.getElementById('cloneGenBtn');
  const label = document.getElementById('cloneGenBtnLabel');
  errBox.style.display = 'none';

  if(!text){ errBox.textContent = 'Enter some text first.'; errBox.style.display = 'block'; return; }

  btn.disabled = true;
  label.textContent = 'GENERATING…';

  try{
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: clonedVoiceId, model_id: 'eleven_flash_v2_5' })
    });

    if(!res.ok){
      if(res.status === 401){ window.location.href = '/login?redirect=/tools'; return; }
      const errMsg = await parseErrorResponse(res, 'Request failed (' + res.status + ')');
      throw new Error(errMsg);
    }

    const blob = await res.blob();
    if(cloneAudioUrl) URL.revokeObjectURL(cloneAudioUrl);
    cloneAudioUrl = URL.createObjectURL(blob);

    const audio = document.getElementById('cloneTtsAudio');
    audio.src = cloneAudioUrl;

    const dlBtn = document.getElementById('cloneAiDownloadBtn');
    dlBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = cloneAudioUrl;
      a.download = `${clonedVoiceName || 'cloned-voice'}-preview.mp3`;
      a.click();
    };

    buildWave('cloneAiWave', 60, 0);
    audio.onloadedmetadata = () => {
      document.getElementById('cloneAiTimeLabel').textContent = `0:00 / ${formatTime(audio.duration)}`;
    };
    audio.ontimeupdate = () => {
      const pct = audio.duration ? audio.currentTime / audio.duration : 0;
      highlightWave('cloneAiWave', pct);
      document.getElementById('cloneAiTimeLabel').textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    };
    audio.onended = () => {
      document.getElementById('cloneAiPlayBtn').querySelector('i').classList.replace('fa-pause','fa-play');
    };
    audio.play();
    document.getElementById('cloneAiPlayBtn').querySelector('i').classList.replace('fa-play','fa-pause');
  } catch(err){
    console.error(err);
    errBox.textContent = 'Generation failed: ' + err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    label.textContent = 'GENERATE PREVIEW';
  }
}

function toggleCloneAiPlayback(){
  const audio = document.getElementById('cloneTtsAudio');
  if(!audio.src) return;
  const icon = document.getElementById('cloneAiPlayBtn').querySelector('i');
  if(audio.paused){ audio.play(); icon.classList.replace('fa-play','fa-pause'); }
  else { audio.pause(); icon.classList.replace('fa-pause','fa-play'); }
}

async function deleteClonedVoice(){
  if(!clonedVoiceId) return;
  try{
    await fetch(`/api/voices/${clonedVoiceId}`, { method: 'DELETE' });
  } catch(err){
    console.error('Failed to delete cloned voice:', err);
  }
  clonedVoiceId = null;
  clonedVoiceName = null;
  document.getElementById('cloneName').value = '';
  document.getElementById('cloneFiles').value = '';
  document.getElementById('cloneFileNames').textContent = '';
  document.getElementById('cloneResultStep').style.display = 'none';
  document.getElementById('cloneUploadStep').style.display = 'block';
}

function backToCloneUpload(){
  document.getElementById('cloneResultStep').style.display = 'none';
  document.getElementById('cloneUploadStep').style.display = 'block';
  document.getElementById('cloneName').value = '';
  document.getElementById('cloneFiles').value = '';
  document.getElementById('cloneFileNames').textContent = '';
}

async function submitSaveClone(){
  if(!clonedVoiceId || !clonedVoiceName) return;
  const btn = document.getElementById('saveCloneBtn');
  const label = document.getElementById('saveCloneBtnLabel');
  btn.disabled = true;
  label.textContent = 'STARTING CHECKOUT…';

  try{
    const res = await fetch('/api/billing/save-clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice_id: clonedVoiceId, name: clonedVoiceName })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Could not start checkout.');
    window.location.href = data.checkoutUrl;
  } catch(err){
    console.error(err);
    alert('Could not start checkout: ' + err.message);
    btn.disabled = false;
    label.textContent = 'SAVE THIS CLONE PERMANENTLY — $19';
  }
}

async function loadSavedClones(){
  try{
    const res = await fetch('/api/my-saved-clones');
    if(!res.ok) return;
    const data = await res.json();
    renderSavedClones(data.savedClones || []);
  } catch(err){
    console.error('Failed to load saved clones:', err);
  }
}

function renderSavedClones(savedClones){
  const list = document.getElementById('savedClonesList');
  if(!list) return;

  if(!savedClones.length){
    list.innerHTML = `<div class="tool-note">No saved voices yet — clone one above and save it permanently to reuse it here anytime.</div>`;
    return;
  }

  list.innerHTML = savedClones.map(c => `
    <div class="saved-clone-row">
      <div>
        <div class="name">${c.name}</div>
        <div class="date">Saved ${new Date(c.purchasedAt).toLocaleDateString()}</div>
      </div>
      <button class="btn btn-outline" style="padding:8px 14px;font-size:11px;" onclick="useSavedClone('${c.voice_id}', '${c.name.replace(/'/g,"\\'")}')">
        <i class="fa-solid fa-play"></i> USE THIS VOICE
      </button>
    </div>
  `).join('');
}

function useSavedClone(voiceId, name){
  clonedVoiceId = voiceId;
  clonedVoiceName = name;
  document.getElementById('cloneResultName').textContent = name;
  document.getElementById('cloneUploadStep').style.display = 'none';
  document.getElementById('cloneResultStep').style.display = 'block';
  // Saved voices are already paid for — no need to save or delete them from here.
  document.getElementById('saveCloneBtn').style.display = 'none';
  document.querySelector('#cloneResultStep .btn-outline').style.display = 'none';
  document.getElementById('cloneTemporaryNote').style.display = 'none';
  buildWave('cloneAiWave', 60, 0.3);
}

/* ==================================================================
   DUBBING
   ================================================================== */
let dubPollTimer = null;
let dubResultUrl = null;

function onDubFileChosen(){
  const file = document.getElementById('dubFile').files[0];
  document.getElementById('dubFileName').textContent = file ? file.name : '';
}

async function submitDub(){
  const file = document.getElementById('dubFile').files[0];
  const targetLang = document.getElementById('dubTargetLang').value;
  const sourceLang = document.getElementById('dubSourceLang').value;
  const errBox = document.getElementById('dubError');
  const btn = document.getElementById('dubBtn');
  const label = document.getElementById('dubBtnLabel');
  errBox.style.display = 'none';

  if(!file){ errBox.textContent = 'Choose an audio or video file first.'; errBox.style.display = 'block'; return; }

  btn.disabled = true;
  label.textContent = 'STARTING…';

  try{
    const form = new FormData();
    form.append('media', file);
    form.append('target_lang', targetLang);
    form.append('source_lang', sourceLang);

    const res = await fetch('/api/dub', { method: 'POST', body: form });

    if(!res.ok){
      if(res.status === 401){ window.location.href = '/login?redirect=/tools'; return; }
      const errMsg = await parseErrorResponse(res, 'Request failed (' + res.status + ')');
      throw new Error(errMsg);
    }

    const data = await res.json();
    document.getElementById('dubUploadStep').style.display = 'none';
    document.getElementById('dubProgressStep').style.display = 'block';
    pollDubStatus(data.dubbing_id, targetLang);
  } catch(err){
    console.error(err);
    errBox.textContent = 'Could not start dubbing: ' + err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    label.textContent = 'START DUBBING';
    loadToolUsage();
  }
}

async function pollDubStatus(dubbingId, targetLang){
  try{
    const res = await fetch(`/api/dub/${dubbingId}/status`);
    if(!res.ok) throw new Error('Status check failed');
    const data = await res.json();

    if(data.status === 'dubbed'){
      await fetchDubResult(dubbingId, targetLang);
      return;
    }
    if(data.status === 'failed'){
      document.getElementById('dubProgressStep').style.display = 'none';
      document.getElementById('dubUploadStep').style.display = 'block';
      document.getElementById('dubError').textContent = data.error_message || 'Dubbing failed. Please try again.';
      document.getElementById('dubError').style.display = 'block';
      return;
    }
    // still processing — check again in a few seconds
    dubPollTimer = setTimeout(() => pollDubStatus(dubbingId, targetLang), 5000);
  } catch(err){
    console.error(err);
    dubPollTimer = setTimeout(() => pollDubStatus(dubbingId, targetLang), 8000);
  }
}

async function fetchDubResult(dubbingId, targetLang){
  const res = await fetch(`/api/dub/${dubbingId}/result?lang=${targetLang}`);
  if(!res.ok){
    document.getElementById('dubProgressStep').style.display = 'none';
    document.getElementById('dubUploadStep').style.display = 'block';
    document.getElementById('dubError').textContent = 'Dubbing finished but the result could not be retrieved.';
    document.getElementById('dubError').style.display = 'block';
    return;
  }

  const contentType = res.headers.get('content-type') || '';
  const blob = await res.blob();
  if(dubResultUrl) URL.revokeObjectURL(dubResultUrl);
  dubResultUrl = URL.createObjectURL(blob);

  const isVideo = contentType.includes('video');
  const videoPlayer = document.getElementById('dubResultPlayer');
  const audioPlayer = document.getElementById('dubResultAudioPlayer');

  if(isVideo){
    videoPlayer.src = dubResultUrl;
    videoPlayer.style.display = 'block';
    audioPlayer.style.display = 'none';
  } else {
    audioPlayer.src = dubResultUrl;
    audioPlayer.style.display = 'block';
    videoPlayer.style.display = 'none';
  }

  const dlBtn = document.getElementById('dubDownloadBtn');
  dlBtn.href = dubResultUrl;
  dlBtn.download = `dubbed-${targetLang}.${isVideo ? 'mp4' : 'mp3'}`;

  document.getElementById('dubProgressStep').style.display = 'none';
  document.getElementById('dubResultStep').style.display = 'block';
}

function resetDubTool(){
  if(dubPollTimer) clearTimeout(dubPollTimer);
  document.getElementById('dubFile').value = '';
  document.getElementById('dubFileName').textContent = '';
  document.getElementById('dubResultStep').style.display = 'none';
  document.getElementById('dubProgressStep').style.display = 'none';
  document.getElementById('dubUploadStep').style.display = 'block';
}

/* ==================================================================
   AUDIO CLEANUP (VOICE ISOLATOR)
   ================================================================== */
let cleanupOriginalUrl = null;
let cleanupResultUrl = null;

function onCleanupFileChosen(){
  const file = document.getElementById('cleanupFile').files[0];
  document.getElementById('cleanupFileName').textContent = file ? file.name : '';
}

async function submitCleanup(){
  const file = document.getElementById('cleanupFile').files[0];
  const errBox = document.getElementById('cleanupError');
  const btn = document.getElementById('cleanupBtn');
  const label = document.getElementById('cleanupBtnLabel');
  errBox.style.display = 'none';

  if(!file){ errBox.textContent = 'Choose an audio file first.'; errBox.style.display = 'block'; return; }

  btn.disabled = true;
  label.textContent = 'CLEANING…';

  try{
    const form = new FormData();
    form.append('audio', file);

    const res = await fetch('/api/isolate-audio', { method: 'POST', body: form });

    if(!res.ok){
      if(res.status === 401){ window.location.href = '/login?redirect=/tools'; return; }
      const errMsg = await parseErrorResponse(res, 'Request failed (' + res.status + ')');
      throw new Error(errMsg);
    }

    const blob = await res.blob();
    if(cleanupResultUrl) URL.revokeObjectURL(cleanupResultUrl);
    if(cleanupOriginalUrl) URL.revokeObjectURL(cleanupOriginalUrl);
    cleanupResultUrl = URL.createObjectURL(blob);
    cleanupOriginalUrl = URL.createObjectURL(file);

    document.getElementById('cleanupOriginalPlayer').src = cleanupOriginalUrl;
    document.getElementById('cleanupResultPlayer').src = cleanupResultUrl;

    const dlBtn = document.getElementById('cleanupDownloadBtn');
    dlBtn.href = cleanupResultUrl;

    document.getElementById('cleanupUploadStep').style.display = 'none';
    document.getElementById('cleanupResultStep').style.display = 'block';
  } catch(err){
    console.error(err);
    errBox.textContent = 'Cleanup failed: ' + err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    label.textContent = 'CLEAN AUDIO';
    loadToolUsage();
  }
}

function resetCleanupTool(){
  document.getElementById('cleanupFile').value = '';
  document.getElementById('cleanupFileName').textContent = '';
  document.getElementById('cleanupResultStep').style.display = 'none';
  document.getElementById('cleanupUploadStep').style.display = 'block';
}

async function initToolsPage(){
  try{
    const meRes = await fetch('/api/me');
    if(!meRes.ok){
      window.location.href = '/login?redirect=/tools';
      return;
    }
  } catch(err){
    console.error(err);
  }

  document.getElementById('aiGateLoading').style.display = 'none';
  document.getElementById('toolsContent').style.display = 'block';

  buildWave('aiWave', 60, 0.3);
  loadVoices();
  await loadPricingInfo(); // needed before rendering usage/credit-buy rows
  loadToolUsage();
  loadSavedClones();
  handleBillingReturn();
}

function showToolsToast(message, isError){
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:300;
    background:var(--panel);border:1px solid var(--border);border-left:3px solid ${isError ? '#ff6b6b' : 'var(--green)'};
    color:var(--white);padding:14px 20px;border-radius:6px;font-size:13px;
    box-shadow:0 10px 30px rgba(0,0,0,0.4);max-width:90vw;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

// Detects ?billing_success / ?billing_cancelled / ?credits_success / ?clone_saved
// in the URL after returning from a Stripe Checkout redirect, and confirms
// the corresponding purchase server-side.
async function handleBillingReturn(){
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');

  try{
    if(params.get('billing_success') === '1' && sessionId){
      const res = await fetch(`/api/billing/confirm-subscription?session_id=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if(res.ok && data.success){
        showToolsToast('Welcome to Tools Pro! Your daily limits just went up.');
        loadToolUsage();
      } else {
        showToolsToast(data.error || 'Could not confirm subscription.', true);
      }
    } else if(params.get('credits_success') === '1' && sessionId){
      const res = await fetch(`/api/billing/confirm-credits?session_id=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if(res.ok && data.success){
        showToolsToast(`Added ${data.credits} ${data.tool} credits to your account.`);
        loadToolUsage();
      } else {
        showToolsToast(data.error || 'Could not confirm credit purchase.', true);
      }
    } else if(params.get('clone_saved') === '1' && sessionId){
      const res = await fetch(`/api/billing/confirm-clone-save?session_id=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if(res.ok && data.success){
        showToolsToast(`"${data.name}" saved permanently to your account.`);
        loadSavedClones();
      } else {
        showToolsToast(data.error || 'Could not confirm purchase.', true);
      }
    } else if(params.get('billing_cancelled') === '1'){
      showToolsToast('Checkout cancelled — no charge was made.', true);
    }
  } catch(err){
    console.error('Failed to confirm billing return:', err);
  } finally {
    if(sessionId || params.get('billing_cancelled')){
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
}

let pricingInfo = null;

async function loadPricingInfo(){
  try{
    const res = await fetch('/api/billing/pricing');
    if(res.ok) pricingInfo = await res.json();
  } catch(err){
    console.error('Failed to load pricing info:', err);
  }
}

async function loadToolUsage(){
  try{
    const res = await fetch('/api/tool-usage');
    if(!res.ok) return;
    const usage = await res.json();
    renderPlanPanel(usage);
    renderUsageNote('cloneUsageNote', 'cloneBtn', usage.clone, 'voice clone');
    renderUsageNote('dubUsageNote', 'dubBtn', usage.dub, 'dub');
    renderUsageNote('cleanupUsageNote', 'cleanupBtn', usage.cleanup, 'cleanup');
    renderCreditBuyRow('cloneCreditBuyRow', 'clone');
    renderCreditBuyRow('dubCreditBuyRow', 'dub');
    renderCreditBuyRow('cleanupCreditBuyRow', 'cleanup');
  } catch(err){
    console.error('Failed to load tool usage:', err);
  }
}

function renderPlanPanel(usage){
  const badge = document.getElementById('planBadge');
  const renewsNote = document.getElementById('planRenewsNote');
  const actionArea = document.getElementById('planActionArea');

  const isPro = usage.plan === 'pro';
  badge.textContent = isPro ? 'PRO' : 'FREE';
  badge.className = `billing-plan-badge ${isPro ? 'pro' : 'free'}`;

  if(isPro && usage.planRenewsAt){
    const renews = new Date(usage.planRenewsAt).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
    renewsNote.textContent = `Renews ${renews}`;
    renewsNote.style.display = 'inline';
  } else {
    renewsNote.style.display = 'none';
  }

  const proPrice = pricingInfo ? (pricingInfo.proMonthlyPriceCents / 100).toFixed(0) : '15';
  actionArea.innerHTML = isPro
    ? `<button class="btn btn-outline" onclick="cancelSubscription()">CANCEL SUBSCRIPTION</button>`
    : `<button class="btn btn-orange" onclick="subscribeToPro()">UPGRADE TO PRO — $${proPrice}/mo</button>`;
}

function renderUsageNote(noteId, btnId, usage, label){
  const note = document.getElementById(noteId);
  const btn = document.getElementById(btnId);
  const remaining = usage.limit - usage.used;
  const credits = usage.credits || 0;

  if(remaining > 0){
    note.textContent = `${usage.used} of ${usage.limit} free ${label}s used today`;
    btn.disabled = false;
  } else if(credits > 0){
    note.innerHTML = `<span style="color:var(--orange-2);">Daily free ${label}s used — ${credits} purchased credit${credits===1?'':'s'} remaining</span>`;
    btn.disabled = false;
  } else {
    note.innerHTML = `<span style="color:#ff6b6b;">Daily limit reached (${usage.used}/${usage.limit} ${label}s) — resets tomorrow, or buy credits below</span>`;
    btn.disabled = true;
  }
}

function renderCreditBuyRow(rowId, tool){
  const row = document.getElementById(rowId);
  if(!row || !pricingInfo) return;
  const pack = pricingInfo.creditPacks[tool];
  if(!pack) return;
  const price = (pack.priceCents / 100).toFixed(0);
  row.innerHTML = `<button type="button" class="credit-buy-btn" onclick="buyCredits('${tool}')"><i class="fa-solid fa-bolt"></i> Buy ${pack.credits} more for $${price}</button>`;
}

async function subscribeToPro(){
  try{
    const res = await fetch('/api/billing/subscribe', { method: 'POST' });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Could not start checkout.');
    window.location.href = data.checkoutUrl;
  } catch(err){
    console.error(err);
    alert('Could not start checkout: ' + err.message);
  }
}

async function cancelSubscription(){
  if(!confirm('Cancel your Tools Pro subscription? You\'ll drop back to Free-tier daily limits immediately.')) return;
  try{
    const res = await fetch('/api/billing/cancel-subscription', { method: 'POST' });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Could not cancel subscription.');
    loadToolUsage();
  } catch(err){
    console.error(err);
    alert('Could not cancel: ' + err.message);
  }
}

async function buyCredits(tool){
  try{
    const res = await fetch('/api/billing/buy-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Could not start checkout.');
    window.location.href = data.checkoutUrl;
  } catch(err){
    console.error(err);
    alert('Could not start checkout: ' + err.message);
  }
}

function switchToolTab(tab){
  document.querySelectorAll('.tool-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tool-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
}

initToolsPage();
