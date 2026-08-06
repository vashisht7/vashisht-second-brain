const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, MenuItem, nativeImage, session, shell, systemPreferences, Tray } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

let backend = null, backendPort = null;
let mlxServer = null, mlxPort = null;
let quickWindow = null, mainWindow = null, loadingWindow = null;
let imessageRefresh = null, reindexProcess = null, imessageTimer = null;
let speechProcess = null, fnKeyMonitor = null, fnMonitorRestartTimer = null;
let wakeWordProcess = null, wakeWordRestartTimer = null;
let tray = null;
let vaultWatcher = [];
let watchDebounceTimer = null;
let lastAutoIndexTime = null;
let trayStatusText = '🟢 Ready';
let nativeShortcutDownAt = 0;
let nativeShortcutHeld = false;
let nativeHoldTimer = null;
let fallbackShortcut = null;
let lastNativeShortcutAt = 0;
const backendToken = crypto.randomBytes(32).toString('hex');



const MLX_SERVER = '/Users/vashishtdevasani/PersonalAIData/95_tools/venvs/mlx_lm/bin/mlx_lm.server';
const MLX_MODEL = 'mlx-community/gemma-4-e4b-it-4bit';
const MLX_ADAPTER = '/Users/vashishtdevasani/PersonalAIData/40_models/adapters/vasisht-2nd-brain/deploy-short';
const MANAGED_INBOX = '/Users/vashishtdevasani/PersonalAIData/00_inbox/continuous_documents';
const SECOND_BRAIN = '/Users/vashishtdevasani/PersonalAIData/95_tools/second_brain/second_brain.py';
const IMESSAGE_NORMALIZER = '/Users/vashishtdevasani/PersonalAIData/95_tools/second_brain/normalize_imessage.py';
const VOICE_PYTHON = '/Users/vashishtdevasani/PersonalAIData/95_tools/venvs/mlx_whisper/bin/python';
const VOICE_TRANSCRIBER = '/Users/vashishtdevasani/PersonalAIData/95_tools/second_brain/transcribe_voice_command.py';
const OCR_DOCUMENT = '/Users/vashishtdevasani/PersonalAIData/05_private_pii/tools/ocr_document.swift';
const MAX_VOICE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_FILE_TYPES = new Set([
  '.txt', '.md', '.markdown', '.pdf', '.docx', '.csv', '.json', '.jsonl', '.xml', '.html', '.htm',
  '.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.kt', '.dart', '.swift', '.c', '.cc', '.cpp', '.h',
  '.hpp', '.cs', '.go', '.rs', '.sql', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.css', '.ipynb'
]);
const SUPPORTED_IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.heic']);

function backendScript() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'backend', 'server.py');
  return path.join(__dirname, 'backend', 'server.py');
}

function voiceTranscriberScript() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'transcribe_voice_command.py');
  return VOICE_TRANSCRIBER;
}

function fnKeyMonitorExecutable() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'native', 'fn_key_monitor');
  return path.join(__dirname, 'native', 'fn_key_monitor');
}

function wakeWordScript() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'backend', 'wake_word.py');
  return path.join(__dirname, 'backend', 'wake_word.py');
}

