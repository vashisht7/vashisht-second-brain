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
  imageAttachments: [],
  languageQuestions: [],
  skippedLanguageQuestions: new Set(),
  graphTopics: [],
  graphExpandedTopic: null,
  graphExpandedFiles: [],
  graphTransform: { x: 0, y: 0, scale: 1 },
  graphDrag: null
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

function addMessage(role, content, sources = [], pending = false, originalPrompt = '') {
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
  if (role === 'assistant' && !pending) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy';
    copy.onclick = async () => { await window.brain.copyText(content); copy.textContent = 'Copied'; };
    actions.appendChild(copy);
    if (originalPrompt) {
      const correct = document.createElement('button');
      correct.type = 'button';
      correct.textContent = 'Correct my style';
      correct.onclick = () => openStyleCorrection(originalPrompt, content, actions);
      actions.appendChild(correct);
    }
    sourceList.parentElement.appendChild(actions);
  }
  elements.messages.appendChild(wrapper);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return wrapper;
}

async function refreshConversations() {
  const payload = await api('/api/conversations');
  state.conversations = payload.conversations;
  elements.conversations.innerHTML = '';
  payload.conversations.forEach((conversation) => {
    const container = document.createElement('div');
    container.className = `conversation-item-container ${conversation.id === state.conversationId ? 'active' : ''}`;

    const button = document.createElement('button');
    button.className = 'conversation-item-btn';
    button.textContent = conversation.title;
    button.onclick = () => openConversation(conversation);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'conversation-menu-btn';
    menuBtn.innerHTML = '···';
    menuBtn.title = 'Conversation options';

    let dropdown = null;
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('.conversation-dropdown-menu').forEach(m => m.remove());
      if (dropdown) { dropdown = null; return; }
      
      dropdown = document.createElement('div');
      dropdown.className = 'conversation-dropdown-menu';
      
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-item';
      delBtn.innerHTML = '🗑 Delete chat';
      delBtn.onclick = async (evt) => {
        evt.stopPropagation();
        dropdown.remove();
        if (confirm(`Delete conversation "${conversation.title}"?`)) {
          await api('/api/conversations/delete', {
            method: 'POST',
            body: JSON.stringify({ id: conversation.id })
          });
          if (state.conversationId === conversation.id) {
            newConversation();
          } else {
            refreshConversations();
          }
        }
      };

      dropdown.appendChild(delBtn);
      container.appendChild(dropdown);

      const closeMenu = (event) => {
        if (!container.contains(event.target)) {
          dropdown?.remove();
          document.removeEventListener('click', closeMenu);
        }
      };
      setTimeout(() => document.addEventListener('click', closeMenu), 10);
    };

    container.appendChild(button);
    container.appendChild(menuBtn);
    elements.conversations.appendChild(container);
  });
}

