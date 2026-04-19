// ═══════════════════════════════════════════════════════════════
//  ZERO — Preload Script (Secure IPC Bridge)
// ═══════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');
const { marked } = require('marked');

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true
});

const renderer = new marked.Renderer();
renderer.link = function({ href, title, text }) {
  return `<a target="_blank" href="${href}" title="${title || ''}">${text}</a>`;
};
marked.use({ renderer });

contextBridge.exposeInMainWorld('zero', {
  // ── Environment ───────────────────────────────────────────
  getHomeDir: () => require('os').homedir(),

  // ── Chat ──────────────────────────────────────────────────
  sendMessage: (messages, model) => ipcRenderer.invoke('chat:send', messages, model),
  stopChat: () => ipcRenderer.invoke('chat:stop'),
  onChatChunk: (cb) => {
    ipcRenderer.removeAllListeners('chat:chunk');
    ipcRenderer.on('chat:chunk', (_, chunk) => cb(chunk));
  },
  onChatDone: (cb) => {
    ipcRenderer.removeAllListeners('chat:done');
    ipcRenderer.on('chat:done', (_, data) => cb(data));
  },
  onChatError: (cb) => {
    ipcRenderer.removeAllListeners('chat:error');
    ipcRenderer.on('chat:error', (_, err) => cb(err));
  },
  onChatPrompt: (cb) => {
    ipcRenderer.removeAllListeners('chat:prompt');
    ipcRenderer.on('chat:prompt', (_, data) => cb(data));
  },
  replyPrompt: (id, result) => ipcRenderer.invoke('prompt:reply', id, result),
  stopCommand: (id) => ipcRenderer.invoke('command:stop', id),
  stopBg: (id) => ipcRenderer.invoke('bg:stop', id),
  onBgUpdate: (cb) => {
    ipcRenderer.removeAllListeners('bg:update');
    ipcRenderer.on('bg:update', (_, tasks) => cb(tasks));
  },
  onCommandDone: (cb) => {
    ipcRenderer.removeAllListeners('command:done');
    ipcRenderer.on('command:done', (_, id) => cb(id));
  },
  onFileCreated: (cb) => {
    ipcRenderer.removeAllListeners('file:created');
    ipcRenderer.on('file:created', (_, path) => cb(path));
  },

  // ── Models ────────────────────────────────────────────────
  getModels: () => ipcRenderer.invoke('ollama:models'),
  checkOllama: () => ipcRenderer.invoke('ollama:check'),

  // ── Screen Capture ────────────────────────────────────────
  captureScreen: () => ipcRenderer.invoke('capture:screen'),

  // ── Context ───────────────────────────────────────────────
  onContextCapture: (cb) => {
    ipcRenderer.removeAllListeners('context:captured');
    ipcRenderer.on('context:captured', (_, text) => cb(text));
  },

  // ── File System ───────────────────────────────────────────
  readFile: (path) => ipcRenderer.invoke('fs:read', path),
  listDir: (path) => ipcRenderer.invoke('fs:list', path),
  pickFile: () => ipcRenderer.invoke('file:pick'),

  // ── Terminal ──────────────────────────────────────────────
  runCommand: (cmd) => ipcRenderer.invoke('terminal:run', cmd),

  // ── Web Search ────────────────────────────────────────────
  search: (query) => ipcRenderer.invoke('web:search', query),

  // ── Database ──────────────────────────────────────────────
  getConversations: () => ipcRenderer.invoke('db:list'),
  getConversation: (id) => ipcRenderer.invoke('db:get', id),
  saveConversation: (conv) => ipcRenderer.invoke('db:save', conv),
  deleteConversation: (id) => ipcRenderer.invoke('db:delete', id),

  // ── Memory ────────────────────────────────────────────────
  getMemory: () => ipcRenderer.invoke('memory:get'),
  addMemoryFact: (fact) => ipcRenderer.invoke('memory:addFact', fact),
  addMemorySummary: (summary) => ipcRenderer.invoke('memory:addSummary', summary),
  clearMemory: () => ipcRenderer.invoke('memory:clear'),
  deleteMemoryFact: (index) => ipcRenderer.invoke('memory:deleteFact', index),
  updateMemoryFact: (index, text) => ipcRenderer.invoke('memory:updateFact', index, text),
  deleteMemorySummary: (index) => ipcRenderer.invoke('memory:deleteSummary', index),

  // ── Auto-start ────────────────────────────────────────────
  enableAutoStart: () => ipcRenderer.invoke('autostart:enable'),
  disableAutoStart: () => ipcRenderer.invoke('autostart:disable'),

  // ── Window ────────────────────────────────────────────────
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  showWindow: () => ipcRenderer.invoke('window:show'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  quitApp: () => ipcRenderer.invoke('app:quit'),

  // ── Visibility Events ─────────────────────────────────────
  onShow: (cb) => {
    ipcRenderer.removeAllListeners('window:shown');
    ipcRenderer.on('window:shown', () => cb());
  },
  onHide: (cb) => {
    ipcRenderer.removeAllListeners('window:hidden');
    ipcRenderer.on('window:hidden', () => cb());
  },

  // ── Markdown ──────────────────────────────────────────────
  renderMarkdown: (text) => {
    try { return marked.parse(text); }
    catch { return text; }
  }
});