function ocrDocumentScript() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'ocr_document.swift');
  return OCR_DOCUMENT;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function startMlxServer() {
  mlxPort = await freePort();
  mlxServer = spawn(MLX_SERVER, [
    '--model', MLX_MODEL,
    '--adapter-path', MLX_ADAPTER,
    '--host', '127.0.0.1',
    '--port', String(mlxPort),
    '--temp', '0.7',
    '--max-tokens', '700',
    '--chat-template-args', '{"enable_thinking":false}',
    '--log-level', 'WARNING'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  mlxServer.stderr.on('data', (buffer) => console.error(`[mlx-model] ${buffer}`));
  mlxServer.on('exit', (code) => {
    if (code && !app.isQuitting) console.error(`MLX model exited with ${code}`);
    mlxPort = null;
  });

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (mlxServer.exitCode !== null) throw new Error('Trained MLX model could not start');
    try {
      const response = await fetch(`http://127.0.0.1:${mlxPort}/v1/models`);
      if (response.ok) return;
    } catch (_) {
      // The local model is still loading.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Trained MLX model took too long to start');
}

function startBackend() {
  return new Promise((resolve, reject) => {
    backend = spawn('/usr/bin/python3', [backendScript()], {
      env: {
        ...process.env,
        VASHISHT_APP_TOKEN: backendToken,
        VASHISHT_MLX_URL: `http://127.0.0.1:${mlxPort}`,
        VASHISHT_MLX_MODEL: MLX_MODEL,
        VASHISHT_MODEL_NAME: 'Vashisht_Devasani_Brain',
        PYTHONUNBUFFERED: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timeout = setTimeout(() => reject(new Error('Local backend did not start')), 15000);
    backend.stdout.on('data', (buffer) => {
      const message = buffer.toString();
      const match = message.match(/READY\s+(\d+)/);
      if (match) {
        clearTimeout(timeout);
        backendPort = Number(match[1]);
        resolve();
      }
    });
    backend.stderr.on('data', (buffer) => console.error(`[local-backend] ${buffer}`));
    backend.on('exit', (code) => {
      backendPort = null;
      if (code && !app.isQuitting) console.error(`Local backend exited with ${code}`);
    });
  });
}

async function localApi(route, options = {}) {
  if (!backendPort) throw new Error('Local backend is unavailable');
  const response = await fetch(`http://127.0.0.1:${backendPort}${route}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Vashisht-Token': backendToken,
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function startReindex() {
  if (reindexProcess) return Promise.resolve({ started: false, state: 'already_running', message: 'The local indexer is already running.' });
  updateTrayStatus('⚡ Auto-indexing vault...', 'Scanning modified files');
  return new Promise((resolve, reject) => {
    reindexProcess = spawn(SECOND_BRAIN, ['scan'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    reindexProcess.stdout.on('data', (buffer) => { if (stdout.length < 1024 * 1024) stdout += buffer; });
    reindexProcess.stderr.on('data', (buffer) => { if (stderr.length < 256 * 1024) stderr += buffer; });
    reindexProcess.on('error', (error) => {
      reindexProcess = null;
      updateTrayStatus('⚠️ Indexing error', error.message);
      reject(error);
    });
    reindexProcess.on('exit', (code) => {
      reindexProcess = null;
      if (code !== 0) {
        updateTrayStatus('⚠️ Indexing error', stderr.trim() || 'Failed');
        return reject(new Error(stderr.trim() || 'The local indexer failed.'));
      }
      let details = {};
      try { details = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}'); } catch (_) { details = {}; }
      lastAutoIndexTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (details.state === 'already_running') {
        updateTrayStatus('🟢 Ready', `Last indexed at ${lastAutoIndexTime}`);
        return resolve({ started: false, state: 'already_running', details, message: 'The local indexer is already running in the background.' });
      }
      updateTrayStatus('🟢 Vault synchronized', `Indexed at ${lastAutoIndexTime}`);
      resolve({ started: true, state: details.state || 'complete', details, message: 'Local indexing completed.' });
    });
  });
}

function queueReindex() {
  startReindex().catch((error) => console.error(`[local-indexer] ${error.message}`));
}

function getTrayIconPath() {
  const iconName = 'trayTemplate.png';
  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, 'assets', iconName);
    if (fsSync.existsSync(packagedPath)) return packagedPath;
  }
  return path.join(__dirname, 'assets', iconName);
}

function setupTray() {
  if (tray) return;
  const iconPath = getTrayIconPath();
  let image;
  try {
    image = nativeImage.createFromPath(iconPath);
    image.setTemplateImage(true);
  } catch (e) {
    console.error(`[tray] Failed to load icon from ${iconPath}:`, e);
    return;
  }

  tray = new Tray(image);
  tray.setToolTip('Rishi Assistant v6.0.0\n🟢 System Ready');

  tray.on('click', () => {
    toggleQuickWindow();
  });

  updateTrayStatus('🟢 Ready', lastAutoIndexTime ? `Last indexed ${lastAutoIndexTime}` : 'Background auto-indexing active');
}

function updateTrayStatus(statusTitle, detailMsg = '') {
  if (!tray) return;
  trayStatusText = statusTitle;
  const tooltip = `Rishi Assistant v6.0.0\n${statusTitle}${detailMsg ? ` · ${detailMsg}` : ''}`;
  tray.setToolTip(tooltip);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Rishi Assistant v6.0.0', enabled: false },
    { label: `${statusTitle}${detailMsg ? ` (${detailMsg})` : ''}`, enabled: false },
    { type: 'separator' },
    {
      label: '💬 Open Quick Chat (⌘⇧Space)',
      click: () => toggleQuickWindow()
    },
    {
      label: '🧠 Open Main Application',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        else { mainWindow.show(); mainWindow.focus(); }
      }
    },
    { type: 'separator' },
    {
      label: '⚡ Re-index Vault Now',
      click: () => {
        updateTrayStatus('⚡ Re-indexing vault...', 'Manual trigger');
        startReindex().catch((err) => {
          updateTrayStatus('⚠️ Indexing error', err.message);
        });
      }
    },
    {
      label: '👁️ Auto-Watch Background Vault',
      type: 'checkbox',
      checked: vaultWatcher.length > 0,
      click: (item) => {
        if (item.checked) {
          startVaultWatcher();
          updateTrayStatus('🟢 Auto-watcher active', 'Monitoring /10_vault & /00_inbox');
        } else {
          stopVaultWatcher();
          updateTrayStatus('⏸️ Auto-watcher paused', 'Manual indexing only');
        }
      }
    },
    { type: 'separator' },
    {
      label: '✕ Quit Rishi',
      click: () => app.quit()
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function startVaultWatcher() {
  stopVaultWatcher();
  const watchDirs = [
    '/Users/vashishtdevasani/PersonalAIData/10_vault',
    '/Users/vashishtdevasani/PersonalAIData/00_inbox/continuous_documents',
    '/Users/vashishtdevasani/Desktop',
    '/Users/vashishtdevasani/Downloads'
  ];

  for (const dirPath of watchDirs) {
    if (!fsSync.existsSync(dirPath)) continue;
    try {
      const watcher = fsSync.watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const basename = path.basename(filename);

        if (
          basename.startsWith('.') ||
          basename.startsWith('~') ||
          basename.endsWith('.tmp') ||
          basename.endsWith('.crdownload') ||
          basename.endsWith('.swp') ||
          basename.endsWith('.lock') ||
          filename.includes('.git') ||
          filename.includes('node_modules')
        ) return;

        console.log(`[vault-watcher] Change detected (${eventType}): ${filename}`);
        updateTrayStatus('⚡ File modified', `Changed: ${basename}`);

        if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
        watchDebounceTimer = setTimeout(() => {
          console.log('[vault-watcher] Triggering automatic background re-index...');
          startReindex().catch((err) => {
            console.error(`[vault-watcher] Background re-index failed: ${err.message}`);
          });
        }, 3000);
      });
      vaultWatcher.push(watcher);
      console.log(`[vault-watcher] Watching ${dirPath} (recursive)`);
    } catch (err) {
      console.error(`[vault-watcher] Could not watch ${dirPath}: ${err.message}`);
    }
  }
}

function stopVaultWatcher() {
  if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
  watchDebounceTimer = null;
  for (const w of vaultWatcher) {
    try { w.close(); } catch (_) {}
  }
  vaultWatcher = [];
}


function refreshMessages() {
  if (imessageRefresh) return;
  imessageRefresh = spawn('/usr/bin/python3', [IMESSAGE_NORMALIZER], { stdio: ['ignore', 'pipe', 'pipe'] });
  imessageRefresh.stderr.on('data', (buffer) => console.error(`[messages-refresh] ${buffer}`));
  imessageRefresh.on('exit', () => { imessageRefresh = null; });
}

async function requestMicrophone() {
  if (process.platform !== 'darwin') return true;
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return true;
  if (status === 'denied' || status === 'restricted') return false;
  return systemPreferences.askForMediaAccess('microphone');
}

function runVoiceTranscriber(audioPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(VOICE_PYTHON, [voiceTranscriberScript(), audioPath], {
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || '/usr/bin:/bin'}` },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Local voice transcription took too long'));
    }, 180000);
    child.stdout.on('data', (buffer) => { if (stdout.length < 1024 * 1024) stdout += buffer; });
    child.stderr.on('data', (buffer) => { if (stderr.length < 1024 * 1024) stderr += buffer; });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(stderr.trim() || 'Local transcription failed'));
      try {
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        resolve(JSON.parse(lines[lines.length - 1] || '{}'));
      } catch (_) {
        reject(new Error('Local transcription returned an invalid result'));
      }
    });
  });
}

