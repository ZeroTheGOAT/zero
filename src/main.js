// ═══════════════════════════════════════════════════════════════
//  ZERO — Floating AI Secretary for Windows
//  Electron Main Process
// ═══════════════════════════════════════════════════════════════

const {
  app, BrowserWindow, Tray, Menu, ipcMain,
  clipboard, desktopCapturer, nativeImage,
  screen, shell, globalShortcut, dialog
} = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');

// ── Config ───────────────────────────────────────────────────
const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const OLLAMA_URL = `http://${OLLAMA_HOST}:${OLLAMA_PORT}`;
const DEFAULT_MODEL = 'gemma3:4b';
const DOUBLE_TAP_WINDOW = 400;   // ms between two Ctrl releases
const HOTKEY_COOLDOWN = 600;     // ms after activation

// ── Data paths ───────────────────────────────────────────────
let DATA_DIR;
let DB_FILE;
let MEMORY_FILE;

// ── Global state ─────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isVisible = false;
let currentRequest = null;
let keyListener = null;

// Double-tap Ctrl state
let lastCtrlUp = 0;
let ctrlClean = true;           // true if no other key pressed between Ctrl down/up
let cooldownActive = false;

// ═══════════════════════════════════════════════════════════════
//  1. TRAY ICON GENERATION (pure Node.js — no external deps)
// ═══════════════════════════════════════════════════════════════
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ ((c & 1) ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function generateIcon(size) {
  const raw = [];
  const c = size / 2;
  const r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    raw.push(0); // PNG row filter: None
    for (let x = 0; x < size; x++) {
      const dx = x - c + 0.5, dy = y - c + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const t = (x + y) / (size * 2);
      const cr = Math.round(124 + t * (99 - 124));
      const cg = Math.round(58 + t * (102 - 58));
      const cb = Math.round(237 + t * (241 - 237));
      if (dist <= r - 0.5) {
        raw.push(cr, cg, cb, 255);
      } else if (dist <= r + 0.5) {
        const a = Math.max(0, Math.min(255, Math.round((r + 0.5 - dist) * 255)));
        raw.push(cr, cg, cb, a);
      } else {
        raw.push(0, 0, 0, 0);
      }
    }
  }
  const deflated = zlib.deflateSync(Buffer.from(raw));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflated),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ═══════════════════════════════════════════════════════════════
//  2. WINDOW MANAGEMENT
// ═══════════════════════════════════════════════════════════════
function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  mainWindow = new BrowserWindow({
    width: 420,
    height: 400,
    x: Math.floor(width / 2 - 210),
    y: Math.floor(height / 2 - 200),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,  // save CPU/RAM when hidden
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    hideOverlay();
  });

  // Fix Windows DWM gray strip on blur: force a 1px bounds jiggle to repaint
  mainWindow.on('blur', () => {
    if (mainWindow && mainWindow.isVisible()) {
      const b = mainWindow.getBounds();
      mainWindow.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height + 1 });
      mainWindow.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    }
  });

  if (process.env.ZERO_DEV === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Force all external links to open in the system default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      return callback(true);
    }
    callback(true); // Allow other normal browser permissions like notifications
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow.webContents.getURL() && url.startsWith('http')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

function showOverlay(contextText = '') {
  if (!mainWindow) return;
  if (contextText) {
    mainWindow.webContents.send('context:captured', contextText);
  }
  mainWindow.show();
  mainWindow.focus();
  isVisible = true;
  mainWindow.webContents.send('window:shown');
}

function hideOverlay() {
  if (!mainWindow) return;
  mainWindow.hide();
  isVisible = false;
  mainWindow.webContents.send('window:hidden');
  // Throttle renderer when hidden to save RAM
  if (mainWindow.webContents) {
    mainWindow.webContents.setBackgroundThrottling(true);
  }
}

function toggleOverlay() {
  if (isVisible) {
    hideOverlay();
  } else {
    // Try to capture selected text before showing
    captureContextAndShow();
  }
}

