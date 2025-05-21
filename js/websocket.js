// WebSocket functions

function initWebSocket() {
  try {
    console.log('Initializing WebSocket connection to ws://localhost:8765');
    ws = new WebSocket('ws://localhost:8765');
    // This is so `event.data` is already an ArrayBuffer.
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', handleWebSocketOpen);
    ws.addEventListener('message', handleWebSocketMessage);
    ws.addEventListener('close', (event) => {
      console.log('WebSocket connection closed.', event.code, event.reason);
      console.log('WebSocket close event details:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      });
      stopAudio(false);
    });
    ws.addEventListener('error', (event) => {
      console.error('WebSocket error occurred:', event);
      // Try to get additional info about the error
      if (event.error) {
        console.error('Error details:', event.error);
      }
      if (ws) {
        console.log('WebSocket state at error time:', ws.readyState);
      }
    });
    
    // Log WebSocket state after initialization
    console.log('WebSocket created, readyState:', ws.readyState, '(0 = CONNECTING)');
  } catch (error) {
    console.error('Error initializing WebSocket:', error);
  }
}

function handleWebSocketMessage(event) {
  const arrayBuffer = event.data;
  if (isPlaying) {
    try {
      // Log received raw data for debugging
      if (!window.receivedFirstMessage) {
        console.log('First WebSocket message received:');
        console.log('- Data type:', arrayBuffer.constructor.name);
        console.log('- Data length:', arrayBuffer.byteLength, 'bytes');
        if (arrayBuffer.byteLength > 0) {
          const dataView = new Uint8Array(arrayBuffer);
          console.log('- First 16 bytes:', Array.from(dataView.slice(0, 16)));
        }
        window.receivedFirstMessage = true;
      }
      
      const parsedFrame = Frame.decode(new Uint8Array(arrayBuffer));
      
      // Check what type of frame was received
      let frameType = null;
      if (parsedFrame.transcription) frameType = "transcription";
      else if (parsedFrame.audio) frameType = "audio";
      else if (parsedFrame.text) frameType = "text";
      else if (parsedFrame.message) frameType = "message";
      else frameType = "unknown";
      
      // Only log non-audio frames
      if (frameType !== "audio") {
        console.log('Received frame type:', frameType);
        // Log entire frame for debugging
        console.log('Complete frame data:', JSON.stringify(parsedFrame));
      }

      // Handle transcription messages
      if (parsedFrame.transcription) {
        console.log('Transcription received:', JSON.stringify(parsedFrame.transcription));
        
        // Display detailed information about the transcription frame
        const transcriptionFrame = parsedFrame.transcription;
        
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
      if (parsedFrame.audio) {
        enqueueAudioFromProto(arrayBuffer);
      }
      
      // Handle text messages directly
      if (parsedFrame.text) {
        console.log('Text received:', parsedFrame.text);
      }
    } catch (error) {
      console.error('Error decoding frame:', error);
      // Log the raw data length to help diagnose issues
      console.log('Raw data length:', event.data.byteLength);
    }
  }
}

function handleWebSocketOpen(event) {
  console.log('WebSocket connection established.', event);
  console.log('WebSocket readyState:', ws.readyState, '(1 = OPEN)');

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
    // 512 is closest thing to 200ms.
    scriptProcessor = audioContext.createScriptProcessor(512, 1, 1);
    source = audioContext.createMediaStreamSource(stream);
    
    // Set up visualizer for input
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    drawVisualizer();

    // Connect input to script processor and destination
    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    // Variables for better speech detection
    let consecutiveFramesAboveThreshold = 0;
    const requiredConsecutiveFrames = 3; // Require multiple frames above threshold before triggering
    
    scriptProcessor.onaudioprocess = (event) => {
      if (!ws) {
        return;
      }

      const audioData = event.inputBuffer.getChannelData(0);
      const pcmS16Array = convertFloat32ToS16PCM(audioData);
      const pcmByteArray = new Uint8Array(pcmS16Array.buffer);
      
      try {
        // Log first frame data details for debugging
        if (!window.firstFrameSent) {
          console.log('Creating first audio frame:');
          console.log('- PCM array type:', pcmS16Array.constructor.name);
          console.log('- PCM byte array type:', pcmByteArray.constructor.name);
          console.log('- Byte array length:', pcmByteArray.length);
          console.log('- Sample rate:', SAMPLE_RATE);
          console.log('- Num channels:', NUM_CHANNELS);
          window.firstFrameSent = true;
        }
        
        // Create frame matching server's expected format
        const frame = {
          // Must match server's oneof field name 'frame'
          frame: {
            // Use 'audio' as the field choice in the oneof
            oneofKind: "audio", 
            audio: {
              id: 0,
              // CRITICAL: Match the exact type name expected by server
              name: "AudioRawFrame",
              audio: pcmByteArray,
              sample_rate: SAMPLE_RATE, // Use snake_case
              num_channels: NUM_CHANNELS, // Use snake_case
              pts: 0 // Add missing pts field
            }
          }
        };
        
        // Log frame structure info for first frame
        if (window.firstFrameSentComplete === undefined) {
          console.log('First frame structure:', JSON.stringify(frame, (key, value) => {
            if (key === 'audio' && value && value.audio) {
              return `[Uint8Array: ${value.audio.length} bytes]`;
            }
            return value;
          }));
          window.firstFrameSentComplete = true;
        }
        
        // Create the protobuf message with explicit creation
        const protoFrame = Frame.create(frame);
        
        // Encode with explicit finish() to ensure proper formatting
        const encodedFrame = Frame.encode(protoFrame).finish();
        
        // Log encoded frame for first frame
        if (window.firstFrameEncoded === undefined) {
          console.log('First encoded frame:');
          console.log('- Type:', encodedFrame.constructor.name);
          console.log('- Length:', encodedFrame.byteLength, 'bytes');
          console.log('- First 16 bytes:', Array.from(encodedFrame.slice(0, 16)));
          window.firstFrameEncoded = true;
        }
        
        // Convert to Uint8Array for sending
        ws.send(encodedFrame);
      } catch (error) {
        console.error('Error creating/sending audio frame:', error);
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
    // Create interruption frame with simpler object structure
    const interruptData = {
      start_interruption: {
        user_id: 'user',
        timestamp: Date.now().toString()
      }
    };
    
    // Create the protobuf message with explicit creation
    const interruptFrame = Frame.create(interruptData);
    
    // Encode with explicit finish() to ensure proper formatting
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