async function openConversation(conversation) {
  state.conversationId = conversation.id;
  elements.title.textContent = conversation.title;
  elements.audience.value = conversation.audience;
  updateTools();
  const payload = await api(`/api/conversations/${conversation.id}`);
  elements.messages.innerHTML = '';
  let priorUserMessage = '';
  payload.messages.forEach((message) => {
    addMessage(message.role, message.content, message.sources || [], false, message.role === 'assistant' ? priorUserMessage : '');
    if (message.role === 'user') priorUserMessage = message.content;
  });
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
    addMessage('assistant', payload.message, payload.sources, false, message);
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

async function openStyleCorrection(originalPrompt, assistantResponse, container) {
  if (container.querySelector('.correction-editor')) return;
  const editor = document.createElement('div');
  editor.className = 'correction-editor';
  editor.innerHTML = `<label>How would you say it?</label><textarea rows="3" placeholder="Type your corrected reply, including your natural Telugu-English mix…"></textarea><div><button type="button" class="save-correction">Learn this correction</button><button type="button" class="cancel-correction">Cancel</button></div><small>This stays local now and enters the privacy-reviewed retraining queue.</small>`;
  container.appendChild(editor);
  const textarea = editor.querySelector('textarea');
  editor.querySelector('.cancel-correction').onclick = () => editor.remove();
  editor.querySelector('.save-correction').onclick = async () => {
    const correctedResponse = textarea.value.trim();
    if (!correctedResponse) return textarea.focus();
    const save = editor.querySelector('.save-correction');
    save.disabled = true;
    save.textContent = 'Learning…';
    try {
      const result = await api('/api/style-correction', {
        method: 'POST',
        body: JSON.stringify({ prompt: originalPrompt, assistantResponse, correctedResponse, audience: elements.audience.value })
      });
      editor.innerHTML = `<small class="correction-saved">${escapeHtml(result.message)}</small>`;
      setTimeout(refreshStatus, 500);
    } catch (error) {
      save.disabled = false;
      save.textContent = 'Learn this correction';
      editor.querySelector('small').textContent = `Could not learn: ${error.message}`;
    }
  };
  textarea.focus();
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

function miniStat(label, value) {
  return `<div class="mini-stat"><span class="mini-stat-value">${escapeHtml(String(value))}</span><span class="mini-stat-label">${escapeHtml(label)}</span></div>`;
}

async function refreshStatus() {
  state.status = await api('/api/status');
  $('modelLabel').textContent = state.status.model;
  $('statusDot').classList.toggle('online', state.status.localModelOnline ?? state.status.ollamaOnline);
  // Compact knowledge stats strip (mini, not full cards — graph is dominant)
  $('knowledgeDashboard').innerHTML = `<div class="mini-stat-row">
    ${miniStat('Sources', state.status.indexFiles.toLocaleString())}
    ${miniStat('Passages', state.status.indexChunks.toLocaleString())}
    ${miniStat('Voice memos', `${state.status.voiceMemos.complete}/${state.status.voiceMemos.total}`)}
    ${miniStat('Messages', (state.status.iMessage?.messages || 0).toLocaleString())}
    ${miniStat('Vault docs', state.status.vault?.documents ?? '—')}
  </div>`;
  const counts = state.status.training?.counts || {};
  $('trainingDashboard').innerHTML = [
    metricCard('Training examples', ((counts.train || 0) + (counts.validation || 0) + (counts.test || 0)).toLocaleString(), 'review-only style records'),
    metricCard('Style adapter', (counts.high_charvi || counts.high_partner || 0).toLocaleString(), 'high-priority examples'),
    metricCard('Professional email', (counts.email_style || 0).toLocaleString(), 'authored examples'),
    metricCard('Queued by you', (state.status.training?.queued_user_examples || 0).toLocaleString(), 'awaiting next training run'),
    metricCard('Grammar interview', `${state.status.training?.language_interview?.answered || 0}/${state.status.training?.language_interview?.total || 40}`, 'Telugu-English answers'),
    `<article class="card wide"><div class="card-icon">◇</div><div><h3>${escapeHtml(state.status.training?.model?.status || state.status.training?.status || 'Not started')}</h3><p>The adapter is trained separately from factual knowledge. Protected information is excluded, and factual documents remain in retrieval rather than model weights.</p></div></article>`
  ].join('');
  // Timestamps
  if ($('lastIndexedLabel')) $('lastIndexedLabel').textContent = state.status.lastIndexed || 'Never';
  if ($('lastTrainedLabel')) $('lastTrainedLabel').textContent = state.status.lastTrained || 'Never';
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function topicLabelLines(name) {
  const words = name.split(/\s+/);
  const lines = [];
  words.forEach((word) => {
    const last = lines[lines.length - 1];
    if (!last || `${last} ${word}`.length > 18) lines.push(word);
    else lines[lines.length - 1] = `${last} ${word}`;
  });
  return lines.slice(0, 3);
}

function graphFileButton(file, topic) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'topic-file';
  const title = document.createElement('strong');
  title.textContent = file.title;
  const details = document.createElement('span');
  const updated = file.updatedAt ? ` · ${new Date(file.updatedAt).toLocaleDateString()}` : '';
  details.textContent = `${file.subtopic || file.kind} · ${file.chunks.toLocaleString()} passage${file.chunks === 1 ? '' : 's'}${updated}`;
  button.append(title, details);
  button.onclick = () => showKnowledgeDocument(file, topic);
  return button;
}

function addSubtopicFilters(panel, topic, payload) {
  const filters = document.createElement('div');
  filters.className = 'subtopic-filters';
  [{ name: 'All', count: payload.total }, ...(topic.subtopics || [])].forEach((subtopic) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = `${subtopic.name} ${subtopic.count}`;
    chip.onclick = async () => {
      filters.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === chip));
      const chosen = subtopic.name === 'All' ? '' : subtopic.name;
      const next = await api(`/api/knowledge-topic?topic=${encodeURIComponent(topic.name)}&subtopic=${encodeURIComponent(chosen)}`);
      renderTopicFileList(panel, topic, next);
    };
    if (subtopic.name === 'All') chip.classList.add('active');
    filters.appendChild(chip);
  });
  panel.appendChild(filters);
}

