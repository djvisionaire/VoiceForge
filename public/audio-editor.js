/* ==================================================================
   AUDIO EDITOR — runs entirely client-side via the Web Audio API.
   No file ever leaves the browser unless the person hits Download.
   ================================================================== */

let editorAudioContext = null;
let editorHistory = [];      // array of AudioBuffer snapshots
let editorHistoryIndex = -1; // pointer into editorHistory
let editorSelStart = null;   // seconds, or null if no selection
let editorSelEnd = null;
let editorIsDragging = false;
let editorDragStartX = 0;
let editorObjectUrl = null;
let editorRafId = null;

function getEditorContext(){
  if(!editorAudioContext) editorAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  return editorAudioContext;
}

function currentEditorBuffer(){
  return editorHistoryIndex >= 0 ? editorHistory[editorHistoryIndex] : null;
}

/* ---------------- Loading ---------------- */

async function onEditorFileChosen(file){
  if(!file) return;
  document.getElementById('editorFileName').textContent = file.name;
  const errBox = document.getElementById('editorLoadError');
  errBox.style.display = 'none';

  try{
    const arrayBuffer = await file.arrayBuffer();
    await loadEditorArrayBuffer(arrayBuffer);
  } catch(err){
    console.error(err);
    errBox.textContent = 'Could not load that file — try a standard audio format like MP3 or WAV.';
    errBox.style.display = 'block';
  }
}

// Pulls the audio out of any already-playing <audio>/<video> element on the
// Tools page (from Voice Generator, Cloning, Dubbing, or Cleanup results)
// and loads it straight into the editor, so nothing needs to be downloaded
// and re-uploaded.
async function sendPlayerToEditor(elementId){
  const el = document.getElementById(elementId);
  if(!el || !el.src){
    alert('Generate something with that tool first, then send it to the editor.');
    return;
  }
  await loadEditorFromUrl(el.src, `From ${elementId}`);
}

async function sendDubResultToEditor(){
  const video = document.getElementById('dubResultPlayer');
  const audio = document.getElementById('dubResultAudioPlayer');
  const src = (video && video.style.display !== 'none' && video.src) ? video.src
            : (audio && audio.src) ? audio.src : null;
  if(!src){
    alert('Run a dub first, then send the result to the editor.');
    return;
  }
  await loadEditorFromUrl(src, 'Dubbed result');
}

async function loadEditorFromUrl(url, label){
  const errBox = document.getElementById('editorLoadError');
  errBox.style.display = 'none';
  try{
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    document.getElementById('editorFileName').textContent = label || 'Loaded from tool result';
    switchToolTab('editor'); // make the panel visible first so canvas sizing measures correctly
    await loadEditorArrayBuffer(arrayBuffer);
  } catch(err){
    console.error(err);
    errBox.textContent = 'Could not load that audio into the editor.';
    errBox.style.display = 'block';
  }
}

async function loadEditorArrayBuffer(arrayBuffer){
  const ctx = getEditorContext();
  // decodeAudioData detaches/consumes the buffer, so hand it a fresh copy
  const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

  editorHistory = [buffer];
  editorHistoryIndex = 0;
  editorSelStart = null;
  editorSelEnd = null;

  document.getElementById('editorUploadStep').style.display = 'none';
  document.getElementById('editorWorkspace').style.display = 'block';

  resizeEditorCanvas();
  refreshEditorPlayer();
  updateEditorUndoRedoButtons();
  updateEditorSelectionButtons();
}

function editorLoadDifferentFile(){
  if(editorRafId) cancelAnimationFrame(editorRafId);
  editorHistory = [];
  editorHistoryIndex = -1;
  editorSelStart = null;
  editorSelEnd = null;
  document.getElementById('editorFile').value = '';
  document.getElementById('editorFileName').textContent = '';
  document.getElementById('editorWorkspace').style.display = 'none';
  document.getElementById('editorUploadStep').style.display = 'block';
}

/* ---------------- Rendering to <audio> + waveform ---------------- */

function refreshEditorPlayer(){
  const buffer = currentEditorBuffer();
  if(!buffer) return;

  const blob = audioBufferToWavBlob(buffer);
  if(editorObjectUrl) URL.revokeObjectURL(editorObjectUrl);
  editorObjectUrl = URL.createObjectURL(blob);

  const player = document.getElementById('editorAudioPlayer');
  const wasPlaying = !player.paused;
  player.src = editorObjectUrl;

  player.onloadedmetadata = () => {
    updateEditorTimeLabel();
    if(wasPlaying) player.play();
  };

  drawEditorWaveform();
}

