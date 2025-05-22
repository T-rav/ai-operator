// Global audio variables
let audioContext = null;
let source = null;
let microphoneStream = null;
let scriptProcessor = null;
let playTime = 0;
let lastMessageTime = 0;
let analyser = null;
let dataArray = null;
let activeAudioSources = [];
let animationFrame = null;

// Initialize audio context
function initAudio() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)({
    latencyHint: 'interactive',
    sampleRate: AI_CONFIG.SAMPLE_RATE
  });
}

// Convert Float32Array to Int16Array for PCM
function convertFloat32ToS16PCM(float32Array) {
  let int16Array = new Int16Array(float32Array.length);

  for (let i = 0; i < float32Array.length; i++) {
    let clampedValue = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = clampedValue < 0 ? clampedValue * 32768 : clampedValue * 32767;
  }
  return int16Array;
}

// Calculate RMS (Root Mean Square) for audio level
function calculateRMS(audioData) {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  return Math.sqrt(sum / audioData.length);
}

// Process incoming audio from server
function enqueueAudioFromProto(arrayBuffer) {
  if (!AI_CONFIG.Frame) {
    console.error('Frame object not initialized for audio decoding');
    return false;
  }

  try {
    const parsedFrame = AI_CONFIG.Frame.decode(new Uint8Array(arrayBuffer));
    if (!parsedFrame?.audio) {
      return false;
    }
  
    // Reset play time if it's been a while we haven't played anything
    const diffTime = audioContext.currentTime - lastMessageTime;
    if ((playTime == 0) || (diffTime > AI_CONFIG.PLAY_TIME_RESET_THRESHOLD_MS)) {
      playTime = audioContext.currentTime;
    }
    lastMessageTime = audioContext.currentTime;
  
    // Extract audio data from the protobuf message
    const audioVector = Array.from(parsedFrame.audio.audio);
    const audioArray = new Uint8Array(audioVector);
  
    audioContext.decodeAudioData(audioArray.buffer, function(buffer) {
      const source = new AudioBufferSourceNode(audioContext);
      source.buffer = buffer;
      
      // Connect output to analyzer and destination
      source.connect(analyser);
      source.connect(audioContext.destination);
      
      // Add to active sources for potential stopping
      activeAudioSources.push(source);
      
      // Clean up when finished
      source.onended = function() {
        // Remove from active sources array
        const index = activeAudioSources.indexOf(source);
        if (index > -1) {
          activeAudioSources.splice(index, 1);
        }
      };
      
      source.start(playTime);
      playTime = playTime + buffer.duration;
  
      // Add AI message only when we first start receiving audio
      if (!AI_STATE.isAIResponding) {
        AI_STATE.isAIResponding = true;
        AI_TRANSCRIPT.addMessageToTranscript('AI response...', 'ai');
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error processing audio frame:', error);
    return false;
  }
}

// Stop all currently playing AI audio
function stopAllAIAudio() {
  // Stop all currently playing audio sources
  for (let source of activeAudioSources) {
    try {
      source.stop();
    } catch (e) {
      // Ignore errors from sources that might have already stopped
    }
  }
  
  // Clear the array
  activeAudioSources = [];
  
  // Reset play time to stop scheduling new audio
  playTime = audioContext.currentTime;
  console.log('AI audio playback interrupted');
}

// Setup visualizer
function setupVisualizer(canvas) {
  const visualizerCtx = canvas.getContext('2d');
  
  // Set canvas size
  function resizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = 100;
  }
  
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  
  // Visualizer animation function
  function drawVisualizer() {
    if (!analyser || !AI_STATE.isPlaying) return;

    animationFrame = requestAnimationFrame(drawVisualizer);
    
    // Clear canvas
    visualizerCtx.fillStyle = '#f5f7fa';
    visualizerCtx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw waveform (blue)
    analyser.getByteTimeDomainData(dataArray);
    visualizerCtx.lineWidth = 2;
    visualizerCtx.strokeStyle = '#3498db';
    visualizerCtx.beginPath();
    
    // Draw waveform
    const sliceWidth = canvas.width / dataArray.length;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
      const v = dataArray[i] / 128.0;
      const y = v * canvas.height / 2;

      if (i === 0) {
        visualizerCtx.moveTo(x, y);
      } else {
        visualizerCtx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    visualizerCtx.lineTo(canvas.width, canvas.height / 2);
    visualizerCtx.stroke();
  }
  
  return { resizeCanvas, drawVisualizer };
}

// Clean up audio resources
function cleanupAudio(closeWebsocket) {
  playTime = 0;
  
  if (scriptProcessor) {
    scriptProcessor.disconnect();
  }
  if (source) {
    source.disconnect();
  }
  if (analyser) {
    analyser.disconnect();
  }
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }
  
  // Stop any playing audio
  stopAllAIAudio();
}

// Export the audio functionality
window.AI_AUDIO = {
  initAudio,
  convertFloat32ToS16PCM,
  calculateRMS,
  enqueueAudioFromProto,
  stopAllAIAudio,
  setupVisualizer,
  cleanupAudio,
  // Variables that need to be accessed by other modules
  get audioContext() { return audioContext; },
  get source() { return source; },
  set source(value) { source = value; },
  get analyser() { return analyser; },
  set analyser(value) { analyser = value; },
  get dataArray() { return dataArray; },
  set dataArray(value) { dataArray = value; },
  get activeAudioSources() { return activeAudioSources; },
  get animationFrame() { return animationFrame; },
  set animationFrame(value) { animationFrame = value; },
  get scriptProcessor() { return scriptProcessor; },
  set scriptProcessor(value) { scriptProcessor = value; },
  get microphoneStream() { return microphoneStream; },
  set microphoneStream(value) { microphoneStream = value; }
}; 