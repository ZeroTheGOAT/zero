// ═══════════════════════════════════════════════════════════════
//  ZERO — Renderer (Frontend Logic)
// ═══════════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────
const state = {
  messages: [],
  conversationId: null,
  conversationTitle: '',
  conversations: [],
  isStreaming: false,
  streamedContent: '',
  model: 'gemma3:4b',
  models: [],
  ollamaOk: false,
  quote: '',
  screenshot: null,
  attachment: null,        // { type, name, content, base64, dataUrl }
  sidebarOpen: false,
  cmdPaletteOpen: false,
  cmdSelectedIdx: 0,
};

// ── Slash Commands ───────────────────────────────────────────
const SLASH_COMMANDS = [
  { cmd: '/screen',    desc: 'Capture your screen',       type: 'action' },
  { cmd: '/search',    desc: 'Search the web',            type: 'action', arg: 'query' },
  { cmd: '/run',       desc: 'Run a terminal command',    type: 'action', arg: 'command' },
  { cmd: '/file',      desc: 'Read a file',               type: 'action', arg: 'path' },
  { cmd: '/ls',        desc: 'List directory contents',   type: 'action', arg: 'path' },
  { cmd: '/think',     desc: 'Deep step-by-step reasoning', type: 'system', system: 'Think through this problem step by step. Show your full reasoning process, then give a clear final answer.' },
  { cmd: '/translate', desc: 'Translate text',            type: 'system', system: 'You are a translator. Translate the following text. If it is in English, translate to the language the user specifies. If it is in another language, translate to English. Output only the translation.' },
  { cmd: '/tldr',      desc: 'Summarize concisely',       type: 'system', system: 'Summarize the following in 2-3 short sentences. Be extremely concise.' },
  { cmd: '/rewrite',   desc: 'Rewrite for clarity',       type: 'system', system: 'Rewrite the following to be clearer, more concise, and professional. Output only the rewritten version.' },
  { cmd: '/fix',       desc: 'Fix errors in code/text',   type: 'system', system: 'Find and fix all errors in the following. Explain briefly what was wrong, then provide the corrected version.' },
  { cmd: '/explain',   desc: 'Explain code or concepts',  type: 'system', system: 'Explain the following in clear, simple terms. Use examples where helpful.' },
  { cmd: '/refine',    desc: 'Improve and polish',        type: 'system', system: 'Improve this text while preserving meaning. Fix any grammar issues, enhance clarity, improve flow. Output only the refined version.' },
  { cmd: '/bullets',   desc: 'Convert to bullet points',  type: 'system', system: 'Convert the following into clear, concise bullet points. Output only the bullet points.' },
  { cmd: '/todos',     desc: 'Extract action items',      type: 'system', system: 'Extract every actionable task from the following and format as a numbered TODO list. Output only the list.' },
  { cmd: '/memory',    desc: 'Show what Zero remembers',   type: 'action' },
  { cmd: '/forget',    desc: 'Clear all memories',         type: 'action' },
  { cmd: '/autostart', desc: 'Enable launch on boot',      type: 'action' },
];

// ── DOM Refs ─────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const el = {
  chatArea: $('#chat-area'),
  messages: $('#messages'),
  welcome: $('#welcome'),
  input: $('#input'),
  btnSend: $('#btn-send'),
  btnStop: $('#btn-stop'),
  btnNew: $('#btn-new'),
  btnMemory: $('#btn-memory'),
  btnClose: $('#btn-close'),
  btnMinimize: $('#btn-minimize'),
  btnSidebar: $('#btn-sidebar'),
  btnSidebarClose: $('#btn-sidebar-close'),
  btnScreenshot: $('#btn-screenshot'),
  btnAttach: $('#btn-attach'),
  sidebar: $('#sidebar'),
  convList: $('#conversation-list'),
  modelSelect: $('#model-select'),
  statusDot: $('#status-dot'),
  quoteBlock: $('#quote-block'),
  quoteText: $('#quote-text'),
  quoteDismiss: $('#quote-dismiss'),
  screenshotPreview: $('#screenshot-preview'),
  screenshotImg: $('#screenshot-img'),
  screenshotDismiss: $('#screenshot-dismiss'),
  cmdPalette: $('#command-palette'),
  cmdList: $('#command-list'),
  memoryPanel: $('#memory-panel'),
  memoryPanelClose: $('#memory-panel-close'),
  memoryFactsList: $('#memory-facts-list'),
  memorySummariesList: $('#memory-summaries-list'),
  memoryAddFact: $('#memory-add-fact'),
  memoryClearAll: $('#memory-clear-all'),
  quitModal: $('#quit-modal'),
  btnQuitYes: $('#btn-quit-yes'),
  btnQuitNo: $('#btn-quit-no'),
  tabFiles: $('#tab-files'),
  filesBadge: $('#files-badge'),
  tabTerminal: $('#tab-terminal'),
  runningBadge: $('#running-badge'),
  actionPanel: $('#action-panel'),
  actionPanelContent: $('#action-panel-content'),
  runningPanel: $('#running-panel'),
  runningPanelClose: $('#running-panel-close'),
  runningList: $('#running-list'),
};

// ═══════════════════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════════════════
async function init() {
  setupEventListeners();
  setupIPCListeners();
  setupMemoryPanel();
  await checkOllama();
  await loadModels();
  await loadConversations();
  newConversation();
  autoResizeInput();

  // Focus input on show
  window.zero.onShow(() => {
    setTimeout(() => el.input.focus(), 100);
  });
}

async function checkOllama() {
  state.ollamaOk = await window.zero.checkOllama();
  el.statusDot.className = `status-dot ${state.ollamaOk ? 'connected' : 'disconnected'}`;
  el.statusDot.title = state.ollamaOk ? 'Ollama connected' : 'Ollama not running';

  if (!state.ollamaOk) {
    showToast('⚠ Ollama not detected — run "ollama serve" to start');
  }
}