// ═══════════════════════════════════════════════════════════════
//  3. SYSTEM TRAY
// ═══════════════════════════════════════════════════════════════
function createTray() {
  const iconBuffer = generateIcon(32);
  const iconPath = path.join(DATA_DIR, 'tray-icon.png');
  fs.writeFileSync(iconPath, iconBuffer);

  tray = new Tray(iconPath);
  tray.setToolTip('Zero — AI Secretary');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Zero', click: () => showOverlay() },
    { label: 'Hide Zero', click: () => hideOverlay() },
    { type: 'separator' },
    { label: 'Quit', click: () => { mainWindow.destroy(); app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => toggleOverlay());
}

// ═══════════════════════════════════════════════════════════════
//  4. GLOBAL HOTKEY — Double-tap Ctrl via Win32 keyboard hook
// ═══════════════════════════════════════════════════════════════
function setupGlobalHotkey() {
  // PowerShell script that installs a low-level keyboard hook via Win32 API
  // and writes "CTRL_DOWN" / "CTRL_UP" / "OTHER_DOWN" to stdout
  const psScript = `
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class KbHook {
  private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr hMod, uint tid);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool GetMessage(out IntPtr msg, IntPtr hWnd, uint min, uint max);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  static IntPtr hook = IntPtr.Zero;
  static HookProc del;
  static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0) {
      int vk = Marshal.ReadInt32(lParam);
      int msg = wParam.ToInt32();
      bool isCtrl = (vk == 162 || vk == 163); // VK_LCONTROL or VK_RCONTROL
      if (isCtrl && (msg == 0x100 || msg == 0x104)) Console.WriteLine("CTRL_DOWN");
      else if (isCtrl && (msg == 0x101 || msg == 0x105)) Console.WriteLine("CTRL_UP");
      else if (!isCtrl && (msg == 0x100 || msg == 0x104)) Console.WriteLine("OTHER_DOWN");
    }
    return CallNextHookEx(hook, nCode, wParam, lParam);
  }
  public static void Run() {
    del = Callback;
    using (var p = Process.GetCurrentProcess())
    using (var m = p.MainModule)
      hook = SetWindowsHookEx(13, del, GetModuleHandle(m.ModuleName), 0);
    IntPtr msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0)) {}
  }
}
"@ -ReferencedAssemblies System.Runtime.InteropServices
[KbHook]::Run()
`;

  try {
    const hookProc = spawn('powershell.exe', [
      '-NoProfile', '-NoLogo', '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass', '-Command', psScript
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    keyListener = hookProc;  // store for cleanup

    let lineBuffer = '';
    hookProc.stdout.on('data', (data) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (cooldownActive) continue;

        if (line === 'OTHER_DOWN') {
          ctrlClean = false;
        } else if (line === 'CTRL_DOWN') {
          ctrlClean = true;
        } else if (line === 'CTRL_UP' && ctrlClean) {
          const now = Date.now();
          if (now - lastCtrlUp < DOUBLE_TAP_WINDOW) {
            lastCtrlUp = 0;
            cooldownActive = true;
            setTimeout(() => { cooldownActive = false; }, HOTKEY_COOLDOWN);
            toggleOverlay();
          } else {
            lastCtrlUp = now;
          }
        }
      }
    });

    hookProc.on('exit', (code) => {
      console.warn('[Zero] Keyboard hook process exited with code', code);
    });

    console.log('[Zero] Global hotkey (double-tap Ctrl) active via Win32 hook');
  } catch (err) {
    console.warn('[Zero] Win32 hook failed, using Alt+Space only:', err.message);
  }

  // Always register Alt+Space as a reliable fallback
  try { globalShortcut.register('Alt+Space', toggleOverlay); } catch {}
}

// ═══════════════════════════════════════════════════════════════
//  5. CONTEXT CAPTURE — Selected Text
// ═══════════════════════════════════════════════════════════════
function captureContextAndShow() {
  if (isVisible) { hideOverlay(); return; }

  const originalText = clipboard.readText();
  const originalImage = clipboard.readImage();

  // Simulate Ctrl+C in the currently focused (non-Zero) window
  exec(
    'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^c\')"',
    { timeout: 2000 },
    () => {
      setTimeout(() => {
        const newText = clipboard.readText();
        const selectedText = (newText && newText !== originalText) ? newText : '';

        // Restore original clipboard
        if (originalText) clipboard.writeText(originalText);
        else if (!originalImage.isEmpty()) clipboard.writeImage(originalImage);

        showOverlay(selectedText);
      }, 150);
    }
  );
}

// ═══════════════════════════════════════════════════════════════
//  6. SCREEN CAPTURE
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('capture:screen', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });
    if (sources.length > 0) {
      return sources[0].thumbnail.toDataURL();
    }
    return null;
  } catch (err) {
    console.error('[Zero] Screen capture failed:', err);
    return null;
  }
});

