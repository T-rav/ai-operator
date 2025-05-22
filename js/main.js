// Main control buttons
let startBtn = document.getElementById('startAudioBtn');
let stopBtn = document.getElementById('stopAudioBtn');
let progressText = document.getElementById('progressText');

// Initialize the application
async function initialize() {
  // Disable buttons initially
  startBtn.disabled = true;
  stopBtn.disabled = true;
  
  // Show loading state
  progressText.textContent = 'Loading...';
  
  try {
    // Initialize modules
    if (window.AI_VISUALIZER) {
      AI_VISUALIZER.initVisualizer();
    } else {
      console.warn('AI_VISUALIZER not available');
    }
    
    // Load protobuf definition
    if (window.AI_CONFIG) {
      await AI_CONFIG.initProtobuf();
    } else {
      console.warn('AI_CONFIG not available');
    }
    
    // Add event listeners to buttons
    setupEventListeners();
    
    // Enable start button when everything is loaded
    startBtn.disabled = false;
    progressText.textContent = 'We are ready! Make sure to run the server and then click `Start Audio`.';
  } catch (error) {
    console.error('Initialization error:', error);
    progressText.textContent = 'Error initializing the application. Please check the console for details.';
  }
}

// Start audio handler
function startAudioBtnHandler() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('getUserMedia is not supported in your browser.');
    return;
  }

  // Check if Frame is initialized
  if (!AI_CONFIG.Frame) {
    alert('Protocol Buffers not initialized yet. Please wait a moment and try again.');
    return;
  }

  startBtn.disabled = true;
  stopBtn.disabled = false;

  // Initialize audio context
  if (window.AI_AUDIO) {
    AI_AUDIO.initAudio();
  }
  
  // Set playing state
  if (window.AI_STATE) {
    AI_STATE.isPlaying = true;
  }

  // Connect to WebSocket server
  if (window.AI_WEBSOCKET) {
    AI_WEBSOCKET.initWebSocket();
  }
}

// Stop audio handler
function stopAudioBtnHandler() {
  stopAudio(true);
}

// Stop audio and clean up resources
function stopAudio(closeWebsocket) {
  // Update state
  if (window.AI_STATE) {
    AI_STATE.isPlaying = false;
    
    // Clear any timeouts
    if (AI_STATE.silenceTimeout) {
      clearTimeout(AI_STATE.silenceTimeout);
    }
    
    // Reset AI response state
    AI_STATE.isAIResponding = false;
  }
  
  startBtn.disabled = false;
  stopBtn.disabled = true;

  // Close WebSocket if requested
  if (closeWebsocket && window.AI_WEBSOCKET) {
    AI_WEBSOCKET.closeWebSocket();
  }
  
  // Clean up audio resources
  if (window.AI_AUDIO) {
    AI_AUDIO.cleanupAudio();
  }
  
  // Stop visualizer
  if (window.AI_VISUALIZER) {
    AI_VISUALIZER.stopVisualizer();
  }
}

// Add event listeners to buttons
function setupEventListeners() {
  startBtn.addEventListener('click', startAudioBtnHandler);
  stopBtn.addEventListener('click', stopAudioBtnHandler);
}

// Export main functions
window.AI_MAIN = {
  initialize,
  startAudioBtnHandler,
  stopAudioBtnHandler,
  stopAudio
}; 