const state = {
  status: null,
  conversations: [],
  conversationId: null,
  sending: false,
  recording: false,
  transcribing: false,
  voiceMode: 'idle',
  voiceSession: 0,
  voiceStream: null,
  voiceContext: null,
  voiceSource: null,
  voiceProcessor: null,
  voiceMute: null,
  voiceSamples: [],
  voiceStartedAt: 0,
  voiceStopTimer: null,
  voiceClock: null,
  composerMode: null,
  deepThink: false,
  imageAttachments: []
};

const $ = (id) => document.getElementById(id);
const elements = {
  messages: $('messages'), prompt: $('prompt'), composer: $('composer'), send: $('sendButton'),
  conversations: $('conversationList'), title: $('chatTitle'), audience: $('audience'),
  private: $('privateToggle'), voice: $('voiceButton'),
  permission: $('permissionNote'), activeTools: $('activeTools'), plus: $('plusButton'),
  plusMenu: $('plusMenu'), modeChip: $('modeChip'), attachmentStrip: $('attachmentStrip')
};

async function api(route, options) { return window.brain.api(route, options); }

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
}

function toolState() {
  return {
    privateSession: elements.private.checked,
    deepThink: state.deepThink
  };
}

function updateTools() {
  const enabled = [];
  enabled.push('Automatic context');
  if (elements.audience.value === 'self') enabled.push('Private facts automatic');
  if (elements.private.checked) enabled.push('Not saved');
  if (state.deepThink) enabled.push('Think');
  elements.activeTools.textContent = enabled.join(' · ') || 'No tools';
  const shared = elements.audience.value !== 'self';
  document.querySelector('.tool.vault').classList.toggle('disabled', shared);
  elements.permission.textContent = shared ? 'Automatic routing is active; protected information is disabled in shared conversations.' : 'Automatic routing chooses local knowledge, live web, or the protected vault.';
  $('modeDescription').textContent = shared ? 'Shared profile · protected information disabled' : (elements.private.checked ? 'Private session · conversation will not be saved' : 'Your private, source-grounded assistant');
}

function addMessage(role, content, sources = [], pending = false) {
  $('welcome')?.remove();
  const wrapper = document.createElement('article');
  wrapper.className = `message ${role}`;
  wrapper.innerHTML = `<div class="avatar">${role === 'assistant' ? 'VD' : 'You'}</div><div><div class="bubble ${pending ? 'thinking' : ''}">${escapeHtml(content)}</div><div class="source-list"></div></div>`;
  const sourceList = wrapper.querySelector('.source-list');
  sources.forEach((source) => {
    const button = document.createElement('button');
    button.className = 'source-chip';
    button.textContent = source.kind === 'web' ? `Web · ${source.title}` : `${source.kind === 'vault' ? 'Vault' : 'Source'} · ${source.label}`;
    button.onclick = () => source.url ? window.brain.openExternal(source.url) : (source.path ? window.brain.openPath(source.path) : null);
    sourceList.appendChild(button);
  });
  elements.messages.appendChild(wrapper);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return wrapper;
}

async function refreshConversations() {
  const payload = await api('/api/conversations');
  state.conversations = payload.conversations;
  elements.conversations.innerHTML = '';
  payload.conversations.forEach((conversation) => {
    const button = document.createElement('button');
    button.className = `conversation-item ${conversation.id === state.conversationId ? 'active' : ''}`;
    button.textContent = conversation.title;
    button.onclick = () => openConversation(conversation);
    elements.conversations.appendChild(button);
  });
}

async function openConversation(conversation) {
  state.conversationId = conversation.id;
  elements.title.textContent = conversation.title;
  elements.audience.value = conversation.audience;
  updateTools();
  const payload = await api(`/api/conversations/${conversation.id}`);
  elements.messages.innerHTML = '';
  payload.messages.forEach((message) => addMessage(message.role, message.content, message.sources || []));
  refreshConversations();
}

function newConversation() {
  if (state.voiceMode === 'recording') stopVoice(state.voiceSession);
  state.imageAttachments = [];
  renderAttachments();
  resetComposerMode();
  state.conversationId = null;
  elements.title.textContent = 'New conversation';
  elements.messages.innerHTML = `<div class="welcome" id="welcome"><div class="orb"><span></span></div><h2>Your memory, available locally.</h2><p>Ask about your documents, projects, conversations or writing. Every personal answer can point back to its source.</p><div class="suggestions"><button>What projects have I worked on?</button><button>Summarize my writing style.</button><button>What did I build in StudyBuddy?</button></div></div>`;
  bindSuggestions();
  refreshConversations();
}