async function transcribeAudio(payload) {
  const allowedTypes = new Map([
    ['audio/webm', '.webm'], ['audio/webm;codecs=opus', '.webm'],
    ['audio/mp4', '.m4a'], ['audio/ogg', '.ogg'], ['audio/wav', '.wav']
  ]);
  const mimeType = String(payload?.mimeType || 'audio/webm').toLowerCase();
  const extension = allowedTypes.get(mimeType) || (mimeType.startsWith('audio/webm') ? '.webm' : null);
  if (!extension) throw new Error('Unsupported microphone recording format');
  const audio = Buffer.from(payload?.bytes || []);
  if (!audio.length) throw new Error('The microphone recording was empty');
  if (audio.length > MAX_VOICE_BYTES) throw new Error('Voice commands are limited to 25 MB');
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vashisht-voice-'));
  const audioPath = path.join(temporaryDirectory, `command${extension}`);
  try {
    await fs.writeFile(audioPath, audio, { mode: 0o600 });
    const result = await runVoiceTranscriber(audioPath);
    if (!result.text) throw new Error('I could not hear clear speech. Please try again and speak naturally after the microphone turns red.');
    return result;
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function addFiles(window) {
  const selection = await dialog.showOpenDialog(window, {
    title: 'Add files to Vashisht Devasani',
    buttonLabel: 'Add to Second Brain',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documents and text', extensions: [...SUPPORTED_FILE_TYPES].map((value) => value.slice(1)) },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (selection.canceled) return { canceled: true, added: [] };
  await fs.mkdir(MANAGED_INBOX, { recursive: true, mode: 0o700 });
  const added = [];
  const rejected = [];
  for (const source of selection.filePaths) {
    const extension = path.extname(source).toLowerCase();
    if (!SUPPORTED_FILE_TYPES.has(extension)) {
      rejected.push(path.basename(source));
      continue;
    }
    const safeName = path.basename(source).replace(/[^a-zA-Z0-9._ -]/g, '_');
    const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`;
    const destination = path.join(MANAGED_INBOX, uniqueName);
    await fs.copyFile(source, destination);
    added.push({ name: path.basename(source), path: destination });
  }
  if (added.length) queueReindex();
  return { canceled: false, added, rejected, inbox: MANAGED_INBOX };
}

function runImageOcr(imagePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/swift', [ocrDocumentScript(), imagePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Local image reading took too long')); }, 120000);
    child.stdout.on('data', (buffer) => { if (stdout.length < 2 * 1024 * 1024) stdout += buffer; });
    child.stderr.on('data', (buffer) => { if (stderr.length < 64 * 1024) stderr += buffer; });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(stderr.trim() || 'Local image reading failed'));
      resolve(stdout.trim());
    });
  });
}

function imageTextLooksProtected(text) {
  return /\b(passport|visa|i-?94|i-?797|h-?1b|social security|ssn|driver(?:'s)? license|taxpayer|form 1040|w-?2)\b/i.test(text)
    || /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/.test(text);
}

async function addImages(window) {
  const selection = await dialog.showOpenDialog(window, {
    title: 'Add images to Vashisht Devasani',
    buttonLabel: 'Read and add images',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: [...SUPPORTED_IMAGE_TYPES].map((value) => value.slice(1)) }]
  });
  if (selection.canceled) return { canceled: true, added: [], rejected: [] };
  const imageInbox = path.join(MANAGED_INBOX, 'images');
  await fs.mkdir(imageInbox, { recursive: true, mode: 0o700 });
  const added = [];
  const rejected = [];
  for (const source of selection.filePaths.slice(0, 4)) {
    const extension = path.extname(source).toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.has(extension)) { rejected.push({ name: path.basename(source), reason: 'unsupported format' }); continue; }
    const text = await runImageOcr(source);
    if (!text) { rejected.push({ name: path.basename(source), reason: 'no readable text detected' }); continue; }
    if (imageTextLooksProtected(text)) { rejected.push({ name: path.basename(source), reason: 'protected content must use the encrypted vault' }); continue; }
    const safeStem = path.basename(source, extension).replace(/[^a-zA-Z0-9._ -]/g, '_');
    const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeStem}`;
    const destination = path.join(imageInbox, `${unique}${extension}`);
    const sidecar = path.join(imageInbox, `${unique}.md`);
    await fs.copyFile(source, destination);
    await fs.writeFile(sidecar, `# Image text: ${path.basename(source)}\n\n${text}\n`, { mode: 0o600 });
    added.push({ name: path.basename(source), path: destination, text: text.slice(0, 12000) });
  }
  if (added.length) queueReindex();
  return { canceled: false, added, rejected };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: 'Vashisht Devasani',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#0b0d10',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  window.on('closed', () => { mainWindow = null; });
  window.webContents.on('did-fail-load', (_, code, description) => console.error(`[main-window] ${code}: ${description}`));
  window.loadFile(path.join(__dirname, 'renderer', 'index.html')).then(() => {
    if (!window.isDestroyed()) { window.show(); window.focus(); }
  }).catch((error) => console.error(`[main-window] ${error}`));
  return window;
}

function createQuickWindow() {
  if (quickWindow && !quickWindow.isDestroyed()) return quickWindow;
  quickWindow = new BrowserWindow({
    width: 440,
    height: 72,
    minWidth: 380,
    minHeight: 64,
    maxHeight: 500,
    show: false,
    frame: false,
    transparent: true,
    movable: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  quickWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  quickWindow.on('closed', () => { quickWindow = null; });
  quickWindow.webContents.on('did-fail-load', (_, code, description) => console.error(`[quick-window] ${code}: ${description}`));
  quickWindow.loadFile(path.join(__dirname, 'renderer', 'quick.html')).catch((error) => console.error(`[quick-window] ${error}`));
  return quickWindow;
}


function toggleQuickWindow() {
  const window = createQuickWindow();
  if (window.isVisible()) return window.hide();
  const display = require('electron').screen.getDisplayNearestPoint(require('electron').screen.getCursorScreenPoint());
  const bounds = window.getBounds();
  window.setPosition(
    Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2),
    Math.round(display.workArea.y + Math.max(45, display.workArea.height * 0.14))
  );
  window.show();
  window.focus();
  window.webContents.send('quick-focus');
}

function showQuickWindow() {
  const window = createQuickWindow();
  if (!window.isVisible()) toggleQuickWindow();
  else { window.show(); window.focus(); }
  return window;
}

function beginQuickVoice() {
  nativeShortcutHeld = true;
  const window = showQuickWindow();
  window.webContents.send('quick-voice-start');
}

function finishQuickVoice() {
  if (!nativeShortcutHeld) return;
  nativeShortcutHeld = false;
  quickWindow?.webContents.send('quick-voice-stop');
}

function nativeShortcutSignal(signal) {
  lastNativeShortcutAt = Date.now();
  if (signal === 'HOTKEY_DOWN' && !nativeShortcutDownAt) {
    if (fallbackShortcut?.singleTimer) clearTimeout(fallbackShortcut.singleTimer);
    if (fallbackShortcut?.releaseTimer) clearTimeout(fallbackShortcut.releaseTimer);
    fallbackShortcut = null;
    nativeShortcutDownAt = Date.now();
    nativeHoldTimer = setTimeout(beginQuickVoice, 360);
  } else if (signal === 'HOTKEY_UP' && nativeShortcutDownAt) {
    if (nativeHoldTimer) clearTimeout(nativeHoldTimer);
    nativeHoldTimer = null;
    const wasHeld = nativeShortcutHeld;
    nativeShortcutDownAt = 0;
    if (wasHeld) finishQuickVoice();
    else toggleQuickWindow();
  }
}

function fallbackShortcutSignal() {
  if (nativeShortcutDownAt || Date.now() - lastNativeShortcutAt < 250) return;
  const stamp = Date.now();
  if (!fallbackShortcut || stamp - fallbackShortcut.lastSignal > 700) {
    fallbackShortcut = { count: 1, lastSignal: stamp, singleTimer: null, releaseTimer: null };
    fallbackShortcut.singleTimer = setTimeout(() => {
      if (fallbackShortcut?.count === 1) toggleQuickWindow();
      fallbackShortcut = null;
    }, 620);
    return;
  }
  fallbackShortcut.count += 1;
  fallbackShortcut.lastSignal = stamp;
  if (fallbackShortcut.count === 2) {
    clearTimeout(fallbackShortcut.singleTimer);
    fallbackShortcut.singleTimer = null;
    beginQuickVoice();
  }
  if (fallbackShortcut.releaseTimer) clearTimeout(fallbackShortcut.releaseTimer);
  fallbackShortcut.releaseTimer = setTimeout(() => {
    finishQuickVoice();
    fallbackShortcut = null;
  }, 190);
}

function installQuickChatMenu() {
  const menu = Menu.getApplicationMenu();
  const applicationMenu = menu?.items?.[0]?.submenu;
  if (!applicationMenu || applicationMenu.items.some((item) => item.id === 'quick-chat')) return;
  applicationMenu.insert(1, new MenuItem({ id: 'quick-chat', label: 'Open Quick Chat', click: toggleQuickWindow }));
}

function startFnKeyMonitor() {
  if (fnKeyMonitor || app.isQuitting) return;
  fnKeyMonitor = spawn(fnKeyMonitorExecutable(), [], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  fnKeyMonitor.stdout.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';
    for (const line of lines) nativeShortcutSignal(line.trim());
  });
  fnKeyMonitor.stderr.on('data', (buffer) => console.error(`[fn-key] ${buffer}`));
  fnKeyMonitor.on('error', (error) => console.error(`[fn-key] ${error}`));
  fnKeyMonitor.on('exit', (code) => {
    fnKeyMonitor = null;
    if (!app.isQuitting) {
      if (code) console.error(`Fn key listener exited with ${code}`);
      fnMonitorRestartTimer = setTimeout(startFnKeyMonitor, 2000);
    }
  });
}

// ── Rishi wake-word detector ────────────────────────────────────────────────
function startWakeWord() {
  if (wakeWordProcess || app.isQuitting) return;
  wakeWordProcess = spawn(VOICE_PYTHON, [wakeWordScript()], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });

  let buffered = '';
  wakeWordProcess.stdout.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t === 'WAKE_WORD_DETECTED') {
        console.log('[rishi] Wake word "Rishi" detected — opening Quick HUD');
        const w = showQuickWindow();
        w.webContents.send('quick-voice-start');
      } else if (t.startsWith('WAKE_WORD_STATUS:')) {
        console.log(`[rishi-wake] ${t.slice(17)}`);
      } else if (t.startsWith('WAKE_WORD_ERROR:')) {
        console.error(`[rishi-wake] Error: ${t.slice(16)}`);
      } else if (t === 'WAKE_WORD_LISTENING') {
        console.log('[rishi-wake] Listening for "Rishi"…');
      }
    }
  });

  wakeWordProcess.stderr.on('data', (buf) => {
    const msg = buf.toString().trim();
    // Only log non-MLX spam lines
    if (msg && !msg.includes('UserWarning') && !msg.includes('MPS') && !msg.includes('deprecat')) {
      console.error(`[vasi-wake] ${msg}`);
    }
  });

  wakeWordProcess.on('error', (err) => console.error(`[vasi-wake] spawn error: ${err.message}`));
  wakeWordProcess.on('exit', (code) => {
    wakeWordProcess = null;
    if (!app.isQuitting) {
      if (code && code !== 0) console.error(`[vasi-wake] exited with ${code}`);
      // Auto-restart after 5s in case of transient mic error
      wakeWordRestartTimer = setTimeout(startWakeWord, 5000);
    }
  });
}

