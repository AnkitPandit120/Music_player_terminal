import audio from 'audio';

const file = process.argv[2];
if (!file) {
  console.log('Usage: node player.js <path-to-audio-file>');
  process.exit(1);
}

const track = audio(file);
track.play();
console.log(`▶ Playing: ${file}`);
