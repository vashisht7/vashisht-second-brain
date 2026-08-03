const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brain', {
  api: (route, options = {}) => ipcRenderer.invoke('local-api', route, options),
  requestMicrophone: () => ipcRenderer.invoke('request-microphone'),
  transcribeAudio: (bytes, mimeType) => ipcRenderer.invoke('transcribe-audio', { bytes, mimeType }),
  copyText: (value) => ipcRenderer.invoke('copy-text', value),
  speakText: (value) => ipcRenderer.invoke('speak-text', value),
  stopSpeaking: () => ipcRenderer.invoke('stop-speaking'),
  hideQuickWindow: () => ipcRenderer.invoke('hide-quick-window'),
  openQuickWindow: () => ipcRenderer.invoke('open-quick-window'),
  onQuickFocus: (callback) => ipcRenderer.on('quick-focus', callback),
  onQuickVoiceStart: (callback) => ipcRenderer.on('quick-voice-start', callback),
  onQuickVoiceStop: (callback) => ipcRenderer.on('quick-voice-stop', callback),
  addFiles: () => ipcRenderer.invoke('add-files'),
  addImages: () => ipcRenderer.invoke('add-images'),
  openPath: (target) => ipcRenderer.invoke('open-path', target),
  openExternal: (target) => ipcRenderer.invoke('open-external', target)
});