function renderTopicFileList(panel, topic, payload) {
  panel.querySelector('.topic-file-list')?.remove();
  panel.querySelector('.topic-limit-note')?.remove();
  const list = document.createElement('div');
  list.className = 'topic-file-list';
  payload.files.forEach((file) => list.appendChild(graphFileButton(file, topic)));
  if (!payload.files.length) list.innerHTML = '<div class="empty-topic compact"><strong>No matching files</strong><span>Choose another subtopic.</span></div>';
  panel.appendChild(list);
  if (payload.total > payload.files.length) {
    const note = document.createElement('small');
    note.className = 'topic-limit-note';
    note.textContent = `Showing ${payload.files.length.toLocaleString()} of ${payload.total.toLocaleString()} indexed items.`;
    panel.appendChild(note);
  }
}

async function summarizeGraphItem(type, id, output, button) {
  button.disabled = true;
  button.textContent = 'Summarizing locally…';
  try {
    const result = await api('/api/knowledge-summary', { method: 'POST', body: JSON.stringify({ type, id }) });
    output.textContent = result.summary;
    output.hidden = false;
    button.textContent = result.cached ? 'Refresh local summary' : 'Summary ready';
  } catch (error) {
    output.textContent = `Could not summarize: ${error.message}`;
    output.hidden = false;
    button.textContent = 'Try summary again';
  } finally {
    button.disabled = false;
  }
}

async function showTopicFiles(topic) {
  document.querySelectorAll('.topic-node').forEach((node) => node.classList.toggle('selected', node.dataset.topic === topic.name));
  const panel = $('topicFiles');
  panel.innerHTML = `<div class="topic-file-heading"><div><span class="eyebrow">Selected topic</span><h3>${escapeHtml(topic.name)}</h3></div><strong>${topic.count.toLocaleString()}</strong></div><div class="topic-file-loading">Loading local files…</div>`;
  try {
    const payload = await api(`/api/knowledge-topic?topic=${encodeURIComponent(topic.name)}`);
    panel.querySelector('.topic-file-loading').remove();
    const actions = document.createElement('div');
    actions.className = 'topic-actions';
    const summarize = document.createElement('button');
    summarize.textContent = topic.summary ? 'View local summary' : 'Summarize locally';
    const summary = document.createElement('div');
    summary.className = 'graph-summary';
    summary.hidden = !topic.summary;
    summary.textContent = topic.summary || '';
    summarize.onclick = () => topic.summary && summary.hidden
      ? (summary.hidden = false)
      : summarizeGraphItem('topic', topic.name, summary, summarize);
    actions.appendChild(summarize);
    panel.append(actions, summary);
    addSubtopicFilters(panel, topic, payload);
    renderTopicFileList(panel, topic, payload);
    state.graphExpandedTopic = topic;
    state.graphExpandedFiles = payload.files.slice(0, 10);
    renderKnowledgeGraph();
  } catch (error) {
    const loading = panel.querySelector('.topic-file-loading');
    if (loading) loading.textContent = `Could not load files: ${error.message}`;
  }
}

async function showKnowledgeDocument(file, topic) {
  const panel = $('topicFiles');
  panel.innerHTML = '<div class="topic-file-loading">Loading local content…</div>';
  try {
    const payload = await api(`/api/knowledge-document?id=${encodeURIComponent(file.id)}`);
    panel.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'conversation-view-heading';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'conversation-back';
    back.textContent = `‹ ${topic.name}`;
    back.onclick = () => showTopicFiles(topic);
    const titleBlock = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = payload.title === 'Unknown contact' ? file.title : payload.title;
    const meta = document.createElement('span');
    const updated = payload.updatedAt ? new Date(payload.updatedAt).toLocaleString() : 'Indexed source';
    meta.textContent = `${payload.subtopic} · ${Math.round(payload.confidence * 100)}% source confidence · ${updated}`;
    titleBlock.append(title, meta);
    heading.append(back, titleBlock);
    panel.appendChild(heading);

    const actions = document.createElement('div');
    actions.className = 'document-actions';
    const summarize = document.createElement('button');
    summarize.textContent = payload.summary ? 'View local summary' : 'Summarize locally';
    actions.appendChild(summarize);
    if (payload.path) {
      const open = document.createElement('button');
      open.textContent = 'Open source file';
      open.onclick = () => window.brain.openPath(payload.path);
      actions.appendChild(open);
    }
    panel.appendChild(actions);
    const summary = document.createElement('div');
    summary.className = 'graph-summary';
    summary.hidden = !payload.summary;
    summary.textContent = payload.summary || '';
    panel.appendChild(summary);
    summarize.onclick = () => payload.summary && summary.hidden
      ? (summary.hidden = false)
      : summarizeGraphItem('document', payload.id, summary, summarize);

    if (payload.messages) renderConversationDocument(panel, payload, file, title);
    else {
      const preview = document.createElement('div');
      preview.className = 'document-preview';
      preview.textContent = payload.excerpt || 'No readable preview is available. Open the source file to view it.';
      panel.appendChild(preview);
    }
    if (payload.related?.length) {
      const related = document.createElement('section');
      related.className = 'related-documents';
      related.innerHTML = '<h4>Related local knowledge</h4>';
      payload.related.forEach((item) => {
        const button = graphFileButton(item, state.graphTopics.find((entry) => entry.name === item.topic) || { name: item.topic });
        const reason = document.createElement('em');
        reason.textContent = item.relationship || 'Related indexed content';
        button.appendChild(reason);
        related.appendChild(button);
      });
      panel.appendChild(related);
    }
  } catch (error) {
    panel.innerHTML = `<div class="topic-file-loading">Could not display content: ${escapeHtml(error.message)}</div>`;
  }
}