async function loadModels() {
  state.models = await window.zero.getModels();
  el.modelSelect.innerHTML = '';

  if (state.models.length === 0) {
    el.modelSelect.innerHTML = '<option value="">No models found</option>';
    return;
  }

  state.models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = m.name;
    el.modelSelect.appendChild(opt);
  });

  // Select saved model or first available
  if (state.models.find(m => m.name === state.model)) {
    el.modelSelect.value = state.model;
  } else {
    state.model = state.models[0].name;
    el.modelSelect.value = state.model;
  }
}

// ═══════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════
function setupEventListeners() {
  // Send
  el.btnSend.onclick = () => sendMessage();
  el.btnStop.onclick = () => stopStreaming();

  // Input
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state.cmdPaletteOpen) {
        selectCommand(state.cmdSelectedIdx);
      } else {
        sendMessage();
      }
    }
    if (e.key === 'Escape') {
      if (state.cmdPaletteOpen) {
        closeCmdPalette();
      } else {
        window.zero.hideWindow();
      }
    }
    // Command palette navigation
    if (state.cmdPaletteOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.cmdSelectedIdx = Math.min(state.cmdSelectedIdx + 1, filteredCommands().length - 1);
        renderCmdPalette();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.cmdSelectedIdx = Math.max(state.cmdSelectedIdx - 1, 0);
        renderCmdPalette();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        selectCommand(state.cmdSelectedIdx);
      }
    }
  });

  el.input.addEventListener('input', () => {
    autoResizeInput();
    handleInputChange();
  });

  // Window controls
  el.btnClose.onclick = () => { el.quitModal.classList.remove('hidden'); };
  el.btnQuitYes.onclick = () => { window.zero.quitApp(); };
  el.btnQuitNo.onclick = () => { el.quitModal.classList.add('hidden'); };
  
  el.btnMinimize.onclick = () => window.zero.hideWindow();
  el.btnNew.onclick = () => newConversation();
  el.btnMemory.onclick = () => openMemoryPanel();

  // Action Tabs
  let activeTab = null;
  const createdFiles = []; // Track files created by AI

  function renderFilesList() {
    if (createdFiles.length === 0) {
      el.actionPanelContent.innerHTML = '<div class="action-panel-empty">No files created yet</div>';
    } else {
      el.actionPanelContent.innerHTML = '';
      createdFiles.forEach(f => {
        const item = document.createElement('div');
        item.className = 'action-panel-item';
        item.style.cursor = 'pointer';
        const name = f.split(/[/\\]/).pop();
        item.textContent = name;
        item.title = f;
        item.onclick = () => window.zero.showFileInFolder(f);
        el.actionPanelContent.appendChild(item);
      });
    }
  }

  function toggleTab(tabName, tabEl) {
    if (activeTab === tabName) {
      el.actionPanel.classList.add('hidden');
      el.runningPanel.classList.add('hidden');
      tabEl.classList.remove('active');
      activeTab = null;
      return;
    }
    // Deactivate all tabs
    [el.tabFiles, el.tabTerminal].forEach(t => t.classList.remove('active'));
    el.actionPanel.classList.add('hidden');
    el.runningPanel.classList.add('hidden');
    activeTab = tabName;
    tabEl.classList.add('active');

    if (tabName === 'files') {
      renderFilesList();
      el.actionPanel.classList.remove('hidden');
    } else if (tabName === 'terminal') {
      el.runningPanel.classList.remove('hidden');
    }
  }

  el.tabFiles.onclick = () => toggleTab('files', el.tabFiles);
  el.tabTerminal.onclick = () => toggleTab('terminal', el.tabTerminal);
  el.runningPanelClose.onclick = () => {
    el.runningPanel.classList.add('hidden');
    el.tabTerminal.classList.remove('active');
    activeTab = null;
  };

  // Track files created by AI from tool outputs
  window._trackCreatedFile = (path) => {
    if (!createdFiles.includes(path)) {
      createdFiles.push(path);
      el.filesBadge.textContent = createdFiles.length;
      el.filesBadge.classList.remove('hidden');
      if (activeTab === 'files') {
        renderFilesList();
      }
    }
  };

  // Sidebar
  el.btnSidebar.onclick = () => toggleSidebar();
  el.btnSidebarClose.onclick = () => toggleSidebar();

  // Model select
  el.modelSelect.onchange = () => { state.model = el.modelSelect.value; };

  // Quote
  el.quoteDismiss.onclick = () => clearQuote();

  // Screenshot
  el.btnScreenshot.onclick = () => captureScreen();
  el.screenshotDismiss.onclick = () => clearScreenshot();

  // Attach file
  el.btnAttach.onclick = () => attachFile();

  // Click outside sidebar
  el.chatArea.addEventListener('click', () => {
    if (state.sidebarOpen) toggleSidebar();
  });
}

