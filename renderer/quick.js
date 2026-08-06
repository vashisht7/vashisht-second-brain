/* quick.js – Rishi Jarvis Siri Orb HUD v7.0 (Private Voice Mode) */
'use strict';

const SILENCE_MS = 3000; // 3 seconds silence timeout max

class NoSpeechError extends Error {
  constructor(message = 'No speech detected') {
    super(message);
    this.name = 'NoSpeechError';
  }
}

const state = {
  conversationId: null, busy: false, recording: false, voiceRequested: false,
  stream: null, context: null, source: null, processor: null, mute: null,
  chunks: [], started: 0, clock: null,
  silenceTimer: null, lastSoundAt: 0, peakEnergy: 0,
  imageAttachments: [],
  isExpanded: false,
};

const $ = (id) => document.getElementById(id);
const prompt = $('prompt'), mic = $('mic'), send = $('send');
const status = $('status'), answer = $('answer'), answerText = $('answerText');
const attachBtn = $('attachBtn');
const orbBar = $('orbBar');
const orbStatus = $('orbStatus');
const expandedPanel = $('expandedPanel');
const expandToggleBtn = $('expandToggleBtn');

/* ── Stop Intent Helper ────────────────────────────────────── */
function isStopIntent(text) {
  const norm = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const stopPhrases = [
    'thats it', 'that is it', 'thats all', 'that is all', 'no', 'nope',
    'nothing else', 'no thanks', 'no thank you', 'stop', 'bye', 'goodbye',
    'im good', 'i am good', 'done', 'thats everything', 'all set', 'exit',
    'no thats it', 'no that is all', 'nothing', 'close'
  ];
  return stopPhrases.includes(norm) || stopPhrases.some(p => norm.startsWith(p) && norm.length <= p.length + 6);
}

/* ── Window resize & Mode helpers ──────────────────────────── */
function setExpandedMode(expand) {
  state.isExpanded = expand;
  expandedPanel.hidden = !expand;
  const shell = $('quickShell');
  if (shell) shell.classList.toggle('expanded', expand);
  if (expandToggleBtn) {
    expandToggleBtn.innerHTML = expand
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    expandToggleBtn.title = expand ? 'Collapse chat' : 'Open chat & files';
  }
  if (!expand) {
    window.brain?.resizeQuickWindow?.(440, 72);
  } else {
    const hasAnswer = !answer.hidden;
    window.brain?.resizeQuickWindow?.(440, hasAnswer ? 380 : 160);
  }
}

function collapseWindow() {
  answer.hidden = true;
  status.hidden = true;
  setExpandedMode(false);
}

function expandWindow(hasAnswer) {
  answer.hidden = false;
  status.hidden = false;
  setExpandedMode(true);
}

function setOrbState(mode) {
  // mode: 'idle' | 'recording' | 'speaking' | 'thinking'
  if (!orbBar) return;
  orbBar.classList.remove('recording', 'speaking');
  if (mode === 'recording') orbBar.classList.add('recording');
  if (mode === 'speaking') orbBar.classList.add('speaking');
}

function showStatus(text) {
  if (orbStatus) orbStatus.textContent = text || 'Listening for "Hey Rishi"…';
  if (status) {
    status.textContent = text;
    status.hidden = !text;
  }
}

function renderQuickAttachments() {
  const strip = $('attachmentStrip');
  if (!strip) return;
  strip.innerHTML = '';
  if (!state.imageAttachments.length) {
    strip.hidden = true;
    return;
  }
  strip.hidden = false;
  state.imageAttachments.forEach((att, idx) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    chip.innerHTML = `<span>📷 ${att.name}</span>`;
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.onclick = (e) => {
      e.stopPropagation();
      state.imageAttachments.splice(idx, 1);
      renderQuickAttachments();
    };
    chip.appendChild(btn);
    strip.appendChild(chip);
  });
}