function renderConversationDocument(panel, payload, file, title) {
  const controls = document.createElement('div');
  controls.className = 'conversation-controls conversation-filter-grid';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search messages…';
  const from = document.createElement('input'); from.type = 'date'; from.title = 'From date';
  const to = document.createElement('input'); to.type = 'date'; to.title = 'To date';
  controls.append(search, from, to);
  if (payload.canRename) {
    const rename = document.createElement('button');
    rename.type = 'button'; rename.textContent = 'Rename'; controls.appendChild(rename);
    rename.onclick = () => { renameEditor.hidden = !renameEditor.hidden; if (!renameEditor.hidden) nameInput.focus(); };
  }
  panel.appendChild(controls);
  const renameEditor = document.createElement('div');
  renameEditor.className = 'contact-rename-editor'; renameEditor.hidden = true;
  const nameInput = document.createElement('input'); nameInput.placeholder = 'Person or group name';
  const saveName = document.createElement('button'); saveName.type = 'button'; saveName.textContent = 'Save name';
  renameEditor.append(nameInput, saveName); panel.appendChild(renameEditor);
  saveName.onclick = async () => {
    const name = nameInput.value.trim(); if (!name) return nameInput.focus();
    saveName.disabled = true;
    try {
      await api('/api/contact-alias', { method: 'POST', body: JSON.stringify({ documentId: file.id, name }) });
      file.title = name; title.textContent = name; renameEditor.hidden = true; await refreshKnowledgeGraph();
    } catch (error) { nameInput.value = ''; nameInput.placeholder = error.message; }
    finally { saveName.disabled = false; }
  };
  const count = document.createElement('small'); count.className = 'message-result-count'; panel.appendChild(count);
  const messages = document.createElement('div'); messages.className = 'conversation-messages'; panel.appendChild(messages);
  const renderMessages = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const fromTime = from.value ? new Date(`${from.value}T00:00:00`).getTime() : -Infinity;
    const toTime = to.value ? new Date(`${to.value}T23:59:59`).getTime() : Infinity;
    const selected = payload.messages.filter((message) => {
      const time = new Date(message.time).getTime();
      return (!query || `${message.speaker} ${message.text}`.toLocaleLowerCase().includes(query)) && (Number.isNaN(time) || (time >= fromTime && time <= toTime));
    });
    count.textContent = `${selected.length.toLocaleString()} of ${payload.messages.length.toLocaleString()} recent messages`;
    messages.innerHTML = '';
    selected.forEach((message) => {
      const row = document.createElement('article'); row.className = `conversation-message ${message.speaker === 'Vashisht' ? 'mine' : ''}`;
      const speaker = document.createElement('strong'); speaker.textContent = message.speaker;
      const text = document.createElement('p'); text.textContent = message.text;
      const time = document.createElement('time'); const parsed = new Date(message.time);
      time.textContent = Number.isNaN(parsed.getTime()) ? message.time : parsed.toLocaleString();
      row.append(speaker, text, time); messages.appendChild(row);
    });
    if (!selected.length) messages.innerHTML = '<div class="empty-topic compact"><strong>No matching messages</strong><span>Change the text or date filters.</span></div>';
  };
  [search, from, to].forEach((input) => input.addEventListener('input', renderMessages));
  renderMessages();
}

function applyGraphTransform() {
  const viewport = $('graphViewport');
  if (viewport) viewport.setAttribute('transform', `translate(${state.graphTransform.x} ${state.graphTransform.y}) scale(${state.graphTransform.scale})`);
}

