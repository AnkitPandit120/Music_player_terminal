import audio from 'audio';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

// ── Colors & Styling ────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  green: '\x1b[32m',
  brightGreen: '\x1b[92m',
  yellow: '\x1b[33m',
  white: '\x1b[37m',
  brightWhite: '\x1b[97m',
  gray: '\x1b[90m',

  // Badges (Background + Dark Text)
  badgePlay: '\x1b[42m\x1b[30m\x1b[1m PLAYING \x1b[0m',
  badgePause: '\x1b[43m\x1b[30m\x1b[1m PAUSED  \x1b[0m',
  badgeLoad: '\x1b[44m\x1b[37m\x1b[1m LOADING \x1b[0m',
  badgeStop: '\x1b[100m\x1b[37m\x1b[1m STOPPED \x1b[0m',
};

// ── Audio Files Discovery ───────────────────────────────────────────────────
const supportedExts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'];
let files = process.argv.slice(2);

if (files.length === 0) {
  files = fs.readdirSync(process.cwd())
    .filter(f => supportedExts.includes(path.extname(f).toLowerCase()))
    .sort();
}

if (files.length === 0) {
  console.error(`${c.yellow}No audio files found.${c.reset} Usage: node player.js <file1.mp3> ...`);
  process.exit(1);
}

// ── State ───────────────────────────────────────────────────────────────────
let currentIndex = 0;   // Track currently loaded and playing
let selectedIndex = 0;  // Track highlighted by cursor [↑/↓]
let track = null;
let isChanging = false;

