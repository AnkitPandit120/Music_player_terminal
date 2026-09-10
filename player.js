import audio from 'audio';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node player.js <file.mp3>');
  process.exit(1);
}

// Load audio file
const track = await audio(file);

// Play audio
track.play();
console.log(`Playing: ${file}`);

// Exit when finished
track.on('ended', () => {
  process.exit(0);
});