function resizeEditorCanvas(){
  const canvas = document.getElementById('editorCanvas');
  const wrap = canvas.parentElement;
  canvas.width = wrap.clientWidth;
  canvas.height = 160;
  drawEditorWaveform();
}
window.addEventListener('resize', () => {
  if(currentEditorBuffer()) resizeEditorCanvas();
});

function drawEditorWaveform(){
  const buffer = currentEditorBuffer();
  const canvas = document.getElementById('editorCanvas');
  if(!buffer || !canvas) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.width, height = canvas.height;
  const amp = height / 2;

  ctx.clearRect(0, 0, width, height);

  // Selection overlay (drawn first, waveform on top)
  if(editorSelStart != null && editorSelEnd != null){
    const x1 = (Math.min(editorSelStart, editorSelEnd) / buffer.duration) * width;
    const x2 = (Math.max(editorSelStart, editorSelEnd) / buffer.duration) * width;
    ctx.fillStyle = 'rgba(245,130,13,0.18)';
    ctx.fillRect(x1, 0, x2 - x1, height);
  }

  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.ceil(data.length / width));
  ctx.strokeStyle = '#f5820d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for(let x = 0; x < width; x++){
    let min = 1.0, max = -1.0;
    const start = x * step;
    for(let j = 0; j < step; j++){
      const v = data[start + j];
      if(v === undefined) continue;
      if(v < min) min = v;
      if(v > max) max = v;
    }
    ctx.moveTo(x + 0.5, (1 + min) * amp);
    ctx.lineTo(x + 0.5, (1 + max) * amp);
  }
  ctx.stroke();

  // Playhead
  const player = document.getElementById('editorAudioPlayer');
  if(player && buffer.duration){
    const px = (player.currentTime / buffer.duration) * width;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
  }
}

/* ---------------- Selection (click-drag on canvas) ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('editorCanvas');
  if(!canvas) return;

  canvas.addEventListener('mousedown', (e) => {
    if(!currentEditorBuffer()) return;
    editorIsDragging = true;
    editorDragStartX = e.offsetX;
    editorSelStart = xToSeconds(e.offsetX, canvas);
    editorSelEnd = editorSelStart;
  });

  canvas.addEventListener('mousemove', (e) => {
    if(!editorIsDragging) return;
    editorSelEnd = xToSeconds(e.offsetX, canvas);
    drawEditorWaveform();
  });

  window.addEventListener('mouseup', (e) => {
    if(!editorIsDragging) return;
    editorIsDragging = false;

    const movedPixels = Math.abs((e.offsetX ?? editorDragStartX) - editorDragStartX);
    if(movedPixels < 4){
      // Treat as a simple click — seek playback there instead of selecting
      const player = document.getElementById('editorAudioPlayer');
      if(player && editorSelStart != null) player.currentTime = editorSelStart;
      editorSelStart = null;
      editorSelEnd = null;
    }
    updateEditorSelectionButtons();
    drawEditorWaveform();
  });
});

function xToSeconds(x, canvas){
  const buffer = currentEditorBuffer();
  if(!buffer) return 0;
  const pct = Math.min(1, Math.max(0, x / canvas.width));
  return pct * buffer.duration;
}

function editorClearSelection(){
  editorSelStart = null;
  editorSelEnd = null;
  updateEditorSelectionButtons();
  drawEditorWaveform();
}

function updateEditorSelectionButtons(){
  const hasSelection = editorSelStart != null && editorSelEnd != null && Math.abs(editorSelEnd - editorSelStart) > 0.05;
  document.getElementById('editorTrimBtn').disabled = !hasSelection;
  document.getElementById('editorDeleteBtn').disabled = !hasSelection;
  document.getElementById('editorClearSelBtn').disabled = !hasSelection;

  const note = document.getElementById('editorSelectionNote');
  note.textContent = hasSelection
    ? `Selection: ${formatEditorTime(Math.min(editorSelStart,editorSelEnd))} – ${formatEditorTime(Math.max(editorSelStart,editorSelEnd))}`
    : '';
}

/* ---------------- Playback ---------------- */

function toggleEditorPlayback(){
  const player = document.getElementById('editorAudioPlayer');
  const icon = document.getElementById('editorPlayBtn').querySelector('i');
  if(player.paused){
    player.play();
    icon.classList.replace('fa-play', 'fa-pause');
    startEditorPlayheadLoop();
  } else {
    player.pause();
    icon.classList.replace('fa-pause', 'fa-play');
  }
}