function setGraphZoom(nextScale, anchor = { x: 450, y: 285 }) {
  const old = state.graphTransform.scale;
  const scale = Math.max(.55, Math.min(2.4, nextScale));
  state.graphTransform.x = anchor.x - ((anchor.x - state.graphTransform.x) * scale / old);
  state.graphTransform.y = anchor.y - ((anchor.y - state.graphTransform.y) * scale / old);
  state.graphTransform.scale = scale;
  applyGraphTransform();
}

function renderKnowledgeGraph() {
  const svg = $('knowledgeGraph');
  let viewport = $('graphViewport');
  if (!viewport) {
    svg.innerHTML = '';
    viewport = svgElement('g', { id: 'graphViewport' });
    svg.appendChild(viewport);
  }
  viewport.innerHTML = '';
  const topics = state.graphTopics;
  const center = { x: 550, y: 310 };

  // Brain region color map
  const REGION_COLORS = {
    frontal:  '#a8ff78',  // green  – Logic & Code
    temporal: '#65d4ff',  // blue   – Personal Memory
    parietal: '#ffbd67',  // amber  – Technical Reference
    occipital:'#ff7478',  // coral  – Assets & Media
  };
  const DEFAULT_COLORS = ['#a8ff78', '#65d4ff', '#c59bff', '#ffbd67', '#ff7f91', '#72e7cd', '#9eb5ff', '#f1db73', '#7fdbff', '#c3ff9a', '#ff9de2'];
  const maxCount = Math.max(1, ...topics.map((topic) => topic.count));

  // Distribute topics across two rings to prevent overlap
  // Inner ring: up to 7 topics at radius 195; outer ring: remainder at 340
  const INNER_CAPACITY = 7;
  const INNER_R = 195;
  const OUTER_R = 340;

  const positions = topics.map((topic, index) => {
    const inInner = index < INNER_CAPACITY;
    const ring = inInner ? INNER_R : OUTER_R;
    const ringItems = inInner ? Math.min(INNER_CAPACITY, topics.length) : topics.length - INNER_CAPACITY;
    const ringIndex = inInner ? index : index - INNER_CAPACITY;
    // Offset outer ring by half a step so labels interleave
    const angleOffset = inInner ? -Math.PI / 2 : -Math.PI / 2 + Math.PI / Math.max(1, ringItems);
    const angle = angleOffset + (Math.PI * 2 * ringIndex) / Math.max(1, ringItems);
    const regionId = topic.region?.id;
    const color = regionId ? (REGION_COLORS[regionId] || DEFAULT_COLORS[index % DEFAULT_COLORS.length]) : DEFAULT_COLORS[index % DEFAULT_COLORS.length];
    return { topic, x: center.x + Math.cos(angle) * ring, y: center.y + Math.sin(angle) * ring, color };
  });

  const positionMap = new Map(positions.map((item) => [item.topic.name, item]));

  // Draw edges first
  positions.forEach((item) => viewport.appendChild(svgElement('line', { x1: center.x, y1: center.y, x2: item.x, y2: item.y, class: 'graph-edge' })));

  // Central brain node
  const brain = svgElement('g', { class: 'brain-node' });
  brain.appendChild(svgElement('circle', { cx: center.x, cy: center.y, r: 67 }));
  const brainTitle = svgElement('text', { x: center.x, y: center.y - 4, 'text-anchor': 'middle' });
  brainTitle.textContent = 'Vashisht';
  const brainSub = svgElement('text', { x: center.x, y: center.y + 17, 'text-anchor': 'middle', class: 'node-count' });
  brainSub.textContent = 'Second Brain';
  brain.append(brainTitle, brainSub);
  viewport.appendChild(brain);

  // Topic nodes colored by Brain Region
  positions.forEach((item) => {
    const radius = 32 + Math.sqrt(item.topic.count / maxCount) * 22;
    const group = svgElement('g', { class: 'topic-node', transform: `translate(${item.x} ${item.y})`, tabindex: '0', role: 'button', 'aria-label': `${item.topic.name}, ${item.topic.count} files` });
    group.dataset.topic = item.topic.name;
    group.style.setProperty('--node-color', item.color);
    const regionId = item.topic.region?.id || 'occipital';
    group.dataset.region = regionId;
    group.appendChild(svgElement('circle', { r: radius }));
    // Label lines with backdrop rect for readability
    const lines = topicLabelLines(item.topic.name);
    const lineH = 14;
    const totalH = lines.length * lineH;
    const maxChars = Math.max(...lines.map((l) => l.length));
    const rectW = Math.max(40, maxChars * 6.2 + 8);
    const rectH = totalH + 4;
    const backdrop = svgElement('rect', {
      x: -rectW / 2, y: -totalH / 2 - 8,
      width: rectW, height: rectH,
      rx: 4, ry: 4,
      fill: 'rgba(0,0,0,0.55)',
    });
    group.appendChild(backdrop);
    lines.forEach((line, lineIndex) => {
      const textNode = svgElement('text', { x: 0, y: (lineIndex - (lines.length - 1) / 2) * lineH - 2, 'text-anchor': 'middle' });
      textNode.textContent = line;
      group.appendChild(textNode);
    });
    const count = svgElement('text', { x: 0, y: radius - 10, 'text-anchor': 'middle', class: 'node-count' });
    count.textContent = item.topic.count.toLocaleString();
    group.appendChild(count);
    group.onclick = () => showTopicFiles(item.topic);
    group.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') showTopicFiles(item.topic); };
    viewport.appendChild(group);
  });

  // Draw expanded document nodes
  if (state.graphExpandedTopic && positionMap.has(state.graphExpandedTopic.name)) {
    const origin = positionMap.get(state.graphExpandedTopic.name);
    state.graphExpandedFiles.forEach((file, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, state.graphExpandedFiles.length);
      const distance = 90 + (index % 2) * 22;
      const x = origin.x + Math.cos(angle) * distance;
      const y = origin.y + Math.sin(angle) * distance;
      viewport.appendChild(svgElement('line', { x1: origin.x, y1: origin.y, x2: x, y2: y, class: 'graph-edge document-edge' }));
      const group = svgElement('g', { class: 'document-node', transform: `translate(${x} ${y})`, tabindex: '0', role: 'button', 'aria-label': file.title });
      group.appendChild(svgElement('circle', { r: 22 }));
      const truncated = file.title.length > 22 ? `${file.title.slice(0, 20)}…` : file.title;
      // Label backdrop for document nodes too
      const dback = svgElement('rect', { x: -40, y: 28, width: 80, height: 16, rx: 3, fill: 'rgba(0,0,0,0.6)' });
      const label = svgElement('text', { x: 0, y: 40, 'text-anchor': 'middle' });
      label.textContent = truncated;
      group.append(dback, label);
      group.onclick = (event) => { event.stopPropagation(); showKnowledgeDocument(file, state.graphExpandedTopic); };
      group.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') showKnowledgeDocument(file, state.graphExpandedTopic); };
      viewport.appendChild(group);
    });
  }

  // Brain region legend (bottom-right corner of SVG)
  let legend = svg.querySelector('.region-legend');
  if (!legend) {
    legend = svgElement('g', { class: 'region-legend', transform: 'translate(830, 530)' });
    svg.appendChild(legend);
  }
  legend.innerHTML = '';
  const regions = [
    { id: 'frontal',  color: '#a8ff78', label: 'Frontal – Logic & Code' },
    { id: 'temporal', color: '#65d4ff', label: 'Temporal – Memory' },
    { id: 'parietal', color: '#ffbd67', label: 'Parietal – Docs & PDFs' },
    { id: 'occipital',color: '#ff7478', label: 'Occipital – Media' },
  ];
  regions.forEach((r, i) => {
    const row = svgElement('g', { transform: `translate(0, ${i * 18})` });
    const dot = svgElement('circle', { cx: 5, cy: -3, r: 5, fill: r.color, opacity: '0.85' });
    const txt = svgElement('text', { x: 14, y: 0, 'font-size': '9', fill: '#aaa' });
    txt.textContent = r.label;
    row.append(dot, txt);
    legend.appendChild(row);
  });

  applyGraphTransform();
}