async function sendMessage(event) {
  event?.preventDefault();
  let message = elements.prompt.value.trim();
  if (!message && state.imageAttachments.length) message = 'Read and summarize the attached image.';
  if (!message || state.sending) return;
  state.sending = true;
  elements.send.disabled = true;
  elements.voice.disabled = true;
  elements.prompt.value = '';
  addMessage('user', message);
  const pending = addMessage('assistant', 'Thinking', [], true);
  try {
    if (state.composerMode === 'remember') {
      const payload = await api('/api/memory', { method: 'POST', body: JSON.stringify({ content: message }) });
      pending.remove();
      addMessage('assistant', payload.message);
      resetComposerMode();
      return;
    }
    if (state.composerMode === 'train') {
      const payload = await api('/api/training-example', { method: 'POST', body: JSON.stringify({ content: message }) });
      pending.remove();
      addMessage('assistant', payload.message);
      resetComposerMode();
      setTimeout(refreshStatus, 500);
      return;
    }
    const payload = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, conversationId: state.conversationId, audience: elements.audience.value, toggles: toolState(), imageAttachments: state.imageAttachments })
    });
    pending.remove();
    addMessage('assistant', payload.message, payload.sources);
    elements.activeTools.textContent = `Used · ${payload.route?.label || 'Local model'}`;
    if (!elements.private.checked) {
      if (payload.conversationId) state.conversationId = payload.conversationId;
      elements.title.textContent = message.slice(0, 52) + (message.length > 52 ? '…' : '');
      await refreshConversations();
    }
    state.imageAttachments = [];
    renderAttachments();
    if (state.deepThink) resetComposerMode();
  } catch (error) {
    pending.remove();
    addMessage('assistant', `I couldn't complete that request: ${error.message}`);
  } finally {
    state.sending = false;
    elements.send.disabled = false;
    elements.voice.disabled = state.voiceMode !== 'idle';
    elements.prompt.focus();
  }
}

function releaseVoiceHardware() {
  if (state.voiceStopTimer) clearTimeout(state.voiceStopTimer);
  if (state.voiceClock) clearInterval(state.voiceClock);
  state.voiceStopTimer = null;
  state.voiceClock = null;
  if (state.voiceProcessor) state.voiceProcessor.onaudioprocess = null;
  for (const node of [state.voiceSource, state.voiceProcessor, state.voiceMute]) {
    try { node?.disconnect(); } catch (_) { /* Already disconnected. */ }
  }
  state.voiceStream?.getTracks().forEach((track) => track.stop());
  state.voiceContext?.close().catch(() => {});
  state.voiceStream = null;
  state.voiceContext = null;
  state.voiceSource = null;
  state.voiceProcessor = null;
  state.voiceMute = null;
  elements.voice.style.removeProperty('--voice-ring');
}

function setVoiceMode(mode, detail = '') {
  state.voiceMode = mode;
  state.recording = mode === 'recording';
  state.transcribing = mode === 'processing';
  elements.voice.classList.toggle('recording', state.recording);
  elements.voice.classList.toggle('processing', state.transcribing);
  elements.voice.classList.toggle('stopping', mode === 'stopping' || mode === 'starting');
  elements.voice.disabled = state.transcribing || mode === 'stopping' || mode === 'starting' || state.sending;
  elements.voice.setAttribute('aria-label', state.recording ? 'Stop recording' : 'Ask by voice');
  elements.voice.title = state.recording ? 'Stop dictation' : 'Dictate a question';
  if (mode === 'recording') {
    elements.activeTools.textContent = 'Listening · tap the stop square when finished';
    elements.permission.textContent = 'Listening locally… Speak naturally and pause when finished.';
  } else if (mode === 'processing') {
    elements.activeTools.textContent = 'Transcribing locally with MLX Whisper';
    elements.permission.textContent = 'Turning your voice into a question…';
  } else if (mode === 'stopping') {
    elements.activeTools.textContent = 'Recording stopped';
    elements.permission.textContent = 'Microphone is off · preparing local transcription…';
  } else if (mode === 'starting') {
    elements.activeTools.textContent = 'Starting microphone';
    elements.permission.textContent = 'Requesting local microphone access…';
  } else if (detail) {
    elements.permission.textContent = detail;
    updateTools();
    elements.permission.textContent = detail;
  } else {
    updateTools();
  }
}

