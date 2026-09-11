import audio from 'audio';
import readline from 'node:readline';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node player.js <file.mp3>');
  process.exit(1);
}

const track = await audio(file);

track.play();
console.log(`Playing: ${file}`);
console.log('Controls: [Space] Play/Pause | [q] Quit');

// Enable keypress events on stdin
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

// Listen for keys
process.stdin.on('keypress', (str, key) => {
  // Quit on 'q' or Ctrl+C
  if (str === 'q' || (key && key.ctrl && key.name === 'c')) {
    process.exit(0);
  }

  // Toggle play/pause on Space
  if (str === ' ' || (key && key.name === 'space')) {
    if (track.paused) {
      track.resume();
      console.log('▶ Resumed');
    } else {
      track.pause();
      console.log('⏸ Paused');
    }
  }
});

track.on('ended', () => {
  process.exit(0);
});
