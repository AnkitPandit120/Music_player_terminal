import audio from 'audio';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

// Get audio files from command line arguments or scan current folder
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

let currentIndex = 0;
let track = null;
let isChanging = false;

console.log(`Loaded ${files.length} track(s)`);
console.log('Controls: [Space] Play/Pause | [→] Next | [←] Prev | [q] Quit\n');

// Format seconds into MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Render status, current track, progress bar, and duration on one line
function renderProgress() {
  if (!track || isChanging) return;

  const current = track.currentTime || 0;
  const total = track.duration || 1;
  const progress = Math.min(1, Math.max(0, current / total));

  const barLength = 20;
  const filled = Math.round(barLength * progress);
  const empty = barLength - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  const status = track.paused ? '⏸ PAUSED ' : '▶ PLAYING';
  const time = `${formatTime(current)} / ${formatTime(total)}`;
  const trackInfo = `[${currentIndex + 1}/${files.length}] ${path.basename(files[currentIndex])}`;

  // \r returns cursor to start of line, \x1b[K clears trailing text
  process.stdout.write(`\r\x1b[K${trackInfo} | ${status} [${bar}] ${time}`);
}

// Switch and play a track by index (with loop wrapping)
async function switchTrack(index) {
  if (isChanging) return;
  isChanging = true;

  try {
    if (track) {
      track.stop();
    }

    currentIndex = index;
    process.stdout.write(`\r\x1b[KLoading [${currentIndex + 1}/${files.length}] ${path.basename(files[currentIndex])}...`);

    track = await audio(files[currentIndex]);
    track.play();

    // When the track finishes, automatically play the next track (looping)
    track.on('ended', () => {
      switchTrack((currentIndex + 1) % files.length);
    });
  } catch (err) {
    process.stdout.write(`\r\x1b[KError playing ${files[currentIndex]}: ${err.message}\n`);
  } finally {
    isChanging = false;
    renderProgress();
  }
}

// Update progress bar every 100ms
const interval = setInterval(renderProgress, 100);

// Hide cursor for clean terminal output
process.stdout.write('\x1b[?25l');

function cleanupAndExit() {
  clearInterval(interval);
  if (track) track.stop();
  process.stdout.write('\x1b[?25h\n'); // restore cursor
  process.exit(0);
}

// Enable raw mode for instant keypresses
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
    if (track) {
      if (track.paused) {
        track.resume();
      } else {
        track.pause();
      }
      renderProgress();
    }
  }

  // Next track on Right arrow (loops: 4 -> 1)
  if (key && key.name === 'right') {
    const nextIndex = (currentIndex + 1) % files.length;
    switchTrack(nextIndex);
  }

  // Previous track on Left arrow (loops: 1 -> 4)
  if (key && key.name === 'left') {
    const prevIndex = (currentIndex - 1 + files.length) % files.length;
    switchTrack(prevIndex);
  }
});

// Start playing the first track
switchTrack(0);