// ═══════════════════════════════════════════════════════════════
//  7. OLLAMA — Agentic Chat with Tool Calling
// ═══════════════════════════════════════════════════════════════

// Tool definitions for Ollama tool-calling
const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the given path',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute file path to read' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write or create a file with the given content',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path to write to' },
          content: { type: 'string', description: 'Content to write to the file' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path to list' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_files',
      description: 'Search for files or folders by name on the filesystem',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File or folder name to search for' },
          search_path: { type: 'string', description: 'Root path to search from (default: C:\\)' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a PowerShell or command-line command and return its output',
      parameters: {
        type: 'object',
        properties: { 
          command: { type: 'string', description: 'The command to execute' },
          run_as_admin: { type: 'boolean', description: 'Set to true if this command requires Administrator privileges' },
          background: { type: 'boolean', description: 'Set to true for long-running processes like web servers or daemon tasks that should not block the agent' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web and return results',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_url',
      description: 'Read and extract text content from a URL/webpage',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL to read' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_application',
      description: 'Open an application, file, or URL on the user\'s computer',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string', description: 'Application name, file path, or URL to open' } },
        required: ['target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a single file. You MUST use this to delete files. Will ask the user for permission first.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute file path to delete' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_directory',
      description: 'Delete an entire folder and all its contents. Use with extreme caution. Will ask the user for permission first.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute directory path to delete' } },
        required: ['path']
      }
    }
  }
];

// Execute a tool call and return the result
const pendingPrompts = new Map();

ipcMain.handle('prompt:reply', (_, id, result) => {
  if (pendingPrompts.has(id)) {
    pendingPrompts.get(id)(result);
    pendingPrompts.delete(id);
  }
});

function promptUserInChat(event, title, message) {
  return new Promise((resolve) => {
    const id = Date.now().toString() + Math.random().toString();
    pendingPrompts.set(id, (choice) => resolve({ id, choice }));
    event.sender.send('chat:prompt', { id, title, message });
  });
}

const activeCommands = new Map();
const backgroundTasks = new Map();

function sendBgTasksUpdate() {
  const tasks = Array.from(backgroundTasks.entries()).map(([id, p]) => ({ id, cmd: p.cmd }));
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send('bg:update', tasks));
}

ipcMain.handle('bg:stop', (_, id) => {
  if (backgroundTasks.has(id)) {
    const p = backgroundTasks.get(id);
    try { exec(`taskkill /pid ${p.pid} /f /t`); } catch(e) {}
    backgroundTasks.delete(id);
    sendBgTasksUpdate();
  }
});

ipcMain.handle('command:stop', (_, id) => {
  if (activeCommands.has(id)) {
    const child = activeCommands.get(id);
    try {
      spawn("taskkill", ["/pid", child.pid, '/f', '/t']);
    } catch(e) {}
    activeCommands.delete(id);
  }
});