/* ── Audio utilities ───────────────────────────────────────── */
function resetAudio() {
  if (state.clock) clearInterval(state.clock);
  if (state.silenceTimer) clearTimeout(state.silenceTimer);
  state.clock = state.silenceTimer = null;
  if (state.processor) state.processor.onaudioprocess = null;
  [state.source, state.processor, state.mute].forEach((n) => { try { n?.disconnect(); } catch (_) {} });
  state.stream?.getTracks().forEach((t) => t.stop());
  state.context?.close().catch(() => {});
  state.stream = state.context = state.source = state.processor = state.mute = null;
  state.recording = false;
  state.voiceRequested = false;
  setOrbState('idle');
  if (mic) {
    mic.classList.remove('recording', 'processing');
    mic.disabled = false;
    mic.setAttribute('aria-label', 'Voice input');
  }
}

function downsample(samples, sourceRate, targetRate = 16000) {
  if (sourceRate === targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio), end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end && j < samples.length; j++) sum += samples[j];
    out[i] = sum / Math.max(1, Math.min(end, samples.length) - start);
  }
  return out;
}

function speechSamples(chunks, rate) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (!total) throw new NoSpeechError('No audio captured');
  const joined = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  const samples = downsample(joined, rate);
  const frame = 320, levels = [];
  for (let i = 0; i < samples.length; i += frame) {
    let e = 0, end = Math.min(samples.length, i + frame);
    for (let j = i; j < end; j++) e += samples[j] ** 2;
    levels.push(Math.sqrt(e / Math.max(1, end - i)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const threshold = Math.min(0.025, Math.max(0.005, floor * 2.8));
  const voiced = levels.map((v, i) => v >= threshold ? i : -1).filter((i) => i >= 0);
  if (voiced.length < 3) throw new NoSpeechError('No clear speech detected');
  const first = Math.max(0, voiced[0] * frame - 3200);
  const last = Math.min(samples.length, (voiced.at(-1) + 1) * frame + 4000);
  return samples.slice(first, last);
}

function wav(samples, rate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buffer);
  const write = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  write(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  write(36, 'data'); v.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * (x < 0 ? 0x8000 : 0x7fff), true));
  return new Uint8Array(buffer);
}

/* ── Ask Rishi (Private Session, 3s Timeout, Immediate Close on Stop) ── */
async function ask(text) {
  text = (text || '').trim();
  if (!text && state.imageAttachments.length) {
    text = 'Read and summarize the attached image.';
  }
  if (!text || state.busy) return;

  // Handle Stop Intent: Close popup immediately and sign off
  if (isStopIntent(text)) {
    state.closing = true;
    if (state.currentFetchController) {
      try { state.currentFetchController.abort(); } catch (_) {}
      state.currentFetchController = null;
    }
    window.brain.stopSpeaking();
    resetAudio();
    showStatus('Signing off…');
    window.brain.hideQuickWindow();
    try {
      await window.brain.speakText("Signing off.");
    } catch (_) {}
    state.closing = false;
    state.busy = false;
    return;
  }

  state.busy = true;
  if (send) send.disabled = true;
  if (mic) mic.disabled = true;
  if (prompt) prompt.value = '';
  const currentImages = [...state.imageAttachments];
  state.imageAttachments = [];
  renderQuickAttachments();

  showStatus('Rishi is thinking…');
  setOrbState('thinking');

  state.currentFetchController = new AbortController();

  try {
    const payload = await window.brain.api('/api/chat', {
      method: 'POST',
      signal: state.currentFetchController.signal,
      body: JSON.stringify({
        message: text,
        conversationId: state.conversationId,
        audience: 'self',
        toggles: { privateSession: true, deepThink: false }, // Private session: no chat history stored
        responseMode: 'voice',
        imageAttachments: currentImages
      }),
    });
    if (payload.conversationId) state.conversationId = payload.conversationId;
    if (answerText) answerText.textContent = payload.message;

    let spokenMessage = payload.message || '';
    if (!spokenMessage.toLowerCase().includes('anything else')) {
      spokenMessage += ' Anything else?';
    }

    showStatus('Rishi responding…');
    setOrbState('speaking');
    await window.brain.speakText(spokenMessage);
    setOrbState('idle');
    showStatus('Listening for follow-up… (or say "That\'s it")');

    // Auto re-arm microphone recording for continuous voice conversation loop
    setTimeout(() => {
      if (!state.recording && !state.busy) {
        startRecording();
      }
    }, 500);

  } catch (error) {
    if (answerText) answerText.textContent = `Error: ${error.message}`;
    showStatus(`Error: ${error.message}`);
    setOrbState('idle');
  } finally {
    state.busy = false;
    if (mic) { mic.classList.remove('processing'); mic.disabled = false; }
    if (send) send.disabled = false;
    if (state.isExpanded && prompt) prompt.focus();
  }
}