function pauseWakeWord() {
  try { wakeWordProcess?.stdin?.write('PAUSE\n'); } catch (_) {}
}

function resumeWakeWord() {
  try { wakeWordProcess?.stdin?.write('RESUME\n'); } catch (_) {}
}

function speakText(text) {
  if (speechProcess) speechProcess.kill('SIGTERM');
  const spoken = String(text || '').replace(/\[[IPMVW]\d+\]/g, '').slice(0, 12000).trim();
  if (!spoken) return false;
  speechProcess = spawn('/usr/bin/say', ['-r', '195', spoken], { stdio: 'ignore' });
  speechProcess.on('exit', () => { speechProcess = null; });
  return true;
}


function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 460,
    height: 310,
    resizable: false,
    title: 'Vashisht Devasani',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0d10',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  loadingWindow.loadFile(path.join(__dirname, 'renderer', 'loading.html'));
}

ipcMain.handle('local-api', (_, route, options) => localApi(route, options));
ipcMain.handle('run-indexer', () => startReindex());
ipcMain.handle('export-graph-state', async (event) => {
  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Export portable knowledge graph state',
    defaultPath: path.join(os.homedir(), 'Downloads', 'Vashisht-Knowledge-Graph.vashishtgraph'),
    filters: [{ name: 'Vashisht Knowledge Graph', extensions: ['vashishtgraph'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  return localApi('/api/graph-export', { method: 'POST', body: JSON.stringify({ path: result.filePath }) });
});
ipcMain.handle('import-graph-state', async (event) => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Import portable knowledge graph state',
    properties: ['openFile'],
    filters: [{ name: 'Vashisht Knowledge Graph', extensions: ['vashishtgraph'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return localApi('/api/graph-import', { method: 'POST', body: JSON.stringify({ path: result.filePaths[0] }) });
});
ipcMain.handle('add-files', (event) => addFiles(BrowserWindow.fromWebContents(event.sender)));
ipcMain.handle('add-images', (event) => addImages(BrowserWindow.fromWebContents(event.sender)));
ipcMain.handle('request-microphone', requestMicrophone);
ipcMain.handle('transcribe-audio', (_, payload) => transcribeAudio(payload));
ipcMain.handle('copy-text', (_, value) => { clipboard.writeText(String(value || '')); return true; });
ipcMain.handle('speak-text', (_, value) => speakText(value));
ipcMain.handle('stop-speaking', () => { if (speechProcess) speechProcess.kill('SIGTERM'); speechProcess = null; return true; });
ipcMain.handle('hide-quick-window', () => {
  quickWindow?.hide();
  if (wakeWordProcess && wakeWordProcess.stdin) {
    try {
      wakeWordProcess.stdin.write('PAUSE\n');
      setTimeout(() => {
        try { wakeWordProcess?.stdin?.write('RESUME\n'); } catch (_) {}
      }, 1500);
    } catch (_) {}
  }
  return true;
});
ipcMain.handle('open-quick-window', () => { toggleQuickWindow(); return true; });
ipcMain.handle('resize-quick-window', (_, { w, h }) => {
  if (!quickWindow || quickWindow.isDestroyed()) return false;
  const bounds = quickWindow.getBounds();
  quickWindow.setSize(Math.max(380, Math.min(600, w)), Math.max(58, Math.min(500, h)));
  return true;
});
ipcMain.handle('open-path', (_, target) => {
  const approvedRoots = [
    '/Users/vashishtdevasani/PersonalAIData',
    '/Users/vashishtdevasani/Desktop',
    '/Users/vashishtdevasani/Downloads'
  ];
  const resolved = path.resolve(String(target));
  if (!approvedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    throw new Error('Source is outside the approved personal-data area');
  }
  return shell.openPath(resolved);
});
ipcMain.handle('open-external', (_, target) => {
  const parsed = new URL(target);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Unsupported URL');
  return shell.openExternal(target);
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    permission === 'media' && webContents.getURL().startsWith('file://'));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) =>
    callback(permission === 'media' && webContents.getURL().startsWith('file://')));
  await startMlxServer();
  await startBackend();
  const backgroundLaunch = process.argv.includes('--background');
  if (!backgroundLaunch) createWindow();
  createQuickWindow();
  setupTray();
  startVaultWatcher();
  const shortcutRegistered = globalShortcut.register('Command+Shift+Space', fallbackShortcutSignal);
  if (!shortcutRegistered) console.error('Command-Shift-Space could not be registered');
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, args: ['--background'] });
  // The native listener supplies both key-down and key-up events. Registering
  // the same accelerator here would make one physical press toggle twice once
  // macOS Accessibility access is enabled.
  installQuickChatMenu();
  startFnKeyMonitor();
  startWakeWord();   // Voice-invoke Quick HUD by saying "Vasi"
  refreshMessages();
  imessageTimer = setInterval(refreshMessages, 5 * 60 * 1000);
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else { mainWindow.show(); mainWindow.focus(); }
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopVaultWatcher();
  if (tray) { tray.destroy(); tray = null; }
  if (backend) backend.kill('SIGTERM');
  if (mlxServer) mlxServer.kill('SIGTERM');
  if (imessageRefresh) imessageRefresh.kill('SIGTERM');
  if (reindexProcess) reindexProcess.kill('SIGTERM');
  if (wakeWordProcess) wakeWordProcess.kill('SIGTERM');
  if (imessageTimer) clearInterval(imessageTimer);
  if (speechProcess) speechProcess.kill('SIGTERM');
  if (fnKeyMonitor) fnKeyMonitor.kill('SIGTERM');
  if (fnMonitorRestartTimer) clearTimeout(fnMonitorRestartTimer);
  if (wakeWordRestartTimer) clearTimeout(wakeWordRestartTimer);
  if (nativeHoldTimer) clearTimeout(nativeHoldTimer);
  if (fallbackShortcut?.singleTimer) clearTimeout(fallbackShortcut.singleTimer);
  if (fallbackShortcut?.releaseTimer) clearTimeout(fallbackShortcut.releaseTimer);
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