async function executeToolCall(toolName, args, event) {
  try {
    switch (toolName) {
      case 'read_file': {
        const filePath = path.resolve(args.path);
        const stat = fs.statSync(filePath);
        if (stat.size > 1024 * 1024) return `Error: File too large (${(stat.size/1024/1024).toFixed(1)}MB). Max 1MB.`;
        return fs.readFileSync(filePath, 'utf-8');
      }
      case 'write_file': {
        try {
          const filePath = path.resolve(args.path);
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, args.content, 'utf-8');
          event.sender.send('file:created', filePath);
          return `File written successfully: ${filePath}`;
        } catch (err) {
          return `Failed to write file. Error: ${err.message}. Often caused by missing permissions (EPERM/EACCES).`;
        }
      }
      case 'list_directory': {
        const dirPath = path.resolve(args.path || '.');
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return entries.slice(0, 100).map(e => {
          if (e.isDirectory()) return `📁 ${e.name}/`;
          const size = fs.statSync(path.join(dirPath, e.name)).size;
          return `📄 ${e.name} (${size > 1024 ? (size/1024).toFixed(0)+'KB' : size+'B'})`;
        }).join('\n');
      }
      case 'find_files': {
        const searchPath = args.search_path || 'C:\\';
        const cmd = `Get-ChildItem -Path "${searchPath}" -Filter "${args.name}" -Recurse -Depth 5 -ErrorAction SilentlyContinue | Select-Object -First 15 -ExpandProperty FullName`;
        return new Promise((resolve) => {
          exec(cmd, { shell: 'powershell.exe', timeout: 15000 }, (err, stdout) => {
            resolve(stdout?.trim() || `No files named "${args.name}" found under ${searchPath}`);
          });
        });
      }
      case 'run_command': {
        // Prevent extremely destructive commands dynamically
        const lowerCmd = args.command.toLowerCase();
        if (lowerCmd.includes('remove-item -recurse c:\\') || lowerCmd.includes('del /s /q c:\\') || lowerCmd.includes('format c:')) {
          return `Critical Safety Error: Command blocked. You are not allowed to reset the PC or wipe major drives.`;
        }

        const isAdmin = !!args.run_as_admin;
        const warningTitle = isAdmin ? 'Admin Permission Request' : 'Permission Request';
        const { id, choice } = await promptUserInChat(event, warningTitle, `Zero wants to run the following terminal command${isAdmin ? ' as ADMINISTRATOR' : ''}:\n\n${args.command}\n\nDo you allow this?`);

        if (!choice) return 'Action denied by user.';

        if (isAdmin) {
          const os = require('os');
          const tempFile = path.join(os.tmpdir(), `zero_elevated_${Date.now()}.log`);
          const escapedCmd = args.command.replace(/'/g, "''");
          const psCommand = `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command \`"& { ${escapedCmd} } *> '${tempFile}'\`""`;
          
          return new Promise((resolve) => {
            exec(psCommand, { shell: 'powershell.exe', timeout: 60000 }, (err) => {
              event.sender.send('command:done', id);
              if (fs.existsSync(tempFile)) {
                const out = fs.readFileSync(tempFile, 'utf8');
                fs.unlinkSync(tempFile);
                resolve(out || '(Command succeeded but returned no output)');
              } else {
                resolve(err ? `Error: ${err.message}` : '(Command executed, no output captured)');
              }
            });
          });
        }

        const isBackground = !!args.background;

        return new Promise((resolve) => {
          if (isBackground) {
            const childProc = spawn('powershell.exe', ['-NoProfile', '-Command', args.command], {
              detached: false,
              stdio: 'ignore'
            });
            childProc.unref();
            
            const bgId = 'bg-' + Date.now();
            childProc.cmd = args.command.substring(0, 50);
            backgroundTasks.set(bgId, childProc);
            sendBgTasksUpdate();
            
            childProc.on('exit', () => {
              backgroundTasks.delete(bgId);
              sendBgTasksUpdate();
            });

            event.sender.send('command:done', id);
            resolve(`Process launched in background successfully (PID: ${childProc.pid}). It will keep running independently.`);
            return;
          }

          const childProc = exec(args.command, { shell: 'powershell.exe', timeout: 30000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
            activeCommands.delete(id);
            event.sender.send('command:done', id);
            let result = stdout || '';
            if (stderr) result += (result ? '\n' : '') + stderr;
            if (err && !result) result = `Error: ${err.message}`;
            if (err && err.killed) result += '\n[Process timed out after 30 seconds or was terminated]';
            resolve(result || '(no output)');
          });
          activeCommands.set(id, childProc);
        });
      }
      case 'web_search': {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
        return new Promise((resolve) => {
          const req = https.get(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
              const results = [];
              const re = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
              let m;
              while ((m = re.exec(body)) && results.length < 5) {
                const title = m[2].replace(/<[^>]+>/g, '');
                let url = m[1];
                if (url.includes('uddg=')) url = decodeURIComponent(url.split('uddg=')[1]?.split('&')[0] || url);
                results.push(`${title}\n${url}`);
              }
              resolve(results.join('\n\n') || 'No results found');
            });
          });
          req.on('error', () => resolve('Search failed'));
        });
      }
      case 'read_url': {
        return new Promise((resolve) => {
          const urlModule = args.url.startsWith('https') ? https : http;
          const req = urlModule.get(args.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, (res) => {
            let body = '';
            res.on('data', c => { body += c; if (body.length > 50000) req.destroy(); });
            res.on('end', () => {
              // Strip HTML tags, decode entities, clean up
              const text = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '')
                .replace(/\s+/g, ' ').trim();
              resolve(text.substring(0, 10000) || 'No content');
            });
          });
          req.on('error', () => resolve('Failed to read URL'));
          req.on('timeout', () => { req.destroy(); resolve('URL read timed out'); });
        });
      }
      case 'open_application': {
        shell.openPath(args.target).catch(() => {
          shell.openExternal(args.target).catch(() => {});
        });
        return `Opened: ${args.target}`;
      }
      case 'delete_file': {
        try {
          const filePath = path.resolve(args.path);
          if (!fs.existsSync(filePath)) return `Error: File not found: ${filePath}`;
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) return `Error: Target is a directory. Use delete_directory to delete folders.`;

          const { id, choice } = await promptUserInChat(event, 'Confirm Deletion', `Zero wants to delete the following file:\n\n${filePath}\n\nDo you want to allow this?`);

          if (!choice) return 'Action denied by user.';
          
          event.sender.send('command:done', id);
          fs.unlinkSync(filePath);
          return `Successfully deleted file: ${filePath}`;
        } catch (err) {
          return `Failed to delete file. Error: ${err.message}`;
        }
      }
      case 'delete_directory': {
        try {
          const dirPath = path.resolve(args.path);
          if (!fs.existsSync(dirPath)) return `Error: Directory not found: ${dirPath}`;
          
          if (dirPath.toLowerCase() === 'c:\\' || dirPath.toLowerCase() === 'c:\\windows' || dirPath.toLowerCase() === 'c:\\users') {
            return `Safety Protocol: Deleting critical system/user directories is strictly prohibited.`;
          }

          const { id, choice } = await promptUserInChat(event, 'Confirm DANGEROUS Deletion', `WARNING: Zero wants to permanently delete this ENTIRE FOLDER and ALL its contents:\n\n${dirPath}\n\nAre you absolutely sure you want to allow this?`);

          if (!choice) return 'Action denied by user.';

          event.sender.send('command:done', id);
          fs.rmSync(dirPath, { recursive: true, force: true });
          return `Successfully deleted entire directory: ${dirPath}`;
        } catch (err) {
          return `Failed to delete directory. Error: ${err.message}`;
        }
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

// Streaming chat with agentic tool loop
ipcMain.handle('chat:send', async (event, messages, model) => {
  const MAX_TOOL_ROUNDS = 10;

  async function streamRound(msgs, useTools) {
    const body = {
      model: model || DEFAULT_MODEL,
      messages: msgs,
      stream: true,
    };
    if (useTools) body.tools = AGENT_TOOLS;

    const postData = JSON.stringify(body);

    return new Promise((resolve) => {
      let fullContent = '';
      let toolCalls = [];

      const req = http.request({
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.message?.content) {
                fullContent += data.message.content;
                event.sender.send('chat:chunk', data.message.content);
              }
              if (data.message?.tool_calls) {
                toolCalls = toolCalls.concat(data.message.tool_calls);
              }
              if (data.done) {
                // Don't send chat:done yet if we have tool calls to process
              }
            } catch { /* skip malformed */ }
          }
        });
        res.on('end', () => {
          if (buffer.trim()) {
            try {
              const data = JSON.parse(buffer);
              if (data.message?.content) {
                fullContent += data.message.content;
                event.sender.send('chat:chunk', data.message.content);
              }
              if (data.message?.tool_calls) {
                toolCalls = toolCalls.concat(data.message.tool_calls);
              }
            } catch { /* skip */ }
          }
          resolve({ content: fullContent, toolCalls });
        });
        res.on('error', (err) => {
          event.sender.send('chat:error', err.message);
          resolve({ content: fullContent, toolCalls: [], error: err.message });
        });
      });

      req.on('error', (err) => {
        event.sender.send('chat:error', err.message);
        resolve({ content: '', toolCalls: [], error: err.message });
      });

      req.write(postData);
      req.end();
      currentRequest = req;
    });
  }

  // Agentic loop
  let currentMessages = [...messages];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await streamRound(currentMessages, true);

    if (result.error) break;

    if (result.toolCalls && result.toolCalls.length > 0) {
      // Add assistant's tool-calling message
      currentMessages.push({
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.toolCalls
      });

      // Execute each tool and add results
      for (const tc of result.toolCalls) {
        const fn = tc.function;
        const toolName = fn.name;
        let args = {};
        try {
          args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments;
        } catch { args = fn.arguments || {}; }

        // Notify renderer which tool is running
        event.sender.send('chat:chunk', `\n🔧 Running \`${toolName}\`...\n`);

        const toolResult = await executeToolCall(toolName, args, event);

        // Add tool result
        // Add tool result
        currentMessages.push({
          role: 'tool',
          name: toolName,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
        });

        // Show abbreviated result to user
        const preview = typeof toolResult === 'string' ? toolResult.substring(0, 500) : '';
        if (preview) {
          event.sender.send('chat:chunk', `\`\`\`\n${preview}${toolResult.length > 500 ? '\n...(truncated)' : ''}\n\`\`\`\n`);
        }
      }

      // Continue the loop — let LLM process tool results
      continue;
    }

    // No tool calls — LLM responded with text, we're done
    break;
  }

  event.sender.send('chat:done', {});
  return { success: true };
});