async function refreshKnowledgeGraph() {
  try {
    const payload = await api('/api/knowledge-graph');
    state.graphTopics = payload.topics || [];
    renderKnowledgeGraph();
    $('graphStatus').textContent = `${state.graphTopics.length} topics · ${payload.duplicatesMerged || 0} duplicate copies merged · entirely local`;
  } catch (error) {
    $('graphStatus').textContent = `Knowledge graph unavailable: ${error.message}`;
  }
}

async function searchKnowledgeGraph() {
  const query = $('graphSearch').value.trim();
  if (!query) {
    $('topicFiles').innerHTML = '<div class="empty-topic"><strong>Select a topic</strong><span>Its categorized files will appear here.</span></div>';
    return;
  }
  const panel = $('topicFiles');
  panel.innerHTML = '<div class="topic-file-loading">Searching your local index…</div>';
  try {
    const payload = await api(`/api/knowledge-search?q=${encodeURIComponent(query)}`);
    panel.innerHTML = `<div class="topic-file-heading"><div><span class="eyebrow">Across all topics</span><h3>Results for “${escapeHtml(query)}”</h3></div><strong>${payload.results.length}</strong></div>`;
    const list = document.createElement('div'); list.className = 'topic-file-list';
    payload.results.forEach((file) => list.appendChild(graphFileButton(file, state.graphTopics.find((topic) => topic.name === file.topic) || { name: file.topic })));
    if (!payload.results.length) list.innerHTML = '<div class="empty-topic compact"><strong>No local match</strong><span>Try a broader word.</span></div>';
    panel.appendChild(list);
  } catch (error) { panel.innerHTML = `<div class="topic-file-loading">Search failed: ${escapeHtml(error.message)}</div>`; }
}

