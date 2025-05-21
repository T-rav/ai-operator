// WebSocket functions

// Import needed functions from audio-processing.js if they're not already in global scope
// This is handled automatically if you're using proper ES modules

function initWebSocket() {
  console.log("Initializing WebSocket connection to ws://localhost:8765");
  ws = new WebSocket('ws://localhost:8765');
  // This is so `event.data` is already an ArrayBuffer.
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', handleWebSocketOpen);
  ws.addEventListener('message', handleWebSocketMessage);
  ws.addEventListener('close', (event) => {
    console.log('WebSocket connection closed. Code:', event.code, 'Reason:', event.reason);
    stopAudio(false);
  });
  ws.addEventListener('error', (event) => {
    console.error('WebSocket error:', event);
    // Try reconnecting on error
    setTimeout(() => {
      if (isPlaying) {
        console.log('Attempting to reconnect WebSocket...');
        initWebSocket();
      }
    }, 3000);
  });
}

function handleWebSocketMessage(event) {
  const arrayBuffer = event.data;
  if (isPlaying) {
    try {
      // Log raw message for debugging
      console.log('Received raw data length:', arrayBuffer.byteLength);
      
      // Create a new Uint8Array directly from the arrayBuffer
      const parsedFrame = Frame.decode(new Uint8Array(arrayBuffer));
      
      // Check what type of frame was received using new structure
      let frameType = null;
      if (!parsedFrame.data) {
        console.error('No data field in frame:', parsedFrame);
        return;
      }
      
      frameType = parsedFrame.data.oneofKind || "unknown";
      
      // Only log non-audio frames
      if (frameType !== "audio") {
        console.log('Received frame type:', frameType);
        // Log entire frame for debugging
        console.log('Complete frame data:', parsedFrame);
      }

      // Handle transcription messages
      if (frameType === "transcription") {
        const transcriptionFrame = parsedFrame.data.transcription;
        console.log('Transcription received:', transcriptionFrame);
        
        const userId = transcriptionFrame.user_id || 'ai';
        
        console.log(`Transcription details - text: "${transcriptionFrame.text}", user_id: "${userId}", timestamp: "${transcriptionFrame.timestamp}"`);
        
        // Check if this is from the AI assistant
        const speaker = userId === 'ai' ? 'ai' : 'user';
        console.log(`Adding message to transcript as speaker: ${speaker}`);
        
        // Only add to transcript if there's actual text
        if (transcriptionFrame.text && transcriptionFrame.text.trim()) {
          if (speaker === 'ai') {
            // Always ensure the AI is in responding mode when we receive AI messages
            isAIResponding = true;
            
            // For AI, queue up messages to be displayed progressively
            queueAIMessage(transcriptionFrame.text, transcriptionFrame.timestamp);
          } else {
            // For user speech, immediately display the message
            addMessageToTranscript(transcriptionFrame.text, speaker);
            
            // Update user speaking timestamp to recognize new AI responses
            lastUserSpeakTimestamp = Date.now();
            
            // Reset AI message tracking for next AI response
            resetAIMessageTracking();
          }
        }
      }
      
      // Handle audio messages
      if (frameType === "audio") {
        const audioFrame = parsedFrame.data.audio;
        console.log('Audio received, format:', typeof audioFrame.audio, 
                    'length:', audioFrame.audio ? audioFrame.audio.length : 'unknown');
        enqueueAudioFromProto(arrayBuffer);
      }
      
      // Handle text messages directly
      if (frameType === "text") {
        const textFrame = parsedFrame.data.text;
        console.log('Text received:', textFrame.text);
      }
    } catch (error) {
      console.error('Error decoding frame:', error);
      // Log the raw data length to help diagnose issues
      console.log('Raw data length:', event.data.byteLength);
      
      // Try to log the first few bytes for debugging purposes
      try {
        const bytes = new Uint8Array(event.data);
        const firstBytes = Array.from(bytes.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.log('First 20 bytes:', firstBytes);
      } catch (e) {
        console.error('Error logging bytes:', e);
      }
    }
  }
}

function handleWebSocketOpen(event) {
  console.log('WebSocket connection established.', event);

  navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: SAMPLE_RATE,
      channelCount: NUM_CHANNELS,
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    }
  }).then((stream) => {
    microphoneStream = stream;
    
    // Create media stream source
    source = audioContext.createMediaStreamSource(stream);
    
    // Set up visualizer for input
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    drawVisualizer();

    // Create ScriptProcessor for audio processing
    scriptProcessor = audioContext.createScriptProcessor(512, 1, 1);
    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    // Variables for better speech detection
    let consecutiveFramesAboveThreshold = 0;
    const requiredConsecutiveFrames = 3; // Require multiple frames above threshold before triggering
    
    scriptProcessor.onaudioprocess = (event) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const audioData = event.inputBuffer.getChannelData(0);
      
      // Process the audio to send to server
      const pcmS16Array = convertFloat32ToS16PCM(audioData);
      const pcmByteArray = new Uint8Array(pcmS16Array.buffer);
      // Convert to an array of numbers for protobuf
      const audioBytes = Array.from(pcmByteArray);
      
      try {
        // Create Frame matching frames.proto definition
        const frame = Frame.create({
          data: {
            oneofKind: "audio",
            audio: {
              id: 1,
              name: "microphone",
              audio: audioBytes,
              sample_rate: SAMPLE_RATE,
              num_channels: NUM_CHANNELS
            }
          }
        });
        
        // Encode and send the frame
        const encodedFrame = Frame.encode(frame).finish();
        ws.send(encodedFrame);
      } catch (error) {
        console.error('Error encoding audio frame:', error);
      }
      
      // Check for speech with improved detection
      const rms = calculateRMS(audioData);
      const speechThreshold = 0.03; // Increased threshold to reduce false positives
      
      if (rms > speechThreshold) {
        consecutiveFramesAboveThreshold++;
        
        // Only consider it speech if we've had multiple frames above threshold
        if (!isSpeaking && consecutiveFramesAboveThreshold >= requiredConsecutiveFrames) {
          isSpeaking = true;
          addMessageToTranscript('User speaking...', 'user');
          console.log('Speech detected, RMS:', rms);
          
          // Check if AI is currently responding and send interruption if so
          if (isAIResponding) {
            sendInterruptionSignal();
          }
        }
        
        if (silenceTimeout) {
          clearTimeout(silenceTimeout);
        }
        
        silenceTimeout = setTimeout(() => {
          isSpeaking = false;
          console.log('Speech ended, silence detected');
        }, 1500); // Longer timeout (1.5 seconds) for more stable detection
      } else {
        // Reset consecutive frames counter when below threshold
        consecutiveFramesAboveThreshold = 0;
      }
    };
  }).catch((error) => console.error('Error accessing microphone:', error));
}