/* ── Silence detector inside recording loop (3s max) ───────── */
function armSilenceTimer() {
  if (state.silenceTimer) clearTimeout(state.silenceTimer);
  state.silenceTimer = setTimeout(() => {
    if (state.recording) stopRecording();
  }, SILENCE_MS);
}

/* ── Recording ─────────────────────────────────────────────── */
async function startRecording() {
  if (state.recording || state.closing) return;
  state.voiceRequested = true;
  showStatus('Listening… (max 3s silence)');
  const allowed = await window.brain.requestMicrophone();
  if (!state.voiceRequested) return;
  if (!allowed) { state.voiceRequested = false; showStatus('Mic access denied in System Settings'); return; }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  if (!state.voiceRequested) { stream.getTracks().forEach((t) => t.stop()); return; }
  state.stream = stream;
  state.context = new AudioContext();
  await state.context.resume();
  if (!state.voiceRequested) { resetAudio(); return; }
  state.source = state.context.createMediaStreamSource(state.stream);
  state.processor = state.context.createScriptProcessor(4096, 1, 1);
  state.mute = state.context.createGain();
  state.mute.gain.value = 0;
  state.chunks = [];
  state.recording = true;
  state.started = Date.now();
  state.lastSoundAt = Date.now();

  setOrbState('recording');

  state.processor.onaudioprocess = (e) => {
    if (!state.recording) return;
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    state.chunks.push(data);
    let energy = 0;
    for (let i = 0; i < data.length; i++) energy += data[i] ** 2;
    energy = Math.sqrt(energy / data.length);
    if (energy > 0.005) {
      state.lastSoundAt = Date.now();
      armSilenceTimer();
    }
  };

  state.source.connect(state.processor);
  state.processor.connect(state.mute);
  state.mute.connect(state.context.destination);
  if (mic) {
    mic.classList.add('recording');
    mic.setAttribute('aria-label', 'Stop recording');
  }
  showStatus('Listening… speak now');
  armSilenceTimer();

  state.clock = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.started) / 1000);
    showStatus(`Listening · ${elapsed}s`);
  }, 500);
}

async function stopRecording() {
  state.voiceRequested = false;
  if (!state.recording) return;
  const chunks = state.chunks, rate = state.context?.sampleRate || 48000;
  state.recording = false;
  if (mic) {
    mic.classList.remove('recording');
    mic.classList.add('processing');
    mic.disabled = true;
  }
  resetAudio();
  if (mic) {
    mic.classList.add('processing');
    mic.disabled = true;
  }
  showStatus('Transcribing…');
  setOrbState('thinking');

  try {
    const samples = speechSamples(chunks, rate);
    const result = await window.brain.transcribeAudio(wav(samples), 'audio/wav');
    const text = (result?.text || '').trim();
    if (!text) {
      showStatus('Listening for "Hey Rishi"…');
      setOrbState('idle');
      return;
    }
    if (prompt) prompt.value = text;
    showStatus(`Understood: "${text}"`);
    await ask(text);
  } catch (error) {
    const isNoSpeech = error.name === 'NoSpeechError' ||
                       error.message?.includes('speech') ||
                       error.message?.includes('empty') ||
                       error.message?.includes('No audio');
    if (isNoSpeech) {
      showStatus('Listening for "Hey Rishi"…');
    } else {
      showStatus(`Error: ${error.message}`);
    }
    setOrbState('idle');
  } finally {
    if (mic) {
      mic.classList.remove('processing');
      mic.disabled = false;
    }
  }
}