function bindKnowledgeGraphControls() {
  const svg = $('knowledgeGraph');
  let searchTimer;
  $('graphSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchKnowledgeGraph, 220);
  });
  $('graphZoomIn').onclick = () => setGraphZoom(state.graphTransform.scale * 1.2);
  $('graphZoomOut').onclick = () => setGraphZoom(state.graphTransform.scale / 1.2);
  $('graphReset').onclick = () => { state.graphTransform = { x: 0, y: 0, scale: 1 }; state.graphExpandedTopic = null; state.graphExpandedFiles = []; renderKnowledgeGraph(); };
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    setGraphZoom(state.graphTransform.scale * (event.deltaY < 0 ? 1.12 : .89), { x: (event.clientX - rect.left) * 900 / rect.width, y: (event.clientY - rect.top) * 570 / rect.height });
  }, { passive: false });
  svg.addEventListener('pointerdown', (event) => {
    if (event.target.closest?.('.topic-node,.document-node')) return;
    state.graphDrag = { x: event.clientX, y: event.clientY, startX: state.graphTransform.x, startY: state.graphTransform.y };
    svg.setPointerCapture(event.pointerId); svg.classList.add('dragging');
  });
  svg.addEventListener('pointermove', (event) => {
    if (!state.graphDrag) return;
    const rect = svg.getBoundingClientRect();
    state.graphTransform.x = state.graphDrag.startX + (event.clientX - state.graphDrag.x) * 900 / rect.width;
    state.graphTransform.y = state.graphDrag.startY + (event.clientY - state.graphDrag.y) * 570 / rect.height;
    applyGraphTransform();
  });
  const stop = () => { state.graphDrag = null; svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup', stop); svg.addEventListener('pointercancel', stop);
}

function renderLanguageQuestion() {
  const available = state.languageQuestions.filter((item) => !item.answered && !state.skippedLanguageQuestions.has(item.id));
  const answered = state.languageQuestions.filter((item) => item.answered).length;
  const total = state.languageQuestions.length || 40;
  $('languageProgress').textContent = `${answered}/${total}`;
  $('languageProgressBar').style.width = `${Math.round((answered / total) * 100)}%`;
  const question = available[0];
  if (!question) {
    $('languageCategory').textContent = answered === total ? 'Complete' : 'End of this pass';
    $('languagePrompt').textContent = answered === total
      ? 'You completed the Telugu-English grammar interview.'
      : 'You skipped the remaining questions. Return to this page or restart the app to continue.';
    $('languageAnswer').hidden = true;
    $('saveLanguageAnswer').hidden = true;
    $('skipLanguageAnswer').hidden = true;
    return;
  }
  $('languageCategory').textContent = question.category;
  $('languagePrompt').textContent = question.prompt;
  $('languageAnswer').hidden = false;
  $('languageAnswer').value = '';
  $('saveLanguageAnswer').hidden = false;
  $('skipLanguageAnswer').hidden = false;
  $('languageNote').textContent = 'Write your real grammar and spelling. Do not include protected personal information.';
}

async function refreshLanguageInterview() {
  const payload = await api('/api/language-questions');
  state.languageQuestions = payload.questions || [];
  renderLanguageQuestion();
}