ipcMain.handle('chat:stop', () => {
  if (currentRequest) {
    currentRequest.destroy();
    currentRequest = null;
  }
});

ipcMain.handle('ollama:models', async () => {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await res.json();
    return (data.models || []).map(m => ({ name: m.name, size: m.size, modified: m.modified_at }));
  } catch {
    return [];
  }
});

ipcMain.handle('ollama:check', async () => {
  try {
    const res = await fetch(OLLAMA_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
});

// ═══════════════════════════════════════════════════════════════
//  8. FILE SYSTEM ACCESS
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('fs:read', async (_, filePath) => {
  try {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (stat.size > 5 * 1024 * 1024) return { error: 'File too large (>5MB)' };
    const content = fs.readFileSync(resolved, 'utf-8');
    return { content, path: resolved, size: stat.size };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:list', async (_, dirPath) => {
  try {
    const resolved = path.resolve(dirPath || '.');
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    return {
      path: resolved,
      entries: entries.slice(0, 200).map(e => ({
        name: e.name,
        isDir: e.isDirectory(),
        size: e.isFile() ? fs.statSync(path.join(resolved, e.name)).size : null,
      }))
    };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('file:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'All Supported', extensions: ['png','jpg','jpeg','gif','webp','bmp','txt','md','js','ts','py','json','csv','html','css','xml','yaml','yml','toml','log','sh','bat','ps1','c','cpp','h','java','rs','go','rb','php','sql','env','cfg','ini','conf'] },
      { name: 'Images', extensions: ['png','jpg','jpeg','gif','webp','bmp'] },
      { name: 'Text Files', extensions: ['txt','md','js','ts','py','json','csv','html','css','xml','yaml','yml','toml','log','sh','bat','ps1'] },
      { name: 'All Files', extensions: ['*'] },
    ]
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);
  const stat = fs.statSync(filePath);

  if (stat.size > 10 * 1024 * 1024) return { error: 'File too large (>10MB)' };

  const imageExts = ['.png','.jpg','.jpeg','.gif','.webp','.bmp'];

  if (imageExts.includes(ext)) {
    const buf = fs.readFileSync(filePath);
    const base64 = buf.toString('base64');
    const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { type: 'image', name, path: filePath, size: stat.size, base64, dataUrl: `data:${mime};base64,${base64}` };
  } else {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { type: 'text', name, path: filePath, size: stat.size, content, ext: ext.replace('.','') };
  }
});

// ═══════════════════════════════════════════════════════════════
//  9. TERMINAL EXECUTION
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('terminal:run', async (event, command) => {
  return new Promise((resolve) => {
    const proc = exec(command, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      shell: 'powershell.exe'
    }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: err ? err.code : 0,
        error: err && !err.code ? err.message : null
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════
//  10. WEB SEARCH (DuckDuckGo)
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('web:search', async (_, query) => {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await new Promise((resolve, reject) => {
      https.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      }, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => resolve(body));
        res.on('error', reject);
      }).on('error', reject);
    });

    // Parse results from DuckDuckGo HTML
    const results = [];
    const regex = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) && results.length < 5) {
      results.push({
        url: match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0],
        title: match[2].replace(/<[^>]*>/g, '').trim(),
        snippet: match[3].replace(/<[^>]*>/g, '').trim()
      });
    }
    return { results, query };
  } catch (err) {
    return { results: [], error: err.message, query };
  }
});

