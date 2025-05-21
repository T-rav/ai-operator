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
    // Log raw message data
    console.log('Received raw data length:', arrayBuffer.byteLength);
    
    // Try to log the first bytes for debugging
    try {
      const bytes = new Uint8Array(arrayBuffer);
      const firstBytes = Array.from(bytes.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log('First 20 bytes:', firstBytes);
    } catch (e) {
      console.error('Error logging bytes:', e);
    }
    
    try {
      // Try to decode using protobuf
      const parsedFrame = Frame.decode(new Uint8Array(arrayBuffer));
      console.log('Decoded frame successfully', parsedFrame);
      
      // Check for different possible structures - the server might be using a different format
      // First check for data field (our updated structure)
      let frameData = parsedFrame.data;
      
      // If not found, look for direct fields at the top level (original structure)
      if (!frameData || !frameData.oneofKind) {
        if (parsedFrame.audio) {
          frameData = { oneofKind: 'audio', audio: parsedFrame.audio };
        } else if (parsedFrame.text) {
          frameData = { oneofKind: 'text', text: parsedFrame.text };
        } else if (parsedFrame.transcription) {
          frameData = { oneofKind: 'transcription', transcription: parsedFrame.transcription };
        }
      }
      
      // Process frame based on type
      if (frameData && frameData.oneofKind) {
        console.log('Frame type:', frameData.oneofKind);
        
        // Handle transcription messages
        if (frameData.oneofKind === 'transcription') {
          const transcriptionFrame = frameData.transcription;
          console.log('Transcription received:', transcriptionFrame);
          
          // Display detailed information about the transcription frame
          const userId = transcriptionFrame.user_id || 'ai';
          
          console.log(`Transcription details - text: "${transcriptionFrame.text}", user_id: "${userId}"`);
          
          // Check if this is from the AI assistant
          const speaker = userId === 'ai' ? 'ai' : 'user';
          console.log(`Adding message to transcript as speaker: ${speaker}`);
          
          // Only add to transcript if there's actual text
          if (transcriptionFrame.text && transcriptionFrame.text.trim()) {
            if (speaker === 'ai') {
              // Always ensure the AI is in responding mode when we receive AI messages
              isAIResponding = true;
              
              // For AI, queue up messages to be displayed progressively
              queueAIMessage(transcriptionFrame.text, transcriptionFrame.timestamp || new Date().toISOString());
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
        if (frameData.oneofKind === 'audio') {
          console.log('Audio received');
          enqueueAudioFromProto(arrayBuffer);
        }
        
        // Handle text messages directly
        if (frameData.oneofKind === 'text') {
          console.log('Text received:', frameData.text.text);
        }
      } else {
        console.warn('Parsed frame has an unexpected structure', parsedFrame);
        // Try to play audio directly if we think it might be audio data
        if (arrayBuffer.byteLength > 100) {
          console.log('Attempting to play data as audio even though parsing failed');
          enqueueAudioFromProto(arrayBuffer);
        }
      }
    } catch (error) {
      console.error('Error decoding frame:', error);
      
      // Special handling for audio frames
      // If decoding fails but we have enough data for audio, try playing it directly
      if (arrayBuffer.byteLength > 100) {
        console.log('Decoding failed but attempting direct audio extraction');
        enqueueAudioFromProto(arrayBuffer);
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
      
      try {
        // Try both frame structures to match what server expects
        let frame;
        
        // First try with direct frame fields (no nested data field)
        // This matches the structure in frames.proto exactly
        try {
          frame = Frame.create({
            audio: {
              id: 1,
              name: "microphone",
              audio: pcmByteArray,
              sample_rate: SAMPLE_RATE,
              num_channels: NUM_CHANNELS
            }
          });
        } catch (e) {
          console.warn('Error creating direct frame structure, trying nested', e);
          
          // Fallback to nested structure
          frame = Frame.create({
            data: {
              oneofKind: 'audio',
              audio: {
                id: 1,
                name: "microphone",
                audio: pcmByteArray,
                sample_rate: SAMPLE_RATE,
                num_channels: NUM_CHANNELS
              }
            }
          });
        }
        
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
    // Try both structures to match what server expects
    let interruptFrame;
    
    // First try with direct frame fields (no nested data field)
    try {
      interruptFrame = Frame.create({
        text: {
          id: 2,
          name: "interruption",
          text: "interrupt"
        }
      });
    } catch (e) {
      console.warn('Error creating direct interrupt frame, trying nested', e);
      
      // Fallback to nested structure
      interruptFrame = Frame.create({
        data: {
          oneofKind: 'text',
          text: {
            id: 2,
            name: "interruption",
            text: "interrupt"
          }
        }
      });
    }
    
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