function startEditorPlayheadLoop(){
  const player = document.getElementById('editorAudioPlayer');
  function tick(){
    if(player.paused){
      document.getElementById('editorPlayBtn').querySelector('i').classList.replace('fa-pause','fa-play');
      drawEditorWaveform();
      return;
    }
    updateEditorTimeLabel();
    drawEditorWaveform();
    editorRafId = requestAnimationFrame(tick);
  }
  tick();
}

function updateEditorTimeLabel(){
  const player = document.getElementById('editorAudioPlayer');
  document.getElementById('editorTimeLabel').textContent =
    `${formatEditorTime(player.currentTime)} / ${formatEditorTime(player.duration || 0)}`;
}

function formatEditorTime(t){
  if(!isFinite(t)) return '0:00';
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2,'0')}`;
}

/* ---------------- Editing operations ---------------- */
/* Each of these builds a brand-new AudioBuffer and pushes it onto the
   history stack — never mutates a buffer already in the history, so
   undo/redo always has clean, independent snapshots. */

function pushEditorHistory(newBuffer){
  // Discard any redo branch beyond the current point
  editorHistory = editorHistory.slice(0, editorHistoryIndex + 1);
  editorHistory.push(newBuffer);
  editorHistoryIndex = editorHistory.length - 1;
  updateEditorUndoRedoButtons();
}

function updateEditorUndoRedoButtons(){
  document.getElementById('editorUndoBtn').disabled = editorHistoryIndex <= 0;
  document.getElementById('editorRedoBtn').disabled = editorHistoryIndex >= editorHistory.length - 1;
}

function editorUndo(){
  if(editorHistoryIndex <= 0) return;
  editorHistoryIndex--;
  editorClearSelection();
  refreshEditorPlayer();
  updateEditorUndoRedoButtons();
}

function editorRedo(){
  if(editorHistoryIndex >= editorHistory.length - 1) return;
  editorHistoryIndex++;
  editorClearSelection();
  refreshEditorPlayer();
  updateEditorUndoRedoButtons();
}

function cloneEmptyBufferLike(buffer, length){
  const ctx = getEditorContext();
  return ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
}

function editorTrimToSelection(){
  const buffer = currentEditorBuffer();
  if(!buffer || editorSelStart == null || editorSelEnd == null) return;

  const start = Math.floor(Math.min(editorSelStart, editorSelEnd) * buffer.sampleRate);
  const end = Math.floor(Math.max(editorSelStart, editorSelEnd) * buffer.sampleRate);
  const newBuffer = cloneEmptyBufferLike(buffer, end - start);

  for(let ch = 0; ch < buffer.numberOfChannels; ch++){
    const src = buffer.getChannelData(ch);
    const dst = newBuffer.getChannelData(ch);
    dst.set(src.subarray(start, end));
  }

  pushEditorHistory(newBuffer);
  editorClearSelection();
  refreshEditorPlayer();
}

function editorDeleteSelection(){
  const buffer = currentEditorBuffer();
  if(!buffer || editorSelStart == null || editorSelEnd == null) return;

  const start = Math.floor(Math.min(editorSelStart, editorSelEnd) * buffer.sampleRate);
  const end = Math.floor(Math.max(editorSelStart, editorSelEnd) * buffer.sampleRate);
  const newLength = buffer.length - (end - start);
  if(newLength <= 0) return;

  const newBuffer = cloneEmptyBufferLike(buffer, newLength);
  for(let ch = 0; ch < buffer.numberOfChannels; ch++){
    const src = buffer.getChannelData(ch);
    const dst = newBuffer.getChannelData(ch);
    dst.set(src.subarray(0, start), 0);
    dst.set(src.subarray(end), start);
  }

  pushEditorHistory(newBuffer);
  editorClearSelection();
  refreshEditorPlayer();
}

// Fades over the current selection if one exists, otherwise over a default
// 1-second window at the very start (fade in) or end (fade out) of the clip.
function editorFadeIn(){
  const buffer = currentEditorBuffer();
  if(!buffer) return;
  const hasSel = editorSelStart != null && editorSelEnd != null;
  const fadeStart = hasSel ? Math.min(editorSelStart, editorSelEnd) : 0;
  const fadeEnd = hasSel ? Math.max(editorSelStart, editorSelEnd) : Math.min(1, buffer.duration);
  applyEditorFade(fadeStart, fadeEnd, true);
}

function editorFadeOut(){
  const buffer = currentEditorBuffer();
  if(!buffer) return;
  const hasSel = editorSelStart != null && editorSelEnd != null;
  const fadeStart = hasSel ? Math.min(editorSelStart, editorSelEnd) : Math.max(0, buffer.duration - 1);
  const fadeEnd = hasSel ? Math.max(editorSelStart, editorSelEnd) : buffer.duration;
  applyEditorFade(fadeStart, fadeEnd, false);
}

function applyEditorFade(startSec, endSec, isFadeIn){
  const buffer = currentEditorBuffer();
  const newBuffer = cloneEmptyBufferLike(buffer, buffer.length);
  const startSample = Math.floor(startSec * buffer.sampleRate);
  const endSample = Math.floor(endSec * buffer.sampleRate);
  const span = Math.max(1, endSample - startSample);

  for(let ch = 0; ch < buffer.numberOfChannels; ch++){
    const src = buffer.getChannelData(ch);
    const dst = newBuffer.getChannelData(ch);
    dst.set(src);
    for(let i = startSample; i < endSample; i++){
      const progress = (i - startSample) / span; // 0 -> 1 across the fade window
      const gain = isFadeIn ? progress : (1 - progress);
      dst[i] = src[i] * gain;
    }
  }

  pushEditorHistory(newBuffer);
  editorClearSelection();
  refreshEditorPlayer();
}

function editorNormalize(){
  const buffer = currentEditorBuffer();
  if(!buffer) return;

  let peak = 0;
  for(let ch = 0; ch < buffer.numberOfChannels; ch++){
    const data = buffer.getChannelData(ch);
    for(let i = 0; i < data.length; i++){
      const abs = Math.abs(data[i]);
      if(abs > peak) peak = abs;
    }
  }
  if(peak === 0) return; // silent clip — nothing to normalize

  const targetPeak = 0.97;
  const scale = targetPeak / peak;
  const newBuffer = cloneEmptyBufferLike(buffer, buffer.length);

  for(let ch = 0; ch < buffer.numberOfChannels; ch++){
    const src = buffer.getChannelData(ch);
    const dst = newBuffer.getChannelData(ch);
    for(let i = 0; i < src.length; i++) dst[i] = src[i] * scale;
  }

  pushEditorHistory(newBuffer);
  refreshEditorPlayer();
}

function editorApplyGain(){
  const buffer = currentEditorBuffer();
  if(!buffer) return;
  const db = parseFloat(document.getElementById('editorGainSlider').value);
  if(db === 0) return;

  const gainMultiplier = Math.pow(10, db / 20);
  const newBuffer = cloneEmptyBufferLike(buffer, buffer.length);

  for(let ch = 0; ch < buffer.numberOfChannels; ch++){
    const src = buffer.getChannelData(ch);
    const dst = newBuffer.getChannelData(ch);
    for(let i = 0; i < src.length; i++){
      dst[i] = Math.max(-1, Math.min(1, src[i] * gainMultiplier));
    }
  }

  pushEditorHistory(newBuffer);
  document.getElementById('editorGainSlider').value = 0;
  document.getElementById('editorGainLabel').textContent = '0 dB';
  refreshEditorPlayer();
}

/* ---------------- Effects (rendered via OfflineAudioContext) ---------------- */
/* Unlike trim/fade/gain (plain sample math), these build a small Web Audio
   graph and render it offline — the right tool for anything involving
   actual delay lines, feedback loops, or convolution. Each one disables its
   button while rendering, since a long clip + reverb tail can take a moment. */

async function runEffectButton(btnId, labelId, busyText, renderFn){
  const btn = document.getElementById(btnId);
  const label = document.getElementById(labelId);
  const originalText = label.textContent;
  btn.disabled = true;
  label.textContent = busyText;

  try{
    const buffer = currentEditorBuffer();
    if(!buffer) return;
    const rendered = await renderFn(buffer);
    pushEditorHistory(rendered);
    refreshEditorPlayer();
  } catch(err){
    console.error('Effect render failed:', err);
    alert('That effect could not be applied: ' + err.message);
  } finally {
    btn.disabled = false;
    label.textContent = originalText;
  }
}

async function editorApplyEcho(){
  await runEffectButton('echoApplyBtn', 'echoApplyLabel', 'RENDERING…', async (buffer) => {
    const delayTime = parseFloat(document.getElementById('echoDelaySlider').value);
    const feedback = parseFloat(document.getElementById('echoFeedbackSlider').value);
    const mix = 0.5; // fixed wet amount — delay time + repeats are the controls that matter here

    const tailSeconds = delayTime * 8; // let several repeats ring out before the render ends
    const length = buffer.length + Math.ceil(tailSeconds * buffer.sampleRate);
    const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, length, buffer.sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    const dryGain = offlineCtx.createGain();
    dryGain.gain.value = 1;

    const delay = offlineCtx.createDelay(5.0);
    delay.delayTime.value = delayTime;
    const feedbackGain = offlineCtx.createGain();
    feedbackGain.gain.value = feedback;
    const wetGain = offlineCtx.createGain();
    wetGain.gain.value = mix;

    source.connect(dryGain).connect(offlineCtx.destination);
    source.connect(delay);
    delay.connect(feedbackGain);
    feedbackGain.connect(delay); // feedback loop — each pass gets quieter via `feedback`
    delay.connect(wetGain).connect(offlineCtx.destination);

    source.start();
    return await offlineCtx.startRendering();
  });
}

function generateReverbImpulse(ctx, durationSec, decayPower){
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * durationSec));
  const impulse = ctx.createBuffer(2, length, rate);
  for(let ch = 0; ch < 2; ch++){
    const data = impulse.getChannelData(ch);
    for(let i = 0; i < length; i++){
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decayPower);
    }
  }
  return impulse;
}

async function editorApplyReverb(){
  await runEffectButton('reverbApplyBtn', 'reverbApplyLabel', 'RENDERING…', async (buffer) => {
    const decaySeconds = parseFloat(document.getElementById('reverbDecaySlider').value);
    const mix = parseFloat(document.getElementById('reverbMixSlider').value);

    const length = buffer.length + Math.ceil(decaySeconds * buffer.sampleRate);
    const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, length, buffer.sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    const convolver = offlineCtx.createConvolver();
    convolver.buffer = generateReverbImpulse(offlineCtx, decaySeconds, 2.5);
    convolver.normalize = true;

    const dryGain = offlineCtx.createGain();
    dryGain.gain.value = 1;
    const wetGain = offlineCtx.createGain();
    wetGain.gain.value = mix;

    source.connect(dryGain).connect(offlineCtx.destination);
    source.connect(convolver).connect(wetGain).connect(offlineCtx.destination);

    source.start();
    return await offlineCtx.startRendering();
  });
}

async function editorApplyChorus(){
  await runEffectButton('chorusApplyBtn', 'chorusApplyLabel', 'RENDERING…', async (buffer) => {
    const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    const delay = offlineCtx.createDelay(0.05);
    delay.delayTime.value = 0.022;

    const lfo = offlineCtx.createOscillator();
    lfo.frequency.value = 1.2; // Hz — slow modulation
    const lfoGain = offlineCtx.createGain();
    lfoGain.gain.value = 0.006; // modulation depth, in seconds
    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    lfo.start();

    const dryGain = offlineCtx.createGain();
    dryGain.gain.value = 0.7;
    const wetGain = offlineCtx.createGain();
    wetGain.gain.value = 0.5;

    source.connect(dryGain).connect(offlineCtx.destination);
    source.connect(delay).connect(wetGain).connect(offlineCtx.destination);

    source.start();
    return await offlineCtx.startRendering();
  });
}

async function editorApplyTelephone(){
  await runEffectButton('telephoneApplyBtn', 'telephoneApplyLabel', 'RENDERING…', async (buffer) => {
    const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    const highpass = offlineCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 300;

    const lowpass = offlineCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3400;

    // A little grit/saturation sells the "old phone line" character
    const shaper = offlineCtx.createWaveShaper();
    const curve = new Float32Array(256);
    for(let i = 0; i < 256; i++){
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2);
    }
    shaper.curve = curve;

    source.connect(highpass).connect(lowpass).connect(shaper).connect(offlineCtx.destination);

    source.start();
    return await offlineCtx.startRendering();
  });
}

/* ---------------- Export ---------------- */

function editorDownload(){
  const buffer = currentEditorBuffer();
  if(!buffer) return;
  const blob = audioBufferToWavBlob(buffer);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'voice-forge-edited-audio.wav';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Encodes an AudioBuffer as a 16-bit PCM WAV Blob — the Web Audio API has
// no built-in encoder, so this writes the WAV header and sample data by hand.
function audioBufferToWavBlob(buffer){
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrayBuffer);

  function writeString(offset, str){
    for(let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  const channels = [];
  for(let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));

  let offset = 44;
  for(let i = 0; i < buffer.length; i++){
    for(let ch = 0; ch < numChannels; ch++){
      let sample = Math.max(-1, Math.min(1, channels[ch][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