/* ── Event Wiring & Interaction ───────────────────────────── */
if (orbBar) {
  orbBar.onclick = (e) => {
    if (e.target.closest('#close')) return;
    // If speaking or thinking, stop speech & cancel request immediately
    if (state.busy || orbBar.classList.contains('speaking')) {
      if (state.currentFetchController) {
        try { state.currentFetchController.abort(); } catch (_) {}
        state.currentFetchController = null;
      }
      window.brain.stopSpeaking();
      resetAudio();
      state.busy = false;
      showStatus('Voice stopped');
      setOrbState('idle');
      return;
    }
    setExpandedMode(!state.isExpanded);
  };
}

if (expandToggleBtn) {
  expandToggleBtn.onclick = (e) => {
    e.stopPropagation();
    setExpandedMode(!state.isExpanded);
  };
}

if ($('composer')) {
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); ask(prompt.value); });
}

if (mic) {
  mic.onclick = (e) => {
    e.stopPropagation();
    if (state.busy || orbBar?.classList.contains('speaking')) {
      if (state.currentFetchController) {
        try { state.currentFetchController.abort(); } catch (_) {}
        state.currentFetchController = null;
      }
      window.brain.stopSpeaking();
      resetAudio();
      state.busy = false;
      showStatus('Voice stopped');
      setOrbState('idle');
      return;
    }
    state.recording ? stopRecording() : startRecording().catch((err) => { resetAudio(); showStatus(err.message); });
  };
}

if ($('copy')) {
  $('copy').onclick = async () => { if (answerText) await window.brain.copyText(answerText.textContent); showStatus('Copied to clipboard'); };
}
if ($('speak')) {
  $('speak').onclick = () => { if (answerText) { setOrbState('speaking'); window.brain.speakText(answerText.textContent); } };
}
if ($('stopSpeech')) {
  $('stopSpeech').onclick = () => { setOrbState('idle'); window.brain.stopSpeaking(); };
}

if ($('close')) {
  $('close').onclick = (e) => {
    e.stopPropagation();
    state.closing = true;
    if (state.currentFetchController) {
      try { state.currentFetchController.abort(); } catch (_) {}
      state.currentFetchController = null;
    }
    window.brain.stopSpeaking();
    resetAudio();
    state.busy = false;
    window.brain.hideQuickWindow();
    state.closing = false;
  };
}
if ($('newChat')) {
  $('newChat').onclick = () => {
    state.conversationId = null;
    collapseWindow();
    if (answerText) answerText.textContent = '';
    if (prompt) prompt.value = '';
    window.brain.stopSpeaking();
  };
}

if (attachBtn) {
  attachBtn.onclick = async (e) => {
    e.stopPropagation();
    try {
      const imgRes = await window.brain.addImages?.();
      if (imgRes?.added?.length) {
        state.imageAttachments.push(...imgRes.added);
        renderQuickAttachments();
        showStatus(`${imgRes.added.length} image(s) attached`);
        return;
      }
      const result = await window.brain.addFiles?.();
      if (result?.added?.length) showStatus(`${result.added.length} file(s) attached`);
    } catch (_) {}
  };
}

['dragover', 'dragenter'].forEach((evt) => {
  document.body.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); });
});

document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  setExpandedMode(true);
  try {
    const result = await window.brain.addImages?.();
    if (result?.added?.length) {
      state.imageAttachments.push(...result.added);
      renderQuickAttachments();
      showStatus(`${result.added.length} image(s) attached`);
    }
  } catch (_) {}
});

if (prompt) {
  prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(prompt.value); }
    if (e.key === 'Escape') window.brain.hideQuickWindow();
  });

  prompt.addEventListener('input', () => {
    prompt.style.height = 'auto';
    prompt.style.height = Math.min(prompt.scrollHeight, 80) + 'px';
  });
}

// Default initialization: compact glowing Siri orb mode
setExpandedMode(false);

window.brain?.onQuickFocus?.(() => {
  if (state.isExpanded && prompt) prompt.focus();
});
window.brain?.onQuickVoiceStart?.(() => startRecording().catch((e) => { resetAudio(); showStatus(e.message); }));
window.brain?.onQuickVoiceStop?.(() => stopRecording());
