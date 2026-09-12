# ♫ Terminal Audio Player

A sleek, lightweight, interactive terminal-based music player built with Node.js and ES Modules. Features a flicker-free card UI with a live progress bar, playlist navigation, and full keyboard control.

```text
╭────────────────────────────────────────────────────────────────────────╮
│ ♫  TERMINAL AUDIO PLAYER  (3 tracks)                                   │
├────────────────────────────────────────────────────────────────────────┤
│ PLAYLIST                                                               │
│      1. [PLAY]  sound1.mp3                                             │
│ ❯    2.         sound2.mp3                                             │
│      3.         sound3.mp3                                             │
├────────────────────────────────────────────────────────────────────────┤
│ NOW PLAYING: sound1.mp3                                                │
│  PLAYING   01:23 / 03:45  [████████████░░░░░░░░░░░░░░░░░░]   36%       │
├────────────────────────────────────────────────────────────────────────┤
│ CONTROLS                                                               │
│ [↑/↓] Select   [Enter] Play   [Space] Pause/Resume   [q] Quit          │
│ [A/D] ⏪ 10s ⏩  [←/→] Prev/Next Track                                  │
╰────────────────────────────────────────────────────────────────────────╯
```

---

## ⚡ Features

- **Interactive Playlist Navigation**: Browse tracks using the `↑` and `↓` arrow keys, and hit `Enter` to switch songs on demand.
- **Real-Time Dynamic Progress Bar**: Smoothly updates elapsed time, duration, and percentage (`MM:SS / MM:SS [████░░░░] XX%`).
- **Seeking**: Jump backward 10 seconds (`A`) or fast-forward 10 seconds (`D`).
- **Play / Pause**: Instant toggle using the `Space` bar.
- **Continuous & Looping Playback**: Automatically plays the next song when the current one finishes, looping from the last song back to the first.
- **Next & Previous Track Shortcuts**: Skip songs directly using `←` and `→` arrow keys.
- **Flicker-Free Terminal UI**: Uses ANSI cursor-home positioning (`\x1b[H`) and line-clearing (`\x1b[K`) for smooth 60fps rendering without terminal flicker.
- **Auto-Discovery**: Automatically discovers all audio files in the current working directory if no arguments are passed.

---

## 🛠 Tech Stack

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | [Node.js](https://nodejs.org/) (v18+) | JavaScript execution engine |
| **Module System** | ES Modules (`import` / `export`) | Modern JavaScript syntax (`"type": "module"`) |
| **Audio Engine** | [`audio`](https://www.npmjs.com/package/audio) (`^2.6.9`) | PCM audio decoding, playback streaming, and seek engine |
| **Speaker Output** | `@audio/speaker` (bundled with `audio`) | Direct hardware audio output stream |
| **Terminal Input** | `node:readline` | Capturing real-time keypress events in terminal raw mode |
| **Filesystem** | `node:fs` & `node:path` | Scanning directories and resolving audio paths |
| **UI Rendering** | ANSI Escape Codes | Formatting colors, badges, borders, and cursor control |

---

## 📦 Imported Modules & How They Work

### 1. `audio` (npm package)
The core library that handles audio playback:
- **Loading & Decoding**: `const track = await audio(filePath)` reads audio files (MP3, WAV, FLAC, OGG, etc.) and decodes them into PCM sample blocks.
- **Playback**: `track.play()` opens the audio device and starts streaming PCM blocks to the system speaker.
- **Transport Controls**:
  - `track.pause()`: Halts speaker streaming while preserving position (`track.currentTime`).
  - `track.resume()`: Resumes PCM streaming from the exact paused timestamp.
  - `track.seek(seconds)`: Moves the playhead forward or backward dynamically.
  - `track.stop()`: Stops playback and closes the output stream.
- **Events**: `track.on('ended', callback)` notifies when a track finishes playing to trigger auto-advance.

### 2. `node:readline` (Node.js built-in)
Used to capture individual keystrokes from standard input without waiting for the user to press Enter:
- `readline.emitKeypressEvents(process.stdin)`: Parses stdin into structured `keypress` events.
- `process.stdin.setRawMode(true)`: Puts the terminal into "raw mode", giving the application direct access to keystrokes as they happen without echoing characters to the terminal.

### 3. `node:fs` & `node:path` (Node.js built-in)
- `fs.readdirSync()`: Reads files in the directory to find audio files.
- `path.extname()`: Filters files by audio extensions (`.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`, `.aac`).
- `path.basename()`: Extracts clean file names for display.

---

## 🎮 Keyboard Controls

| Key | Action |
| :---: | :--- |
| `↑` (Up Arrow) | Move selection cursor up in playlist |
| `↓` (Down Arrow) | Move selection cursor down in playlist |
| `Enter` / `Return` | Play currently selected track |
| `Space` | Toggle Play / Pause |
| `A` / `a` | Rewind 10 seconds |
| `D` / `d` | Fast-forward 10 seconds |
| `→` (Right Arrow) | Skip to next track (loops after the last track) |
| `←` (Left Arrow) | Skip to previous track (loops from first to last) |
| `q` / `Ctrl + C` | Stop playback, restore cursor, and quit |

---

## 🚀 How to Set Up and Run

### 1. Prerequisites
Ensure you have **Node.js** (version 18 or higher) installed:
```bash
node -v
```

### 2. Clone / Open Project
```bash
cd "audio player"
```

### 3. Install Dependencies
Make sure the dependencies are installed:
```bash
npm install
```

### 4. Add Audio Files
Place any `.mp3`, `.wav`, or `.flac` files into the project folder.

### 5. Start the Player
You can run the player with no arguments to automatically play all audio files in the folder:
```bash
node player.js
```

Or pass specific tracks as command-line arguments:
```bash
node player.js sound1.mp3 sound2.mp3 sound3.mp3
```

---

## 🧠 Internal Architecture & How It Works

1. **Playlist State Management**:
   - `currentIndex`: Points to the track that is actively playing sound through the speakers.
   - `selectedIndex`: Points to the track highlighted by the user's cursor (`❯`) in the menu, allowing you to browse other tracks while music plays.

2. **Circular Looping**:
   - Next Track: `(currentIndex + 1) % files.length`
   - Previous Track: `(currentIndex - 1 + files.length) % files.length`
   - When the current track emits `'ended'`, `switchTrack()` is called with the next circular index.

3. **Flicker-Free Terminal Rendering**:
   - Rather than calling `console.clear()` every 100ms (which causes rapid visual flashing), the screen string is built into a single buffer.
   - `\x1b[H` resets the cursor to row 1, column 1, and `\x1b[K` clears each line as it overwrites.
   - ANSI color codes are stripped when calculating layout widths (`stripAnsi()`) so borders align properly across all screen sizes.

4. **Clean Exit Handling**:
   - The blinking cursor is hidden at startup (`\x1b[?25l`).
   - When quitting (`q` or `Ctrl+C`), `cleanupAndExit()` clears intervals, stops audio playback, restores the terminal cursor (`\x1b[?25h`), and resets terminal raw mode.