// ═══════════════════════════════════════════════════════════════
//  11. CONVERSATION DATABASE (JSON file)
// ═══════════════════════════════════════════════════════════════
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    }
  } catch { /* corrupted, start fresh */ }
  return { conversations: [] };
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

ipcMain.handle('db:list', () => {
  const db = loadDB();
  return db.conversations.map(c => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: c.messages.length
  }));
});

ipcMain.handle('db:get', (_, id) => {
  const db = loadDB();
  return db.conversations.find(c => c.id === id) || null;
});

ipcMain.handle('db:save', (_, conv) => {
  const db = loadDB();
  const idx = db.conversations.findIndex(c => c.id === conv.id);
  if (idx >= 0) {
    db.conversations[idx] = conv;
  } else {
    db.conversations.unshift(conv);
  }
  saveDB(db);
  return true;
});

ipcMain.handle('db:delete', (_, id) => {
  const db = loadDB();
  db.conversations = db.conversations.filter(c => c.id !== id);
  saveDB(db);
  return true;
});

// ═══════════════════════════════════════════════════════════════
//  11b. MEMORY SYSTEM — persistent user context
// ═══════════════════════════════════════════════════════════════
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
    }
  } catch {}
  return { facts: [], summaries: [] };
}

function saveMemory(mem) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

