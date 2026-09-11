import audio from 'audio';
import readline from 'node:readline';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node player.js <file.mp3>');
  process.exit(1);
}

const track = await audio(file);

track.play();
console.log(`Track: ${file}`);
console.log('Controls: [Space] Play/Pause | [q] Quit\n');

// Format seconds into MM:SS format
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Render the progress bar on the same line
function renderProgress() {
  const current = track.currentTime || 0;
  const total = track.duration || 1;
  const progress = Math.min(1, Math.max(0, current / total));

  const barLength = 25;
  const filled = Math.round(barLength * progress);
  const empty = barLength - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  const status = track.paused ? '⏸ PAUSED ' : '▶ PLAYING';
  const time = `${formatTime(current)} / ${formatTime(total)}`;

  // \r returns cursor to start of line; \x1b[K clears any trailing characters
  process.stdout.write(`\r\x1b[K${status} [${bar}] ${time}`);
}

// Update progress bar every 100ms
const interval = setInterval(renderProgress, 100);

// Hide terminal cursor for a cleaner look
process.stdout.write('\x1b[?25l');

function cleanupAndExit() {
  clearInterval(interval);
  process.stdout.write('\x1b[?25h\n'); // restore cursor and add newline
  process.exit(0);
}

// Enable keypress events on stdin
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

// Listen for keys
process.stdin.on('keypress', (str, key) => {
  // Quit on 'q' or Ctrl+C
  if (str === 'q' || (key && key.ctrl && key.name === 'c')) {
    cleanupAndExit();
  }

  // Toggle play / pause on Space
  if (str === ' ' || (key && key.name === 'space')) {
    if (track.paused) {
      track.resume();
    } else {
      track.pause();
    }
    renderProgress(); // immediately update UI
  }
});

track.on('ended', () => {
  renderProgress();
  process.stdout.write('\nDone.\n');
  cleanupAndExit();
});
