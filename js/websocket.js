// WebSocket connection
let ws = null;

// Initialize WebSocket connection
function initWebSocket() {
  // Make sure Frame is initialized before proceeding
  if (!AI_CONFIG.Frame) {
    console.error('Frame object not initialized. Please wait for protobuf initialization to complete.');
    return;
  }

  ws = new WebSocket('ws://localhost:8765');
  // This is so `event.data` is already an ArrayBuffer.
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', handleWebSocketOpen);
  ws.addEventListener('message', handleWebSocketMessage);
  ws.addEventListener('close', (event) => {
    console.log('WebSocket connection closed.', event.code, event.reason);
    AI_MAIN.stopAudio(false);
  });
  ws.addEventListener('error', (event) => console.error('WebSocket error:', event));
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(event) {
  const arrayBuffer = event.data;
  if (AI_STATE.isPlaying && AI_CONFIG.Frame) {
    try {
      const parsedFrame = AI_CONFIG.Frame.decode(new Uint8Array(arrayBuffer));
      console.log('Received frame:', parsedFrame); // Debug log

      // Handle transcription messages
      if (parsedFrame?.transcription) {
        console.log('Transcription:', parsedFrame.transcription.text); // Debug log
        AI_TRANSCRIPT.addMessageToTranscript(parsedFrame.transcription.text, 'user');
      }
      
      // Handle audio messages
      if (parsedFrame?.audio) {
        AI_AUDIO.enqueueAudioFromProto(arrayBuffer);
      }
      
      // Handle bot interruption frame
      if (parsedFrame?.botInterruption) {
        console.log('Bot interruption received, stopping AI audio');
        handleBotInterruption();
      }
      
      // Handle end frame
      if (parsedFrame?.end) {
        console.log('End frame received');
        AI_MAIN.stopAudio(true);
      }
    } catch (error) {
      console.error('Error decoding message:', error);
    }
  }
}

// Handle WebSocket open event
function handleWebSocketOpen(event) {
  console.log('WebSocket connection established.', event);

  navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: AI_CONFIG.SAMPLE_RATE,
      channelCount: AI_CONFIG.NUM_CHANNELS,
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    }
  }).then((stream) => {
    AI_AUDIO.microphoneStream = stream;
    
    // Create script processor for audio processing
    AI_AUDIO.scriptProcessor = AI_AUDIO.audioContext.createScriptProcessor(512, 1, 1);
    AI_AUDIO.source = AI_AUDIO.audioContext.createMediaStreamSource(stream);
    
    // Set up visualizer for input
    AI_AUDIO.analyser = AI_AUDIO.audioContext.createAnalyser();
    AI_AUDIO.analyser.fftSize = 2048;
    AI_AUDIO.source.connect(AI_AUDIO.analyser);
    AI_AUDIO.dataArray = new Uint8Array(AI_AUDIO.analyser.frequencyBinCount);
    AI_VISUALIZER.drawVisualizer();

    // Connect input to script processor and destination
    AI_AUDIO.source.connect(AI_AUDIO.scriptProcessor);
    AI_AUDIO.scriptProcessor.connect(AI_AUDIO.audioContext.destination);

    // Set up audio processing
    setupAudioProcessing();
  }).catch((error) => console.error('Error accessing microphone:', error));
}