// ── Helper Utilities ────────────────────────────────────────────────────────
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function truncate(str, maxLen) {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

// Strip ANSI escape sequences to compute visual character length accurately
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function padLine(content, width) {
  const visualLen = stripAnsi(content).length;
  const pad = Math.max(0, width - visualLen);
  return content + ' '.repeat(pad);
}

// ── UI Box Renderer ─────────────────────────────────────────────────────────
function renderUI() {
  const termWidth = process.stdout.columns || 80;
  const BOX_WIDTH = Math.min(74, Math.max(54, termWidth - 2));
  const innerWidth = BOX_WIDTH - 4; // space between left and right borders

  const borderTop = `${c.cyan}╭${'─'.repeat(BOX_WIDTH - 2)}╮${c.reset}`;
  const borderMid = `${c.cyan}├${'─'.repeat(BOX_WIDTH - 2)}┤${c.reset}`;
  const borderBottom = `${c.cyan}╰${'─'.repeat(BOX_WIDTH - 2)}╯${c.reset}`;

  function row(content) {
    return `${c.cyan}│${c.reset} ${padLine(content, innerWidth)} ${c.cyan}│${c.reset}`;
  }

  const lines = [];
  lines.push(borderTop);

  // 1. Header
  const title = `${c.brightCyan}${c.bold}♫  TERMINAL AUDIO PLAYER${c.reset}`;
  const trackCount = `${c.gray}(${files.length} track${files.length > 1 ? 's' : ''})${c.reset}`;
  lines.push(row(`${title}  ${trackCount}`));

  lines.push(borderMid);

  // 2. Playlist Section (Windowed for smooth scrolling)
  lines.push(row(`${c.bold}${c.brightWhite}PLAYLIST${c.reset}`));

  const MAX_VISIBLE = 5;
  let startIdx = 0;
  if (files.length > MAX_VISIBLE) {
    startIdx = Math.max(0, Math.min(selectedIndex - Math.floor(MAX_VISIBLE / 2), files.length - MAX_VISIBLE));
  }
  const visibleFiles = files.slice(startIdx, startIdx + MAX_VISIBLE);

  for (let offset = 0; offset < visibleFiles.length; offset++) {
    const i = startIdx + offset;
    const isSelected = i === selectedIndex;
    const isCurrent = i === currentIndex;

    const pointer = isSelected ? `${c.brightCyan}${c.bold}❯${c.reset}` : ' ';
    const num = `${c.gray}${String(i + 1).padStart(2, ' ')}.${c.reset}`;

    let status = '       ';
    if (isCurrent && track) {
      status = track.paused
        ? `${c.yellow}[PAUSE]${c.reset}`
        : `${c.brightGreen}[PLAY] ${c.reset}`;
    }

    const name = path.basename(files[i]);
    const maxNameLen = innerWidth - 18;
    const formattedName = isSelected
      ? `${c.brightCyan}${c.bold}${truncate(name, maxNameLen)}${c.reset}`
      : `${c.white}${truncate(name, maxNameLen)}${c.reset}`;

    lines.push(row(`${pointer} ${num} ${status} ${formattedName}`));
  }

  if (files.length > MAX_VISIBLE) {
    const scrollInfo = `${c.gray}── showing ${startIdx + 1}-${startIdx + visibleFiles.length} of ${files.length} ──${c.reset}`;
    lines.push(row(scrollInfo));
  }

  lines.push(borderMid);

  // 3. Now Playing & Progress Bar Section
  const currentFileName = path.basename(files[currentIndex]);
  lines.push(row(`${c.gray}NOW PLAYING:${c.reset} ${c.brightWhite}${c.bold}${truncate(currentFileName, innerWidth - 14)}${c.reset}`));

  const current = track ? (track.currentTime || 0) : 0;
  const total = track ? (track.duration || 1) : 1;
  const progress = Math.min(1, Math.max(0, current / total));
  const percent = Math.floor(progress * 100);

  let badge = c.badgePlay;
  if (!track || isChanging) {
    badge = c.badgeLoad;
  } else if (track.paused) {
    badge = c.badgePause;
  }

  const barLength = Math.max(12, innerWidth - 36);
  const filled = Math.round(barLength * progress);
  const empty = barLength - filled;
  const progressBar = `${c.brightCyan}${'█'.repeat(filled)}${c.gray}${'░'.repeat(empty)}${c.reset}`;
  const timeStr = `${c.white}${formatTime(current)}${c.gray} / ${c.white}${formatTime(total)}${c.reset}`;
  const percentStr = `${c.gray}${String(percent).padStart(3, ' ')}%${c.reset}`;

  lines.push(row(`${badge}  ${timeStr}  [${progressBar}]  ${percentStr}`));

  lines.push(borderMid);

  // 4. Controls Footer
  lines.push(row(`${c.gray}CONTROLS${c.reset}`));
  lines.push(row(`${c.brightCyan}[↑/↓]${c.reset} Select   ${c.brightCyan}[Enter]${c.reset} Play   ${c.brightCyan}[Space]${c.reset} Pause/Resume   ${c.brightCyan}[q]${c.reset} Quit`));
  lines.push(row(`${c.brightCyan}[A/D]${c.reset} ⏪ 10s ⏩  ${c.brightCyan}[←/→]${c.reset} Prev/Next Track`));

  lines.push(borderBottom);

  // Flicker-free render using cursor home \x1b[H and clear line \x1b[K
  process.stdout.write('\x1b[H' + lines.map(line => line + '\x1b[K').join('\n') + '\n\x1b[J');
}

// ── Track Switching ─────────────────────────────────────────────────────────
async function switchTrack(index) {
  if (isChanging) return;
  isChanging = true;

  try {
    if (track) {
      track.stop();
    }

    currentIndex = index;
    selectedIndex = index;
    renderUI();

    track = await audio(files[currentIndex]);
    track.play();

    // Auto-advance to next track when finished
    track.on('ended', () => {
      switchTrack((currentIndex + 1) % files.length);
    });
  } catch (err) {
    console.error(`Error playing ${files[currentIndex]}:`, err.message);
  } finally {
    isChanging = false;
    renderUI();
  }
}

// ── Setup Terminal Environment ──────────────────────────────────────────────
console.clear();
process.stdout.write('\x1b[?25l'); // Hide cursor

const interval = setInterval(renderUI, 100);

function cleanupAndExit() {
  clearInterval(interval);
  if (track) track.stop();
  process.stdout.write('\x1b[?25h'); // Restore cursor
  console.clear();
  console.log(`${c.brightCyan}♫ Terminal player closed. Goodbye!${c.reset}\n`);
  process.exit(0);
}

// Enable raw mode for instant keystrokes
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

// ── Key Listeners ───────────────────────────────────────────────────────────
process.stdin.on('keypress', (str, key) => {
  // Quit on 'q' or Ctrl+C
  if (str === 'q' || str === 'Q' || (key && key.ctrl && key.name === 'c')) {
    cleanupAndExit();
  }

  // Navigate Up
  if (key && key.name === 'up') {
    selectedIndex = (selectedIndex - 1 + files.length) % files.length;
    renderUI();
  }

  // Navigate Down
  if (key && key.name === 'down') {
    selectedIndex = (selectedIndex + 1) % files.length;
    renderUI();
  }

  // Play Selected Track on Enter
  if (key && (key.name === 'return' || key.name === 'enter')) {
    switchTrack(selectedIndex);
  }

  // Toggle Play / Pause on Space
  if (str === ' ' || (key && key.name === 'space')) {
    if (track) {
      if (track.paused) {
        track.resume();
      } else {
        track.pause();
      }
      renderUI();
    }
  }

  // Rewind 10s on 'A'
  if (str === 'a' || str === 'A') {
    if (track && !isChanging) {
      const target = Math.max(0, (track.currentTime || 0) - 10);
      track.seek(target);
      renderUI();
    }
  }

  // Forward 10s on 'D'
  if (str === 'd' || str === 'D') {
    if (track && !isChanging) {
      const target = Math.min(track.duration || 0, (track.currentTime || 0) + 10);
      track.seek(target);
      renderUI();
    }
  }

  // Next Track on Right Arrow
  if (key && key.name === 'right') {
    const nextIndex = (currentIndex + 1) % files.length;
    switchTrack(nextIndex);
  }

  // Previous Track on Left Arrow
  if (key && key.name === 'left') {
    const prevIndex = (currentIndex - 1 + files.length) % files.length;
    switchTrack(prevIndex);
  }
});

// Start playing
switchTrack(0);
