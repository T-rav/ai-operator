// Audio configuration constants
const SAMPLE_RATE = 16000;
const NUM_CHANNELS = 1;
const PLAY_TIME_RESET_THRESHOLD_MS = 1.0;

// The protobuf type
let Frame = null;

// Speech detection configuration
const SPEECH_THRESHOLD = 0.03;
const REQUIRED_CONSECUTIVE_FRAMES = 3;

// Initialize protobuf
function initProtobuf() {
  return new Promise((resolve, reject) => {
    console.log('Initializing Protocol Buffers...');
    protobuf.load('frames.proto', (err, root) => {
      if (err) {
        console.error('Failed to load protobuf definition:', err);
        reject(err);
        return;
      }
      
      try {
        Frame = root.lookupType('pipecat.Frame');
        console.log('Protocol Buffers initialized successfully');
        // Directly update the reference in the exported object
        AI_CONFIG.Frame = Frame;
        resolve(Frame);
      } catch (error) {
        console.error('Error looking up Frame type:', error);
        reject(error);
      }
    });
  });
}

// Export variables and functions
window.AI_CONFIG = {
  SAMPLE_RATE,
  NUM_CHANNELS,
  PLAY_TIME_RESET_THRESHOLD_MS,
  SPEECH_THRESHOLD,
  REQUIRED_CONSECUTIVE_FRAMES,
  Frame,
  initProtobuf
}; 