// Set up audio processing with speech detection
function setupAudioProcessing() {
  // Variables for better speech detection
  let consecutiveFramesAboveThreshold = 0;
  
  AI_AUDIO.scriptProcessor.onaudioprocess = (event) => {
    if (!ws || !AI_CONFIG.Frame) {
      return;
    }

    const audioData = event.inputBuffer.getChannelData(0);
    const pcmS16Array = AI_AUDIO.convertFloat32ToS16PCM(audioData);
    const pcmByteArray = new Uint8Array(pcmS16Array.buffer);
    
    try {
      const frame = AI_CONFIG.Frame.create({
        audio: {
          audio: Array.from(pcmByteArray),
          sampleRate: AI_CONFIG.SAMPLE_RATE,
          numChannels: AI_CONFIG.NUM_CHANNELS
        }
      });
      const encodedFrame = new Uint8Array(AI_CONFIG.Frame.encode(frame).finish());
      ws.send(encodedFrame);
    } catch (error) {
      console.error('Error creating or encoding frame:', error);
      return;
    }

    // Check for speech with improved detection
    const rms = AI_AUDIO.calculateRMS(audioData);
    
    if (rms > AI_CONFIG.SPEECH_THRESHOLD) {
      consecutiveFramesAboveThreshold++;
      
      // Only consider it speech if we've had multiple frames above threshold
      if (!AI_STATE.isSpeaking && consecutiveFramesAboveThreshold >= AI_CONFIG.REQUIRED_CONSECUTIVE_FRAMES) {
        AI_STATE.isSpeaking = true;
        AI_TRANSCRIPT.addMessageToTranscript('User speaking...', 'user');
        console.log('Speech detected, RMS:', rms);
        
        // Check if AI is currently responding and send interruption if so
        if (AI_STATE.isAIResponding) {
          sendInterruptionSignal();
        }
      }
      
      if (AI_STATE.silenceTimeout) {
        clearTimeout(AI_STATE.silenceTimeout);
      }
      
      AI_STATE.silenceTimeout = setTimeout(() => {
        AI_STATE.isSpeaking = false;
        console.log('Speech ended, silence detected');
      }, 1500); // Longer timeout (1.5 seconds) for more stable detection
    } else {
      // Reset consecutive frames counter when below threshold
      consecutiveFramesAboveThreshold = 0;
    }
  };
}

// Send interruption signal to the server to stop AI response
function sendInterruptionSignal() {
  if (!ws || !AI_STATE.isAIResponding || !AI_CONFIG.Frame) return;
  
  console.log('Sending interruption signal to stop AI response');
  
  try {
    // Set interruption flag to prevent new audio chunks from being played
    AI_STATE.isBeingInterrupted = true;
    
    // Send an interruption frame to the server
    const interruptFrame = AI_CONFIG.Frame.create({
      botInterruption: {
        id: Date.now()
      }
    });
    
    // Encode and send the interruption signal
    const encodedInterrupt = new Uint8Array(AI_CONFIG.Frame.encode(interruptFrame).finish());
    ws.send(encodedInterrupt);
    
    // Stop all currently playing AI audio immediately
    AI_AUDIO.stopAllAIAudio();
    
    // Reset AI response state
    AI_STATE.isAIResponding = false;
    
    // Add system message indicating interruption
    AI_TRANSCRIPT.addMessageToTranscript('User interrupted AI', 'system');
    
    // Reset the interruption flag after a short delay to allow new audio
    setTimeout(() => {
      AI_STATE.isBeingInterrupted = false;
      console.log('User interruption state reset, ready for new audio');
    }, 500); // 500ms delay should be enough to process the interruption
  } catch (error) {
    console.error('Error sending interruption signal:', error);
  }
}

// Handle bot interruption
function handleBotInterruption() {
  // Set interruption flag to prevent new audio chunks from being played
  AI_STATE.isBeingInterrupted = true;
  
  // Stop all currently playing AI audio
  AI_AUDIO.stopAllAIAudio();
  
  // Reset AI response state
  AI_STATE.isAIResponding = false;
  
  // Add system message indicating interruption
  AI_TRANSCRIPT.addMessageToTranscript('AI was interrupted', 'system');
  
  // Reset the interruption flag after a short delay to allow new audio
  setTimeout(() => {
    AI_STATE.isBeingInterrupted = false;
    console.log('Interruption state reset, ready for new audio');
  }, 500); // 500ms delay should be enough to process the interruption
}

// Close WebSocket connection
function closeWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }
}

// Export WebSocket functionality
window.AI_WEBSOCKET = {
  initWebSocket,
  closeWebSocket,
  sendInterruptionSignal,
  handleBotInterruption,
  get ws() { return ws; }
}; 