// Send interruption signal to the server to stop AI response
function sendInterruptionSignal() {
  if (!ws || !isAIResponding) return;
  
  // Check if AI has already finished speaking
  if (activeAudioSources.length === 0 && !isDisplayingMessage) {
    // AI has finished speaking, just mark as not responding without showing interruption
    isAIResponding = false;
    return;
  }
  
  console.log('Sending interruption signal to stop AI response');
  
  try {
    // Create interruption frame matching frames.proto
    const interruptFrame = Frame.create({
      data: {
        oneofKind: "start_interruption",
        start_interruption: {
          user_id: "user",
          timestamp: new Date().toISOString()
        }
      }
    });
    
    // Encode and send the interruption signal
    const encodedInterrupt = Frame.encode(interruptFrame).finish();
    ws.send(encodedInterrupt);
    
    // Stop any current audio playback
    stopAllAIAudio();
    
    // Stop the transcription from continuing
    stopAITranscription();
    
    // Reset AI response state
    isAIResponding = false;
    
    // Add system message indicating interruption
    addMessageToTranscript('User interrupted', 'system');
  } catch (error) {
    console.error('Error sending interruption signal:', error);
  }
}

// Stop any currently playing AI audio
function stopAIAudio() {
  // Reset play time to stop scheduling new audio
  playTime = audioContext.currentTime;
  
  // Any additional audio stopping logic can be added here
  
  console.log('AI audio playback interrupted');
} 