function setupIPCListeners() {
  // Context capture from selected text
  window.zero.onContextCapture((text) => {
    if (text && text.trim()) {
      state.quote = text.trim();
      el.quoteText.textContent = state.quote;
      el.quoteBlock.classList.remove('hidden');
    }
  });

  // Chat streaming
  window.zero.onChatChunk((chunk) => {
    state.streamedContent += chunk;
    updateStreamingMessage(state.streamedContent);
  });

  window.zero.onChatDone(() => {
    finishStreaming();
  });

  window.zero.onChatError((err) => {
    if (state.isStreaming) {
      state.streamedContent += `\n\n⚠ Error: ${err}`;
      finishStreaming();
    } else {
      addMessage('system', `⚠ Connection error: ${err}`);
    }
  });

  // Background Tasks
  if (window.zero.onBgUpdate) {
    window.zero.onBgUpdate((tasks) => {
      if (tasks.length === 0) {
        el.runningBadge.classList.add('hidden');
        el.runningPanel.classList.add('hidden');
      } else {
        el.runningBadge.classList.remove('hidden');
        el.runningBadge.textContent = tasks.length;
        el.runningList.innerHTML = tasks.map(t => `
          <div class="bg-task">
            <span class="bg-cmd" title="${escapeHtml(t.cmd)}">${escapeHtml(t.cmd)}</span>
            <button class="bg-stop" onclick="window.zero.stopBg('${t.id}')">Stop</button>
          </div>
        `).join('');
      }
    });
  }

  // File tracking
  if (window.zero.onFileCreated) {
    window.zero.onFileCreated((filePath) => {
      if (window._trackCreatedFile) window._trackCreatedFile(filePath);
    });
  }

  // Tool Permission Prompt
  window.zero.onChatPrompt(({ id, title, message }) => {
    const box = document.createElement('div');
    box.className = 'prompt-box';
    box.innerHTML = `
      <div class="prompt-title">⚠ ${escapeHtml(title)}</div>
      <div class="prompt-msg">${escapeHtml(message)}</div>
      <div class="prompt-actions">
        <button class="prompt-btn allow">Allow</button>
        <button class="prompt-btn deny">Deny</button>
      </div>
    `;

    const btnAllow = box.querySelector('.allow');
    const btnDeny = box.querySelector('.deny');

    const handleChoice = async (choice) => {
      if (!choice) {
        btnAllow.disabled = true;
        btnDeny.disabled = true;
        box.style.opacity = '0.5';
        await window.zero.replyPrompt(id, false);
        return;
      }

      // If allowed, explicitly morph into running command tracker
      box.innerHTML = `
        <div class="prompt-title" style="cursor:pointer;" id="toggle-${id}">
          <span style="display:inline-block; transition:transform 0.2s;" id="icon-${id}">▼</span> 
          ⚙ Running Action...
        </div>
        <div id="cmd-details-${id}" class="prompt-msg" style="display:none; margin-top:8px;">${escapeHtml(message)}</div>
        <div class="prompt-actions" id="actions-${id}">
          <button class="prompt-btn deny" id="stop-${id}">🛑 Stop Execution</button>
        </div>
      `;

      document.getElementById(`toggle-${id}`).onclick = () => {
        const details = document.getElementById(`cmd-details-${id}`);
        const icon = document.getElementById(`icon-${id}`);
        if (details.style.display === 'none') {
           details.style.display = 'block';
           icon.style.transform = 'rotate(-180deg)';
        } else {
           details.style.display = 'none';
           icon.style.transform = 'rotate(0deg)';
        }
      };

      document.getElementById(`stop-${id}`).onclick = () => {
        window.zero.stopCommand(id);
        const btn = document.getElementById(`stop-${id}`);
        btn.textContent = 'Stopping...';
        btn.disabled = true;
      };

      await window.zero.replyPrompt(id, true);
    };

    btnAllow.onclick = () => handleChoice(true);
    btnDeny.onclick = () => handleChoice(false);

    el.messages.appendChild(box);
    scrollToBottom();
  });

  window.zero.onCommandDone((id) => {
    const actions = document.getElementById(`actions-${id}`);
    if (actions) actions.style.display = 'none';
    const title = document.getElementById(`toggle-${id}`);
    if (title) title.innerHTML = title.innerHTML.replace('⚙ Running Action...', 'Action Completed');
  });
}

// ═══════════════════════════════════════════════════════════════
//  MESSAGING
// ═══════════════════════════════════════════════════════════════
async function sendMessage() {
  const text = el.input.value.trim();
  if (!text && !state.screenshot) return;
  if (state.isStreaming) return;

  // Check for action commands
  const cmdMatch = text.match(/^(\/\w+)\s*(.*)/);
  if (cmdMatch) {
    const cmd = SLASH_COMMANDS.find(c => c.cmd === cmdMatch[1]);
    if (cmd && cmd.type === 'action') {
      await handleActionCommand(cmd, cmdMatch[2]);
      return;
    }
  }

  // Hide welcome
  el.welcome.classList.add('hidden');

  // Build user message content
  let userContent = '';
  if (state.quote) {
    userContent = `> ${state.quote}\n\n${text}`;
  } else {
    userContent = text;
  }

  // Include attached file content in message
  let attachmentContext = '';
  let attachedImage = null;
  if (state.attachment) {
    if (state.attachment.type === 'text') {
      attachmentContext = `\n\n--- Attached file: ${state.attachment.name} ---\n\`\`\`${state.attachment.ext || ''}\n${state.attachment.content}\n\`\`\``;
      userContent += attachmentContext;
    } else if (state.attachment.type === 'image') {
      attachedImage = state.attachment.base64;
    }
    clearAttachment();
  }

  const imageToAttach = (attachedImage || state.screenshot || '').replace(/^data:image\/\w+;base64,/, '') || null;

  // Auto-detect file/command requests and execute tools
  const toolResult = await autoDetectAndRunTools(text);
  if (toolResult) {
    userContent += toolResult;
  }

  // Add user message
  addMessage('user', userContent, imageToAttach ? [imageToAttach] : null);

  // Clear inputs
  el.input.value = '';
  autoResizeInput();
  clearQuote();
  closeCmdPalette();

  // Build messages array for Ollama
  let systemPrompt = null;

  // Check for system-type slash commands
  if (cmdMatch) {
    const cmd = SLASH_COMMANDS.find(c => c.cmd === cmdMatch[1] && c.type === 'system');
    if (cmd) {
      systemPrompt = cmd.system;
      userContent = cmdMatch[2] || userContent;
    }
  }

  const ollamaMessages = [];

  // Inject persistent memory context
  const memoryContext = await buildMemoryContext();
  const fullSystem = [memoryContext, systemPrompt].filter(Boolean).join('\n\n---\n\n');
  if (fullSystem) {
    ollamaMessages.push({ role: 'system', content: fullSystem });
  }

  // Include conversation context (last 20 messages)
  const contextMessages = state.messages.slice(-20);
  for (const msg of contextMessages) {
    if (msg.role === 'system') continue;
    const payload = { role: msg.role, content: msg.content };
    if (msg.images && msg.images.length > 0) {
      payload.images = msg.images;
    }
    ollamaMessages.push(payload);
  }

  // Start streaming
  startStreaming();

  // Handle screenshot or attached image
  if (imageToAttach) {
    ollamaMessages[ollamaMessages.length - 1].images = [imageToAttach];
    if (state.screenshot) clearScreenshot();
  }

  // Auto-extract "remember" requests from user message
  extractMemoryFacts(text);

  await window.zero.sendMessage(ollamaMessages, state.model);
}