async function saveLanguageAnswer() {
  const question = state.languageQuestions.find((item) => !item.answered && !state.skippedLanguageQuestions.has(item.id));
  const response = $('languageAnswer').value.trim();
  if (!question || !response) return $('languageAnswer').focus();
  $('saveLanguageAnswer').disabled = true;
  $('languageNote').textContent = 'Learning your grammar locally…';
  try {
    await api('/api/language-sample', { method: 'POST', body: JSON.stringify({ questionId: question.id, response }) });
    question.answered = true;
    renderLanguageQuestion();
    await refreshStatus();
  } catch (error) {
    $('languageNote').textContent = `Could not save: ${error.message}`;
  } finally {
    $('saveLanguageAnswer').disabled = false;
  }
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
$('openBackupKit').onclick = () => window.brain.openPath('/Users/vashishtdevasani/PersonalAIData/Apps/Vasisht2ndBrain/migration');
$('openQuickChat').onclick = () => window.brain.openQuickWindow();
$('runIndexer').onclick = async () => {
  const button = $('runIndexer');
  const status = $('indexerStatus');
  button.disabled = true;
  button.textContent = 'Indexing locally…';
  status.textContent = 'Checking approved folders. Large first-time imports can take several minutes.';
  try {
    const result = await window.brain.runIndexer();
    const details = result.details || {};
    status.textContent = result.started
      ? `Complete · ${details.changed_files || 0} changed · ${details.unchanged_files || 0} unchanged · ${details.errors || 0} errors · ${details.new_chunks || 0} passages added.`
      : result.message;
    await Promise.all([refreshStatus(), refreshKnowledgeGraph()]);
  } catch (error) {
    status.textContent = `Indexing failed: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Run indexer only';
  }
};

if ($('trainAdapter')) {
  $('trainAdapter').onclick = async () => {
    const button = $('trainAdapter');
    const status = $('indexerStatus');
    button.disabled = true;
    button.textContent = 'Training adapter…';
    status.textContent = 'Starting style adapter training in background. This can take 10–30 min.';
    try {
      const result = await api('/api/training/start', { method: 'POST', body: '{}' });
      status.textContent = result.message || 'Training started.';
      setTimeout(refreshStatus, 3000);
    } catch (error) {
      status.textContent = `Training failed: ${error.message}`;
    } finally {
      button.disabled = false;
      button.textContent = 'Train style adapter only';
    }
  };
}

if ($('fullRetrain')) {
  $('fullRetrain').onclick = async () => {
    const button = $('fullRetrain');
    const status = $('indexerStatus');
    button.disabled = true;
    $('runIndexer').disabled = true;
    if ($('trainAdapter')) $('trainAdapter').disabled = true;
    button.textContent = 'Running full retrain…';
    status.textContent = 'Running full reindex then training. This can take 30–60+ min.';
    try {
      await window.brain.runIndexer();
      const result = await api('/api/training/start', { method: 'POST', body: '{}' });
      status.textContent = (result.message || 'Training started.') + ' Index complete.';
      await Promise.all([refreshStatus(), refreshKnowledgeGraph()]);
    } catch (error) {
      status.textContent = `Full retrain failed: ${error.message}`;
    } finally {
      button.disabled = false;
      $('runIndexer').disabled = false;
      if ($('trainAdapter')) $('trainAdapter').disabled = false;
      button.textContent = 'Full retrain & reindex';
    }
  };
}

$('exportGraphState').onclick = async () => {
  const status = $('graphTransferStatus'); status.textContent = 'Preparing local export…';
  try {
    const result = await window.brain.exportGraphState();
    status.textContent = result.canceled ? '' : `Saved to ${result.path}`;
  } catch (error) { status.textContent = `Export failed: ${error.message}`; }
};
$('importGraphState').onclick = async () => {
  const status = $('graphTransferStatus'); status.textContent = 'Merging local graph state…';
  try {
    const result = await window.brain.importGraphState();
    if (result.canceled) return (status.textContent = '');
    status.textContent = `Merged ${result.aliases} names and ${result.summaries} summaries.`;
    await refreshKnowledgeGraph();
  } catch (error) { status.textContent = `Import failed: ${error.message}`; }
};
$('saveLanguageAnswer').onclick = saveLanguageAnswer;
$('skipLanguageAnswer').onclick = () => {
  const question = state.languageQuestions.find((item) => !item.answered && !state.skippedLanguageQuestions.has(item.id));
  if (question) state.skippedLanguageQuestions.add(question.id);
  renderLanguageQuestion();
};
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

function initSidebarResizer() {
  const resizer = document.getElementById('sidebarResizer');
  const shell = document.querySelector('.shell');
  if (!resizer || !shell) return;
  let isResizing = false;

  resizer.addEventListener('mousedown', () => {
    isResizing = true;
    resizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = Math.max(200, Math.min(450, e.clientX));
    shell.style.setProperty('--sidebar-width', `${newWidth}px`);
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

async function initialize() {
  bindSuggestions();
  bindKnowledgeGraphControls();
  initSidebarResizer();
  updateTools();
  await Promise.all([refreshStatus(), refreshConversations(), refreshLanguageInterview(), refreshKnowledgeGraph()]);
  setInterval(refreshStatus, 30000);
}

initialize().catch((error) => addMessage('assistant', `The local service could not initialize: ${error.message}`));
