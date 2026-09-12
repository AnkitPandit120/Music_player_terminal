import audio from 'audio';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

// Get audio files from command line arguments or scan current directory
const supportedExts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'];
let files = process.argv.slice(2);

if (files.length === 0) {
  files = fs.readdirSync(process.cwd())
    .filter(f => supportedExts.includes(path.extname(f).toLowerCase()))
    .sort();
}

if (files.length === 0) {
  console.error('No audio files found. Usage: node player.js <file1.mp3> <file2.mp3> ...');
  process.exit(1);
}

let currentIndex = 0;   // Track currently playing
let selectedIndex = 0;  // Track highlighted in playlist with arrow keys
let track = null;
let isChanging = false;

// Format seconds into MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Render playlist, selected item, and progress bar
function renderUI() {
  const lines = [];

  lines.push('🎵 Terminal Audio Player');
  lines.push('Controls: [↑/↓] Select | [Enter] Play | [Space] Pause/Resume | [A/D] -10s/+10s | [←/→] Prev/Next | [q] Quit');
  lines.push('─'.repeat(70));
  lines.push('Playlist:');

  // Display track list
  for (let i = 0; i < files.length; i++) {
    const isSelected = i === selectedIndex;
    const isCurrent = i === currentIndex;

    const pointer = isSelected ? '❯ ' : '  ';
    let statusIcon = '   ';
    if (isCurrent && track) {
      statusIcon = track.paused ? '[⏸]' : '[▶]';
    }

    const trackName = path.basename(files[i]);
    lines.push(`${pointer}${i + 1}. ${statusIcon} ${trackName}`);
  }

  lines.push('─'.repeat(70));

  // Display live playback bar
  if (track && !isChanging) {
    const current = track.currentTime || 0;
    const total = track.duration || 1;
    const progress = Math.min(1, Math.max(0, current / total));

    const barLength = 22;
    const filled = Math.round(barLength * progress);
    const empty = barLength - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    const status = track.paused ? '⏸ PAUSED ' : '▶ PLAYING';
    const time = `${formatTime(current)} / ${formatTime(total)}`;
    lines.push(`${status} [${bar}] ${time}`);
  } else if (isChanging) {
    lines.push(`⏳ Loading ${path.basename(files[currentIndex])}...`);
  } else {
    lines.push('Press Enter to play.');
  }

  // Draw UI using \x1b[H (move cursor to home) with line clearing for zero-flicker updates
  process.stdout.write('\x1b[H' + lines.map(line => line + '\x1b[K').join('\n') + '\n\x1b[J');
}

// Switch and play track by index
async function switchTrack(index) {
  if (isChanging) return;
  isChanging = true;

  try {
    if (track) {
      track.stop();
    }

    currentIndex = index;
    selectedIndex = index; // Move selection to match current playing track
    renderUI();

    track = await audio(files[currentIndex]);
    track.play();

    // Auto-advance to next track when finished (looping back to 1)
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

// Clear screen once at startup and hide cursor
console.clear();
process.stdout.write('\x1b[?25l');

// Refresh progress bar every 100ms
const interval = setInterval(renderUI, 100);

function cleanupAndExit() {
  clearInterval(interval);
  if (track) track.stop();
  process.stdout.write('\x1b[?25h\n'); // restore cursor
  process.exit(0);
}

// Enable raw mode for single keypress capture
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

// Handle keystrokes
process.stdin.on('keypress', (str, key) => {
  // Quit on 'q' or Ctrl+C
  if (str === 'q' || str === 'Q' || (key && key.ctrl && key.name === 'c')) {
    cleanupAndExit();
  }

  // Navigate selection Up
  if (key && key.name === 'up') {
    selectedIndex = (selectedIndex - 1 + files.length) % files.length;
    renderUI();
  }

  // Navigate selection Down
  if (key && key.name === 'down') {
    selectedIndex = (selectedIndex + 1) % files.length;
    renderUI();
  }

  // Play selected track on Enter
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

  // Rewind 10 seconds on 'A' or 'a'
  if (str === 'a' || str === 'A') {
    if (track && !isChanging) {
      const targetTime = Math.max(0, (track.currentTime || 0) - 10);
      track.seek(targetTime);
      renderUI();
    }
  }

  // Fast-forward 10 seconds on 'D' or 'd'
  if (str === 'd' || str === 'D') {
    if (track && !isChanging) {
      const targetTime = Math.min(track.duration || 0, (track.currentTime || 0) + 10);
      track.seek(targetTime);
      renderUI();
    }
  }

  // Skip to next track on Right arrow
  if (key && key.name === 'right') {
    const nextIndex = (currentIndex + 1) % files.length;
    switchTrack(nextIndex);
  }

  // Skip to previous track on Left arrow
  if (key && key.name === 'left') {
    const prevIndex = (currentIndex - 1 + files.length) % files.length;
    switchTrack(prevIndex);
  }
});

// Start playing the first track
switchTrack(0);