async function handleActionCommand(cmd, arg) {
  switch (cmd.cmd) {
    case '/screen':
      await captureScreen();
      break;

    case '/search': {
      if (!arg) { showToast('Usage: /search <query>'); return; }
      addMessage('user', `/search ${arg}`);
      el.input.value = '';
      el.welcome.classList.add('hidden');
      addMessage('system', `🔍 Searching: "${arg}"...`);
      const result = await window.zero.search(arg);
      if (result.results.length > 0) {
        let searchContext = `Web search results for "${arg}":\n\n`;
        result.results.forEach((r, i) => {
          searchContext += `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${decodeURIComponent(r.url)}\n\n`;
        });
        // Remove the "searching" message
        removeLastSystemMessage();
        // Feed results to LLM
        const prompt = `Here are web search results for "${arg}":\n\n${searchContext}\nPlease summarize the key findings and answer the user's query.`;
        addMessage('system', `Found ${result.results.length} results. Asking AI to summarize...`);
        startStreaming();
        await window.zero.sendMessage([
          { role: 'system', content: 'You are a helpful assistant. Summarize the following web search results clearly and concisely.' },
          { role: 'user', content: prompt }
        ], state.model);
      } else {
        removeLastSystemMessage();
        addMessage('system', `No results found for "${arg}".`);
      }
      break;
    }

    case '/run': {
      if (!arg) { showToast('Usage: /run <command>'); return; }
      addMessage('user', `/run ${arg}`);
      el.input.value = '';
      el.welcome.classList.add('hidden');
      addMessage('system', `⏳ Running: \`${arg}\`...`);
      const res = await window.zero.runCommand(arg);
      removeLastSystemMessage();
      let output = '';
      if (res.stdout) output += res.stdout;
      if (res.stderr) output += (output ? '\n' : '') + res.stderr;
      if (res.error) output += (output ? '\n' : '') + `Error: ${res.error}`;
      addMessage('assistant', `**Command:** \`${arg}\`\n**Exit code:** ${res.exitCode || 0}\n\n\`\`\`\n${output || '(no output)'}\n\`\`\``);
      break;
    }

    case '/file': {
      if (!arg) { showToast('Usage: /file <path>'); return; }
      addMessage('user', `/file ${arg}`);
      el.input.value = '';
      el.welcome.classList.add('hidden');
      const fileResult = await window.zero.readFile(arg);
      if (fileResult.error) {
        addMessage('system', `⚠ ${fileResult.error}`);
      } else {
        const ext = arg.split('.').pop() || '';
        addMessage('assistant', `**File:** \`${fileResult.path}\` (${formatSize(fileResult.size)})\n\n\`\`\`${ext}\n${fileResult.content}\n\`\`\``);
      }
      break;
    }

    case '/memory': {
      el.input.value = '';
      openMemoryPanel();
      break;
    }

    case '/forget': {
      el.input.value = '';
      await window.zero.clearMemory();
      showToast('Memory cleared');
      break;
    }

    case '/autostart': {
      el.input.value = '';
      await window.zero.enableAutoStart();
      showToast('Zero will start on boot');
      break;
    }

    case '/ls': {
      const dirPath = arg || '.';
      addMessage('user', `/ls ${dirPath}`);
      el.input.value = '';
      el.welcome.classList.add('hidden');
      const dirResult = await window.zero.listDir(dirPath);
      if (dirResult.error) {
        addMessage('system', `⚠ ${dirResult.error}`);
      } else {
        let listing = `**Directory:** \`${dirResult.path}\`\n\n`;
        listing += '| Name | Type | Size |\n|------|------|------|\n';
        dirResult.entries.forEach(e => {
          listing += `| ${e.name} | ${e.isDir ? '📁' : '📄'} | ${e.isDir ? '-' : formatSize(e.size)} |\n`;
        });
        addMessage('assistant', listing);
      }
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  STREAMING
// ═══════════════════════════════════════════════════════════════
function startStreaming() {
  state.isStreaming = true;
  state.streamedContent = '';
  el.btnSend.classList.add('hidden');
  el.btnStop.classList.remove('hidden');

  // Create placeholder assistant message
  const msgEl = createMessageElement('assistant', '', true);
  el.messages.appendChild(msgEl);
  scrollToBottom();
}

function updateStreamingMessage(content) {
  const lastMsgNode = el.messages.querySelector('.message.assistant:last-child');
  const lastMsg = lastMsgNode?.querySelector('.msg-content');
  if (lastMsg && lastMsgNode) {
    lastMsg.innerHTML = window.zero.renderMarkdown(content);
    lastMsg.classList.add('streaming-cursor');
    lastMsgNode.dataset.rawContent = content; // Update raw markdown for copying
    addCopyButtons(lastMsg);
    scrollToBottom();
  }
}

function finishStreaming() {
  state.isStreaming = false;
  el.btnSend.classList.remove('hidden');
  el.btnStop.classList.add('hidden');

  // Remove streaming cursor
  const lastContent = el.messages.querySelector('.message.assistant:last-child .msg-content');
  if (lastContent) {
    lastContent.classList.remove('streaming-cursor');
  }

  // Save to state
  if (state.streamedContent) {
    state.messages.push({
      id: uid(),
      role: 'assistant',
      content: state.streamedContent,
      timestamp: Date.now()
    });
  }

  // Auto-save conversation
  saveCurrentConversation();

  // Auto-summarize conversation for memory after 6+ messages
  const userMsgs = state.messages.filter(m => m.role === 'user');
  if (userMsgs.length === 3) {
    autoSummarizeConversation();
  }

  state.streamedContent = '';
}

function stopStreaming() {
  window.zero.stopChat();
  finishStreaming();
}

// ═══════════════════════════════════════════════════════════════
//  MESSAGE RENDERING
// ═══════════════════════════════════════════════════════════════
function addMessage(role, content, images = null) {
  const msg = {
    id: uid(),
    role,
    content,
    timestamp: Date.now()
  };
  if (images) msg.images = images;
  state.messages.push(msg);

  const msgEl = createMessageElement(role, content, false, images);
  el.messages.appendChild(msgEl);
  scrollToBottom();

  // Auto-title conversation from first user message
  if (role === 'user' && !state.conversationTitle) {
    state.conversationTitle = content.substring(0, 60).replace(/\n/g, ' ');
  }
}

function createMessageElement(role, content, isStreaming = false, images = null) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  if (role === 'system') {
    div.innerHTML = `
      <div class="msg-body" style="width:100%">
        <div class="msg-content">${window.zero.renderMarkdown(content)}</div>
      </div>`;
    return div;
  }

  const avatarLabel = role === 'assistant' ? 'Z' : 'Y';
  const rendered = content ? window.zero.renderMarkdown(content) : '';
  
  let imagesHtml = '';
  if (images && images.length > 0) {
    imagesHtml = `<div class="msg-images" style="margin-top: 5px;">` + images.map(src => `<img src="data:image/jpeg;base64,${src}" style="max-width: 250px; border-radius: 8px; border: 1px solid var(--border);" />`).join('') + `</div>`;
  }

  div.innerHTML = `
    <div class="msg-avatar">${avatarLabel}</div>
    <div class="msg-body">
      <div class="msg-content${isStreaming ? ' streaming-cursor' : ''}">${rendered}${imagesHtml}</div>
      <div class="msg-meta">
        <span class="msg-time">${formatTime(Date.now())}</span>
        <button class="msg-action copy-msg" title="Copy">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>`;

  // Add copy buttons to code blocks
  const contentEl = div.querySelector('.msg-content');
  addCopyButtons(contentEl);

  // Copy message action
  const copyBtn = div.querySelector('.copy-msg');
  if (copyBtn) {
    div.dataset.rawContent = content; // Store initial raw markdown
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(div.dataset.rawContent || '');
      showToast('Copied');
    };
  }

  return div;
}

function addCopyButtons(contentEl) {
  if (!contentEl) return;
  contentEl.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.textContent = 'Copy';
    btn.onclick = () => {
      const code = pre.querySelector('code');
      navigator.clipboard.writeText(code ? code.textContent : pre.textContent);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    };
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}

function removeLastSystemMessage() {
  const sysMessages = el.messages.querySelectorAll('.message.system');
  if (sysMessages.length > 0) {
    sysMessages[sysMessages.length - 1].remove();
    // Also remove from state
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'system') {
        state.messages.splice(i, 1);
        break;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  COMMAND PALETTE
// ═══════════════════════════════════════════════════════════════
function handleInputChange() {
  const text = el.input.value;
  if (text.startsWith('/') && !text.includes(' ')) {
    state.cmdPaletteOpen = true;
    state.cmdSelectedIdx = 0;
    renderCmdPalette();
  } else {
    closeCmdPalette();
  }
}

function filteredCommands() {
  const query = el.input.value.toLowerCase();
  return SLASH_COMMANDS.filter(c => c.cmd.startsWith(query));
}

function renderCmdPalette() {
  const cmds = filteredCommands();
  if (cmds.length === 0) { closeCmdPalette(); return; }

  el.cmdList.innerHTML = '';
  cmds.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = `cmd-item${i === state.cmdSelectedIdx ? ' selected' : ''}`;
    item.innerHTML = `<span class="cmd-name">${c.cmd}</span><span class="cmd-desc">${c.desc}</span>`;
    item.onclick = () => selectCommand(i);
    el.cmdList.appendChild(item);
  });

  el.cmdPalette.classList.remove('hidden');
}

function selectCommand(idx) {
  const cmds = filteredCommands();
  if (cmds[idx]) {
    el.input.value = cmds[idx].cmd + (cmds[idx].arg ? ' ' : '');
    el.input.focus();
  }
  closeCmdPalette();
}

function closeCmdPalette() {
  state.cmdPaletteOpen = false;
  el.cmdPalette.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
//  SCREEN CAPTURE
// ═══════════════════════════════════════════════════════════════
async function captureScreen() {
  // Temporarily hide window for a clean capture
  window.zero.hideWindow();
  await sleep(400);

  const dataUrl = await window.zero.captureScreen();

  // Re-show window
  await window.zero.showWindow();
  await sleep(200);

  if (dataUrl) {
    state.screenshot = dataUrl;
    el.screenshotImg.src = dataUrl;
    el.screenshotPreview.classList.remove('hidden');
    showToast('Screenshot captured');
  } else {
    showToast('Screenshot failed');
  }
}

function clearScreenshot() {
  state.screenshot = null;
  el.screenshotPreview.classList.add('hidden');
  el.screenshotImg.src = '';
}

// ═══════════════════════════════════════════════════════════════
//  QUOTE (Selected Text Context)
// ═══════════════════════════════════════════════════════════════
function clearQuote() {
  state.quote = '';
  el.quoteBlock.classList.add('hidden');
  el.quoteText.textContent = '';
}

// ═══════════════════════════════════════════════════════════════
//  FILE ATTACHMENT
// ═══════════════════════════════════════════════════════════════
async function attachFile() {
  const file = await window.zero.pickFile();
  if (!file) return;
  if (file.error) { showToast(file.error); return; }

  state.attachment = file;

  if (file.type === 'image') {
    // Show in screenshot preview area (reuse it)
    el.screenshotImg.src = file.dataUrl;
    el.screenshotPreview.classList.remove('hidden');
    showToast(`Attached: ${file.name}`);
  } else {
    // Show in quote block area (reuse for text files)
    el.quoteText.textContent = `📎 ${file.name} (${formatSize(file.size)})`;
    el.quoteBlock.querySelector('.quote-label').textContent = 'ATTACHED FILE';
    el.quoteBlock.classList.remove('hidden');
  }
  el.input.focus();
}

function clearAttachment() {
  state.attachment = null;
  // Reset quote label if it was showing a file
  if (el.quoteBlock?.querySelector('.quote-label')) {
    el.quoteBlock.querySelector('.quote-label').textContent = 'SELECTED TEXT';
  }
  // Clear image preview if we borrowed the screenshot UI for image attachment
  el.screenshotPreview.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
//  AUTO-TOOL DETECTION — run files/commands automatically
// ═══════════════════════════════════════════════════════════════
async function autoDetectAndRunTools(text) {
  const lower = text.toLowerCase().trim();

  // Detect "read file <path>" / "show me <path>" / "open <path>" / "cat <path>"
  const filePatterns = [
    /(?:read|show|open|cat|view|display|print)\s+(?:the\s+)?(?:file\s+)?["']?([a-zA-Z]:\\[^\s"']+|\.{0,2}\/[^\s"']+)["']?/i,
    /(?:what(?:'s| is) in|contents? of)\s+["']?([a-zA-Z]:\\[^\s"']+|\.{0,2}\/[^\s"']+)["']?/i,
  ];

  for (const pat of filePatterns) {
    const match = text.match(pat);
    if (match && match[1]) {
      const filePath = match[1].replace(/["']+$/, '');
      const result = await window.zero.readFile(filePath);
      if (result.content) {
        const ext = filePath.split('.').pop() || '';
        return `\n\n--- Contents of ${result.path} (${formatSize(result.size)}) ---\n\`\`\`${ext}\n${result.content}\n\`\`\``;
      } else if (result.error) {
        return `\n\n[File error: ${result.error}]`;
      }
    }
  }

  // Detect "list <path>" / "ls <path>" / "what's in <dir>"
  const dirPatterns = [
    /(?:list|ls|dir|show)\s+(?:the\s+)?(?:files\s+in\s+|contents?\s+of\s+|directory\s+)?["']?([a-zA-Z]:\\[^\s"']*|\.{0,2}\/[^\s"']*)["']?/i,
  ];

  for (const pat of dirPatterns) {
    const match = lower.match(pat);
    if (match && match[1]) {
      const dirPath = match[1];
      // Only trigger if it looks like a directory (no extension or ends with / or \)
      if (!dirPath.match(/\.\w{1,5}$/)) {
        const result = await window.zero.listDir(dirPath);
        if (result.entries) {
          const listing = result.entries.map(e => `${e.isDir ? '📁' : '📄'} ${e.name}${e.size ? ` (${formatSize(e.size)})` : ''}`).join('\n');
          return `\n\n--- Directory: ${result.path} ---\n\`\`\`\n${listing}\n\`\`\``;
        }
      }
    }
  }

  // Detect "run <command>" / "execute <command>"
  const cmdPatterns = [
    /(?:run|execute|do)\s+(?:the\s+)?(?:command\s+)?["`'](.+?)["`']/i,
    /(?:run|execute)\s+(?:the\s+)?command\s+(.+)/i,
  ];

  for (const pat of cmdPatterns) {
    const match = text.match(pat);
    if (match && match[1]) {
      const cmd = match[1].trim();
      if (cmd.length > 2 && cmd.length < 200) {
        const result = await window.zero.runCommand(cmd);
        let output = result.stdout || '';
        if (result.stderr) output += (output ? '\n' : '') + result.stderr;
        return `\n\n--- Command: ${cmd} (exit ${result.exitCode || 0}) ---\n\`\`\`\n${output || '(no output)'}\n\`\`\``;
      }
    }
  }

  // Detect "find <name>" / "where is <name>" / "locate <name>"
  const findPatterns = [
    /(?:find|where\s+is|locate|search\s+for)\s+(?:the\s+)?(?:folder|directory|file|project)?\s*["']?([\w.\-]+)["']?/i,
  ];

  for (const pat of findPatterns) {
    const match = text.match(pat);
    if (match && match[1]) {
      const name = match[1].trim();
      if (name.length >= 2 && name.length < 60) {
        // Search common drives
        const searchCmd = `Get-ChildItem -Path C:\\ -Filter "${name}" -Directory -Recurse -Depth 4 -ErrorAction SilentlyContinue | Select-Object -First 10 -ExpandProperty FullName`;
        const result = await window.zero.runCommand(searchCmd);
        const output = (result.stdout || '').trim();
        if (output) {
          return `\n\n--- Search results for "${name}" ---\n\`\`\`\n${output}\n\`\`\``;
        } else {
          return `\n\n[No folders named "${name}" found on C:\\ (searched 4 levels deep)]`;
        }
      }
    }
  }

  return null;  // no tool detected
}

// ═══════════════════════════════════════════════════════════════
//  SIDEBAR & CONVERSATIONS
// ═══════════════════════════════════════════════════════════════
function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  el.sidebar.classList.toggle('hidden', !state.sidebarOpen);
}

function newConversation() {
  // Save current first
  if (state.messages.length > 0 && state.conversationId) {
    saveCurrentConversation();
  }

  state.conversationId = uid();
  state.conversationTitle = '';
  state.messages = [];
  state.quote = '';
  state.screenshot = null;
  state.attachment = null;
  state.streamedContent = '';

  el.messages.innerHTML = '';
  el.welcome.classList.remove('hidden');
  clearQuote();
  clearScreenshot();
  el.input.value = '';
  el.input.focus();
}

async function loadConversations() {
  state.conversations = await window.zero.getConversations();
  renderConversationList();
}

function renderConversationList() {
  el.convList.innerHTML = '';
  if (state.conversations.length === 0) {
    el.convList.innerHTML = '<p style="padding:16px;color:var(--text-4);font-size:var(--fs-xs);text-align:center;">No conversations yet</p>';
    return;
  }

  state.conversations.forEach(c => {
    const item = document.createElement('div');
    item.className = `conv-item${c.id === state.conversationId ? ' active' : ''}`;
    item.innerHTML = `
      <div class="conv-item-title">${escapeHtml(c.title || 'Untitled')}</div>
      <div class="conv-item-meta">${c.messageCount} messages · ${formatDate(c.updatedAt)}</div>
      <button class="conv-item-delete" title="Delete">&times;</button>`;

    item.onclick = (e) => {
      if (e.target.classList.contains('conv-item-delete')) return;
      loadConversation(c.id);
    };
    item.querySelector('.conv-item-delete').onclick = (e) => {
      e.stopPropagation();
      deleteConversation(c.id);
    };

    el.convList.appendChild(item);
  });
}

async function loadConversation(id) {
  const conv = await window.zero.getConversation(id);
  if (!conv) return;

  state.conversationId = conv.id;
  state.conversationTitle = conv.title;
  state.messages = conv.messages;

  el.messages.innerHTML = '';
  el.welcome.classList.add('hidden');

  conv.messages.forEach(msg => {
    const msgEl = createMessageElement(msg.role, msg.content);
    el.messages.appendChild(msgEl);
  });

  scrollToBottom();
  toggleSidebar();
}

async function saveCurrentConversation() {
  if (state.messages.length === 0) return;
  if (!state.conversationId) state.conversationId = uid();

  const conv = {
    id: state.conversationId,
    title: state.conversationTitle || 'Untitled',
    createdAt: state.messages[0]?.timestamp || Date.now(),
    updatedAt: Date.now(),
    messages: state.messages.filter(m => m.role !== 'system')
  };

  await window.zero.saveConversation(conv);
  await loadConversations();
}

async function deleteConversation(id) {
  await window.zero.deleteConversation(id);
  if (id === state.conversationId) newConversation();
  await loadConversations();
}

// ═══════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    el.chatArea.scrollTop = el.chatArea.scrollHeight;
  });
}

function autoResizeInput() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatSize(bytes) {
  if (!bytes) return '0B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ═══════════════════════════════════════════════════════════════
//  MEMORY SYSTEM
// ═══════════════════════════════════════════════════════════════
async function buildMemoryContext() {
  const mem = await window.zero.getMemory();
  const parts = [];

  parts.push(`You are Zero, a powerful AI agent running locally on the user's Windows computer via Ollama.
The environment paths you see below are dynamically generated for the active user. You use these to ensure you always target the correct local directories.
- Current User Home Directory: ${window.zero.getHomeDir()}
- User Desktop: ${window.zero.getHomeDir()}\\Desktop
- User Downloads: ${window.zero.getHomeDir()}\\Downloads

You are NOT a generic chatbot. You are an AGENT with real system access. You can:
- Read, write, and delete files on the user's computer
- List directories and find files/folders
- Run any PowerShell or command-line command (including Administrative commands)
- Search the web
- Capture screenshots
- Access the user's clipboard and selected text

IMPORTANT RULES:
1. When the user asks you to DO something (find a file, run a command, delete a file), the app has ALREADY executed the relevant tools or will execute them. Work with the tools directly.
2. **ADMINISTRATIVE COMMANDS**: You can run ANY command as an Administrator! If a user asks for an administrative command, or if a task requires elevation, use the \`run_command\` tool and set the \`run_as_admin\` property to true.
3. NEVER say "I cannot access your file system" or "I cannot run administrative commands" — you CAN and you DO.
4. For destructive actions (running arbitrary commands, deleting files), the system will AUTOMATICALLY ask the user for permission. You do NOT need to ask for permission yourself; just execute the tool. If the user denies it, the tool returns an error.
5. **BACKGROUND SERVERS**: If you need to host a local web server, use the command \`python -m http.server 8000 -d <directory_path>\` and ALWAYS set the \`background\` property to \`true\`. AFTER you spawn the server, YOU MUST reply to the user with the direct, clickable link to what you just hosted (e.g., \`http://127.0.0.1:8000/filename.html\`). Avoid saying the link is "undefined".
6. NEVER attempt to wipe the PC, format drives, or delete critical system folders. 
7. You have persistent memory — you remember facts about the user across conversations.
8. Be concise, direct, and action-oriented. Do not apologize. Do not say "I will do that now", just do it.`);

  if (mem.facts.length > 0) {
    parts.push('Things you know about the user:\n' + mem.facts.map(f => `- ${f}`).join('\n'));
  }

  if (mem.summaries.length > 0) {
    const recent = mem.summaries.slice(0, 5);
    parts.push('Recent conversation history:\n' + recent.map(s => `- ${s.text}`).join('\n'));
  }

  return parts.join('\n\n');
}

function extractMemoryFacts(text) {
  // We only extract facts when the user explicitly commands the AI to remember something
  // Generic "I am..." regexes cause too many false positives in casual conversation.
  const lower = text.toLowerCase();
  
  const patterns = [
    /remember\s+(?:that\s+)?(.{5,100})/i,
    /note\s+that\s+(.{5,100})/i,
    /keep\s+in\s+mind\s+(?:that\s+)?(.{5,100})/i,
    /store\s+this\s+(?:in memory)?(?:[:,\s]+)?(.{5,100})/i
  ];

  for (const pat of patterns) {
    const match = lower.match(pat);
    if (match && match[1]) {
      const fact = match[1].replace(/[.!?]+$/, '').trim();
      if (fact.length > 3 && fact.length < 100) {
        // Use original case from the text
        const origMatch = text.match(pat);
        const origFact = origMatch ? origMatch[1].replace(/[.!?]+$/, '').trim() : fact;
        window.zero.addMemoryFact(origFact);
      }
      break;  // one fact per message to avoid noise
    }
  }
}

async function autoSummarizeConversation() {
  // Build a one-line summary of the current conversation
  const userMsgs = state.messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .slice(0, 5);

  if (userMsgs.length < 2) return;

  // Simple client-side summary (no LLM needed — just use the title + topics)
  const title = state.conversationTitle || userMsgs[0].substring(0, 50);
  const summary = `Discussed: ${title}`;
  await window.zero.addMemorySummary(summary);
}

// ═══════════════════════════════════════════════════════════════
//  MEMORY PANEL UI
// ═══════════════════════════════════════════════════════════════
function setupMemoryPanel() {
  el.memoryPanelClose.onclick = () => closeMemoryPanel();
  el.memoryClearAll.onclick = async () => {
    await window.zero.clearMemory();
    showToast('All memory cleared');
    renderMemoryPanel();
  };
  el.memoryAddFact.onclick = () => showAddFactInput();

  // Close on clicking backdrop
  el.memoryPanel.addEventListener('click', (e) => {
    if (e.target === el.memoryPanel) closeMemoryPanel();
  });
}

function openMemoryPanel() {
  el.memoryPanel.classList.remove('hidden');
  renderMemoryPanel();
}

function closeMemoryPanel() {
  el.memoryPanel.classList.add('hidden');
}

async function renderMemoryPanel() {
  const mem = await window.zero.getMemory();

  // Render facts
  if (mem.facts.length === 0) {
    el.memoryFactsList.innerHTML = '<div class="memory-empty">No facts stored. Say "remember that..." or add one manually.</div>';
  } else {
    el.memoryFactsList.innerHTML = '';
    mem.facts.forEach((fact, i) => {
      const item = document.createElement('div');
      item.className = 'memory-item';
      item.innerHTML = `
        <span class="memory-item-text">${escapeHtml(fact)}</span>
        <div class="memory-item-actions">
          <button class="memory-item-btn edit" title="Edit">✎</button>
          <button class="memory-item-btn delete" title="Delete">✕</button>
        </div>`;

      // Edit handler
      item.querySelector('.edit').onclick = () => {
        const textEl = item.querySelector('.memory-item-text');
        const currentText = fact;
        textEl.outerHTML = `<input class="memory-item-input" value="${escapeHtml(currentText)}">`;
        const input = item.querySelector('.memory-item-input');
        input.focus();
        input.select();

        const save = async () => {
          const newText = input.value.trim();
          if (newText && newText !== currentText) {
            await window.zero.updateMemoryFact(i, newText);
          }
          renderMemoryPanel();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') renderMemoryPanel();
        });
        input.addEventListener('blur', save);
      };

      // Delete handler
      item.querySelector('.delete').onclick = async () => {
        await window.zero.deleteMemoryFact(i);
        renderMemoryPanel();
      };

      el.memoryFactsList.appendChild(item);
    });
  }

  // Render summaries
  if (mem.summaries.length === 0) {
    el.memorySummariesList.innerHTML = '<div class="memory-empty">No conversation summaries yet.</div>';
  } else {
    el.memorySummariesList.innerHTML = '';
    mem.summaries.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'memory-item';
      const timeStr = new Date(s.time).toLocaleDateString([], { month: 'short', day: 'numeric' });
      item.innerHTML = `
        <span class="memory-item-text">${escapeHtml(s.text)} <span style="color:var(--text-4);font-size:10px">${timeStr}</span></span>
        <div class="memory-item-actions">
          <button class="memory-item-btn delete" title="Delete">✕</button>
        </div>`;

      item.querySelector('.delete').onclick = async () => {
        await window.zero.deleteMemorySummary(i);
        renderMemoryPanel();
      };

      el.memorySummariesList.appendChild(item);
    });
  }
}

function showAddFactInput() {
  // Check if already showing
  if (el.memoryFactsList.querySelector('.memory-add-row')) return;

  const row = document.createElement('div');
  row.className = 'memory-add-row';
  row.innerHTML = `
    <input class="memory-add-input" placeholder="Type a fact to remember..." autofocus>
    <button class="memory-save-btn">Save</button>`;

  el.memoryFactsList.appendChild(row);

  const input = row.querySelector('.memory-add-input');
  const saveBtn = row.querySelector('.memory-save-btn');
  input.focus();

  const save = async () => {
    const text = input.value.trim();
    if (text) {
      await window.zero.addMemoryFact(text);
      renderMemoryPanel();
    } else {
      row.remove();
    }
  };

  saveBtn.onclick = save;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') row.remove();
  });
}

// ═══════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);
