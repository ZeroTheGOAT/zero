# Zero

Zero is a local AI assistant that runs as a floating overlay on Windows. It connects to Ollama running on your machine, keeping everything private and offline. No cloud services, no API keys, no subscriptions.

---

## Requirements

- **Windows 10/11**
- **Node.js** (v18 or higher) — https://nodejs.org
- **Ollama** — https://ollama.com/download
- At least one Ollama model pulled (e.g. `ollama pull gemma3:e2b`)

---

## Installation

```
git clone https://github.com/ZeroTheGOAT/zero.git
cd zero
npm install
```

---

## Running

Start Ollama first if it is not already running:

```
ollama serve
```

Then launch Zero:

```
npm start
```

You can also double-click `scripts/start.bat` which handles starting Ollama and Zero together. For a completely silent launch with no console window, use `scripts/Zero.vbs`.

Once running, press `Ctrl` twice quickly (double-tap) from anywhere on your desktop to summon or dismiss the overlay.

---

## Features

### AI Chat
- Stream responses from any Ollama model installed on your system
- Switch between models on the fly from the input bar
- Full markdown rendering with syntax-highlighted code blocks
- Copy individual messages or code blocks with one click

### Agentic Tool Use
- The AI can read and write files on your machine
- It can run shell commands and PowerShell scripts
- It can search the web and read pages for you
- It can list directories and find files across your filesystem
- Background process tracking with the ability to stop running tasks
- Every destructive action requires your explicit approval before executing

### Media and Vision
- Attach images from your filesystem and send them to vision-capable models
- Capture your screen directly from the overlay and ask the AI about what it sees
- Attached images are displayed inline in the chat

### Memory
- Zero remembers things you explicitly tell it to remember across sessions
- Conversation summaries are stored automatically
- View, edit, and delete stored memories from the memory panel

### Overlay Behavior
- Frameless transparent window that floats above all other apps
- Global hotkey (double-tap Ctrl) to summon from anywhere, no matter what app is focused
- Draggable title bar to reposition the window
- Conversation history with the ability to switch between past chats

### File Tracking
- Files created by the AI during a session are tracked in the Files tab
- Terminal processes running in the background are listed in the Terminal tab

---

## Project Structure

```
zero/
  src/
    main.js          Main Electron process, IPC handlers, tool execution
    preload.js       Secure bridge between main and renderer
    renderer.js      UI logic, chat, commands, memory panel
    index.html       Application markup
    styles.css       Design system and all styling
  scripts/
    start.bat        Windows batch launcher (starts Ollama + Zero)
    Zero.vbs         Silent VBS launcher (no console window)
  package.json
```

---

## Configuration

Zero connects to Ollama at `http://127.0.0.1:11434` by default. No additional configuration is needed.

The default model is `gemma3:4b`. You can change the active model from the dropdown in the input bar at any time.

Data (conversation history, memory) is stored locally under your system app data directory.

---

## License

MIT