ipcMain.handle('memory:get', () => loadMemory());

ipcMain.handle('memory:addFact', (_, fact) => {
  const mem = loadMemory();
  // Prevent duplicates
  if (!mem.facts.includes(fact)) {
    mem.facts.push(fact);
    if (mem.facts.length > 50) mem.facts = mem.facts.slice(-50);
    saveMemory(mem);
  }
  return true;
});

ipcMain.handle('memory:addSummary', (_, summary) => {
  const mem = loadMemory();
  mem.summaries.unshift({ text: summary, time: Date.now() });
  if (mem.summaries.length > 20) mem.summaries = mem.summaries.slice(0, 20);
  saveMemory(mem);
  return true;
});

ipcMain.handle('memory:clear', () => {
  saveMemory({ facts: [], summaries: [] });
  return true;
});

ipcMain.handle('memory:deleteFact', (_, index) => {
  const mem = loadMemory();
  if (index >= 0 && index < mem.facts.length) {
    mem.facts.splice(index, 1);
    saveMemory(mem);
  }
  return true;
});

ipcMain.handle('memory:updateFact', (_, index, newText) => {
  const mem = loadMemory();
  if (index >= 0 && index < mem.facts.length) {
    mem.facts[index] = newText;
    saveMemory(mem);
  }
  return true;
});

ipcMain.handle('memory:deleteSummary', (_, index) => {
  const mem = loadMemory();
  if (index >= 0 && index < mem.summaries.length) {
    mem.summaries.splice(index, 1);
    saveMemory(mem);
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════
//  11c. AUTO-START — launch Zero on Windows boot
// ═══════════════════════════════════════════════════════════════
function setupAutoStart() {
  const exePath = process.execPath;
  const appPath = path.resolve(__dirname);
  // Use registry to auto-start
  const regCmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v Zero /t REG_SZ /d "\"${exePath}\" \"${appPath}\"" /f`;
  exec(regCmd, { shell: 'cmd.exe' }, (err) => {
    if (err) console.warn('[Zero] Auto-start registration failed:', err.message);
    else console.log('[Zero] Registered for auto-start on boot');
  });
}

ipcMain.handle('autostart:enable', () => { setupAutoStart(); return true; });
ipcMain.handle('autostart:disable', () => {
  exec('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v Zero /f', { shell: 'cmd.exe' });
  return true;
});

// ═══════════════════════════════════════════════════════════════
//  12. WINDOW CONTROLS
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('window:hide', () => hideOverlay());
ipcMain.handle('window:show', () => showOverlay());
ipcMain.handle('window:minimize', () => { mainWindow?.minimize(); });
ipcMain.handle('window:toggle', () => toggleOverlay());

ipcMain.handle('app:quit', async () => {
  app.quit();
});

ipcMain.handle('shell:showItem', (_, filePath) => {
  shell.showItemInFolder(path.resolve(filePath));
});

// ═══════════════════════════════════════════════════════════════
//  13. APP LIFECYCLE
// ═══════════════════════════════════════════════════════════════
app.whenReady().then(() => {
  // Ensure data directory
  DATA_DIR = path.join(app.getPath('userData'), 'zero-data');
  DB_FILE = path.join(DATA_DIR, 'conversations.json');
  MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  createWindow();
  createTray();
  setupGlobalHotkey();

  // Show on first launch
  setTimeout(() => showOverlay(), 800);

  console.log('[Zero] Ready. Double-tap Ctrl or Alt+Space to summon.');
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => {
  if (keyListener) {
    try { keyListener.kill(); } catch {}
  }
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