function downsample(samples, sourceRate, targetRate = 16000) {
  if (sourceRate === targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let source = start; source < end && source < samples.length; source += 1) sum += samples[source];
    output[index] = sum / Math.max(1, Math.min(end, samples.length) - start);
  }
  return output;
}

function prepareSpeechSamples(chunks, sourceRate) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!total) throw new Error('No microphone audio was captured');
  const joined = new Float32Array(total);
  let offset = 0;
  chunks.forEach((chunk) => { joined.set(chunk, offset); offset += chunk.length; });
  const samples = downsample(joined, sourceRate);
  const frameSize = 320;
  const levels = [];
  for (let start = 0; start < samples.length; start += frameSize) {
    let energy = 0;
    const end = Math.min(samples.length, start + frameSize);
    for (let index = start; index < end; index += 1) energy += samples[index] ** 2;
    levels.push(Math.sqrt(energy / Math.max(1, end - start)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const threshold = Math.min(0.025, Math.max(0.006, noiseFloor * 3.2));
  const voiced = levels.map((level, index) => level >= threshold ? index : -1).filter((index) => index >= 0);
  if (voiced.length < 4) throw new Error('I could not hear clear speech. Hold the microphone closer and try again.');
  const first = Math.max(0, voiced[0] * frameSize - 3200);
  const last = Math.min(samples.length, (voiced[voiced.length - 1] + 1) * frameSize + 4000);
  const trimmed = samples.slice(first, last);
  if (trimmed.length < 6400) throw new Error('Please speak for at least half a second.');
  let peak = 0;
  for (const sample of trimmed) peak = Math.max(peak, Math.abs(sample));
  if (peak < 0.012) throw new Error('The recording was too quiet. Move closer to the microphone and try again.');
  const gain = Math.min(3, 0.8 / peak);
  if (gain > 1) for (let index = 0; index < trimmed.length; index += 1) trimmed[index] *= gain;
  return trimmed;
}

function encodeWav(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

async function transcribeVoiceRecording(chunks, sampleRate) {
  if (!chunks.length) return setVoiceMode('idle', 'The microphone recording was empty.');
  setVoiceMode('processing');
  try {
    const bytes = encodeWav(prepareSpeechSamples(chunks, sampleRate));
    const result = await window.brain.transcribeAudio(bytes, 'audio/wav');
    elements.prompt.value = result.text;
    elements.prompt.dispatchEvent(new Event('input'));
    setVoiceMode('idle', 'Transcribed locally · review the text or press Send.');
    elements.prompt.focus();
  } catch (error) {
    setVoiceMode('idle', `Voice command failed: ${error.message}`);
  }
}

async function stopVoice(session = state.voiceSession) {
  if (state.voiceMode !== 'recording' || session !== state.voiceSession) return;
  setVoiceMode('stopping');
  const chunks = state.voiceSamples;
  const sampleRate = state.voiceContext?.sampleRate || 48000;
  state.voiceSamples = [];
  releaseVoiceHardware();
  await transcribeVoiceRecording(chunks, sampleRate);
}

async function toggleVoice() {
  if (state.voiceMode === 'recording') return stopVoice(state.voiceSession);
  if (state.voiceMode !== 'idle' || state.sending) return;
  const session = ++state.voiceSession;
  setVoiceMode('starting');
  try {
    const allowed = await window.brain.requestMicrophone();
    if (session !== state.voiceSession) return;
    if (!allowed) {
      return setVoiceMode('idle', 'Microphone access is off. Enable it in System Settings → Privacy & Security → Microphone.');
    }
    state.voiceStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    state.voiceContext = new AudioContext();
    await state.voiceContext.resume();
    state.voiceSource = state.voiceContext.createMediaStreamSource(state.voiceStream);
    state.voiceProcessor = state.voiceContext.createScriptProcessor(4096, 1, 1);
    state.voiceMute = state.voiceContext.createGain();
    state.voiceMute.gain.value = 0;
    state.voiceSamples = [];
    state.voiceProcessor.onaudioprocess = (event) => {
      if (!state.recording) return;
      const input = event.inputBuffer.getChannelData(0);
      state.voiceSamples.push(new Float32Array(input));
      let energy = 0;
      for (const sample of input) energy += sample ** 2;
      const level = Math.min(1, Math.sqrt(energy / input.length) * 8);
      elements.voice.style.setProperty('--voice-ring', `${3 + level * 7}px`);
    };
    state.voiceSource.connect(state.voiceProcessor);
    state.voiceProcessor.connect(state.voiceMute);
    state.voiceMute.connect(state.voiceContext.destination);
    state.voiceStartedAt = Date.now();
    setVoiceMode('recording');
    state.voiceClock = setInterval(() => {
      if (state.voiceMode !== 'recording' || session !== state.voiceSession) {
        clearInterval(state.voiceClock);
        state.voiceClock = null;
        return;
      }
      const seconds = Math.floor((Date.now() - state.voiceStartedAt) / 1000);
      elements.activeTools.textContent = `Listening · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · tap stop`;
    }, 250);
    state.voiceStopTimer = setTimeout(() => stopVoice(session), 90 * 1000);
  } catch (error) {
    releaseVoiceHardware();
    if (session === state.voiceSession) setVoiceMode('idle', `Microphone could not start: ${error.message}`);
  }
}

function metricCard(title, value, label) {
  return `<article class="card"><h3>${escapeHtml(title)}</h3><div class="metric">${escapeHtml(value)}</div><div class="metric-label">${escapeHtml(label)}</div></article>`;
}

async function refreshStatus() {
  state.status = await api('/api/status');
  $('modelLabel').textContent = state.status.model;
  $('statusDot').classList.toggle('online', state.status.localModelOnline ?? state.status.ollamaOnline);
  const migration = state.status.qwenMigration?.state || 'unknown';
  $('knowledgeDashboard').innerHTML = [
    metricCard('Indexed sources', state.status.indexFiles.toLocaleString(), 'approved local files'),
    metricCard('Searchable passages', state.status.indexChunks.toLocaleString(), state.status.embeddingModel || 'embedding index'),
    metricCard('Voice Memos', `${state.status.voiceMemos.complete}/${state.status.voiceMemos.total}`, 'transcribed locally'),
    metricCard('Apple Messages', (state.status.iMessage?.messages || 0).toLocaleString(), `${(state.status.iMessage?.conversations || 0).toLocaleString()} local conversations`),
    `<article class="card wide"><div class="card-icon">⌁</div><div><h3>Qwen migration: ${escapeHtml(migration)}</h3><p>The existing index remains available until the multilingual Qwen index passes privacy and retrieval checks.</p></div></article>`,
    `<article class="card wide"><div class="card-icon">⌾</div><div><h3>Protected vault</h3><p>${state.status.vault.documents} encrypted documents and ${state.status.vault.facts} structured facts. Documents are never embedded or used for training.</p></div></article>`
  ].join('');
  const counts = state.status.training?.counts || {};
  $('trainingDashboard').innerHTML = [
    metricCard('Training examples', ((counts.train || 0) + (counts.validation || 0) + (counts.test || 0)).toLocaleString(), 'review-only style records'),
    metricCard('Partner style', (counts.high_partner || 0).toLocaleString(), 'high-priority examples'),
    metricCard('Professional email', (counts.email_style || 0).toLocaleString(), 'authored examples'),
    metricCard('Queued by you', (state.status.training?.queued_user_examples || 0).toLocaleString(), 'awaiting reviewed training run'),
    `<article class="card wide"><div class="card-icon">◇</div><div><h3>${escapeHtml(state.status.training?.model?.status || state.status.training?.status || 'Not started')}</h3><p>The adapter is trained separately from factual knowledge. Protected information is excluded, and factual documents remain in retrieval rather than model weights.</p></div></article>`
  ].join('');
}

function bindSuggestions() {
  document.querySelectorAll('.suggestions button').forEach((button) => button.onclick = () => {
    elements.prompt.value = button.textContent;
    elements.prompt.focus();
  });
}

function closePlusMenu() {
  elements.plusMenu.hidden = true;
  elements.plus.setAttribute('aria-expanded', 'false');
}

function resetComposerMode() {
  state.composerMode = null;
  state.deepThink = false;
  elements.modeChip.hidden = true;
  elements.modeChip.textContent = '';
  elements.prompt.placeholder = 'Ask your second brain…';
  updateTools();
}

function setComposerMode(mode) {
  state.composerMode = mode === 'remember' || mode === 'train' ? mode : null;
  state.deepThink = mode === 'think' ? !state.deepThink : false;
  if (mode === 'remember') {
    elements.modeChip.textContent = 'Remember';
    elements.prompt.placeholder = 'Tell me what to remember locally…';
  } else if (mode === 'train') {
    elements.modeChip.textContent = 'Train';
    elements.prompt.placeholder = 'Paste an example of how you want the model to write…';
  } else if (state.deepThink) {
    elements.modeChip.textContent = 'Think';
    elements.prompt.placeholder = 'Ask a question for deeper reasoning…';
  } else {
    return resetComposerMode();
  }
  elements.modeChip.hidden = false;
  closePlusMenu();
  updateTools();
  elements.prompt.focus();
}

function renderAttachments() {
  elements.attachmentStrip.innerHTML = '';
  state.imageAttachments.forEach((attachment, index) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    const label = document.createElement('span');
    label.textContent = `Image · ${attachment.name}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${attachment.name}`);
    remove.textContent = '×';
    remove.onclick = () => { state.imageAttachments.splice(index, 1); renderAttachments(); };
    chip.append(label, remove);
    elements.attachmentStrip.appendChild(chip);
  });
}

async function addImages() {
  closePlusMenu();
  elements.permission.textContent = 'Choose up to four images to read locally…';
  try {
    const result = await window.brain.addImages();
    if (result.canceled) return updateTools();
    state.imageAttachments.push(...(result.added || []));
    renderAttachments();
    const rejected = result.rejected?.length ? ` ${result.rejected.length} image(s) were skipped.` : '';
    elements.permission.textContent = result.added.length
      ? `${result.added.length} image(s) read locally and attached.${rejected}`
      : `No readable images were attached.${rejected}`;
  } catch (error) {
    elements.permission.textContent = `Images could not be added: ${error.message}`;
  }
}

document.querySelectorAll('.nav-item').forEach((button) => button.onclick = () => {
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active-view'));
  button.classList.add('active');
  $(`${button.dataset.view}View`).classList.add('active-view');
});

elements.composer.addEventListener('submit', sendMessage);
elements.voice.addEventListener('click', toggleVoice);
elements.prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) sendMessage(event);
});
elements.prompt.addEventListener('input', () => {
  elements.prompt.style.height = 'auto';
  elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 170)}px`;
});
$('newChat').onclick = newConversation;
$('openBackupKit').onclick = () => addMessage('assistant', 'Backup tooling is intentionally excluded from the public repository.');
$('openQuickChat').onclick = () => window.brain.openQuickWindow();
elements.private.onchange = updateTools;
async function addFiles() {
  closePlusMenu();
  elements.permission.textContent = 'Choose supported documents to add…';
  try {
    const result = await window.brain.addFiles();
    if (result.canceled) return updateTools();
    const rejected = result.rejected?.length ? ` ${result.rejected.length} unsupported file(s) were skipped.` : '';
    elements.permission.textContent = result.added.length
      ? `${result.added.length} file(s) added. Local indexing has started.${rejected}`
      : `No supported files were added.${rejected}`;
    setTimeout(refreshStatus, 2500);
  } catch (error) {
    elements.permission.textContent = `Files could not be added: ${error.message}`;
  }
}
$('addFilesSettings').onclick = addFiles;
elements.plus.onclick = (event) => {
  event.stopPropagation();
  const opening = elements.plusMenu.hidden;
  elements.plusMenu.hidden = !opening;
  elements.plus.setAttribute('aria-expanded', String(opening));
};
document.querySelectorAll('[data-plus-action]').forEach((button) => button.onclick = () => {
  const action = button.dataset.plusAction;
  if (action === 'file') return addFiles();
  if (action === 'image') return addImages();
  setComposerMode(action);
});
document.addEventListener('click', (event) => {
  if (!elements.plusMenu.contains(event.target) && event.target !== elements.plus) closePlusMenu();
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePlusMenu(); });
elements.audience.onchange = () => {
  updateTools();
  newConversation();
};

async function initialize() {
  bindSuggestions();
  updateTools();
  await Promise.all([refreshStatus(), refreshConversations()]);
  setInterval(refreshStatus, 30000);
}

initialize().catch((error) => addMessage('assistant', `The local service could not initialize: ${error.message}`));
