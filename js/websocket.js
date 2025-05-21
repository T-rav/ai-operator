// WebSocket functions

function initWebSocket() {
  try {
    console.log('Initializing WebSocket connection to ws://localhost:8765');
    ws = new WebSocket('ws://localhost:8765');
    // This is so `event.data` is already an ArrayBuffer.
    ws.binaryType = 'arraybuffer';

    // Set a reasonable timeout for detecting connection issues
    let connectionTimeout = setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket connection timed out');
        // Clean up the pending connection
        ws.close();
        ws = null;
        // Reset UI to allow new connection attempt
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        alert('Connection to server failed. Please try again.');
      }
    }, 5000);

    ws.addEventListener('open', (event) => {
      // Clear timeout as connection succeeded
      clearTimeout(connectionTimeout);
      handleWebSocketOpen(event);
    });
    ws.addEventListener('message', handleWebSocketMessage);
    ws.addEventListener('close', (event) => {
      // Clear timeout if it's still active
      clearTimeout(connectionTimeout);
      console.log('WebSocket connection closed.', event.code, event.reason);
      console.log('WebSocket close event details:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      });
      stopAudio(true);
    });
    ws.addEventListener('error', (event) => {
      console.error('WebSocket error occurred:', event);
      // Try to get additional info about the error
      if (event.error) {
        console.error('Error details:', event.error);
      }
      if (ws) {
        console.log('WebSocket state at error time:', ws.readyState);
        
        // If we get an error during connection, clean up
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.CLOSING) {
          console.log('WebSocket errored during connection/closing, stopping audio');
          stopAudio(true);
        }
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
        console.log(`Received audio frame, passing to player. Length: ${parsedFrame.audio.audio ? parsedFrame.audio.audio.length : 0} bytes`);
        const audioPlayed = enqueueAudioFromProto(arrayBuffer);
        if (!audioPlayed) {
          console.warn('Failed to play audio from frame');
        }
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
  }).then(async (stream) => {
    microphoneStream = stream;
    source = audioContext.createMediaStreamSource(stream);
    
    // Set up visualizer for input
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    drawVisualizer();

    try {
      // Load and register the audio worklet
      await audioContext.audioWorklet.addModule('js/audio-worklet-processor.js');
      
      // Create AudioWorkletNode
      const audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: NUM_CHANNELS,
        processorOptions: {
          sampleRate: SAMPLE_RATE
        }
      });

      // Handle messages from the audio processor
      audioWorkletNode.port.onmessage = (event) => {
        const { type, audioData, rms } = event.data;

        switch (type) {
          case 'audioData':
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            const pcmS16Array = convertFloat32ToS16PCM(audioData);
            const pcmByteArray = new Uint8Array(pcmS16Array.buffer);
            
            try {
              // Create frame matching server's expected format
              const frame = {
                frame: {
                  oneofKind: "audio",
                  audio: {
                    id: 0,
                    name: "AudioRawFrame",
                    audio: pcmByteArray,
                    sample_rate: SAMPLE_RATE,
                    num_channels: NUM_CHANNELS,
                    pts: 0
                  }
                }
              };

              // Create and encode the protobuf message
              const protoFrame = Frame.create(frame);
              const encodedFrame = Frame.encode(protoFrame).finish();

              if (encodedFrame.byteLength > 0) {
                ws.send(encodedFrame);
              }
            } catch (error) {
              console.error('Error creating/sending audio frame:', error);
            }
            break;

          case 'speechStart':
            isSpeaking = true;
            addMessageToTranscript('User speaking...', 'user');
            console.log('Speech detected, RMS:', rms);
            
            if (isAIResponding) {
              sendInterruptionSignal();
            }
            
            if (silenceTimeout) {
              clearTimeout(silenceTimeout);
            }
            break;

          case 'speechEnd':
            silenceTimeout = setTimeout(() => {
              isSpeaking = false;
              console.log('Speech ended, silence detected');
            }, 1500);
            break;
        }
      };

      // Connect the audio processing pipeline
      source.connect(audioWorkletNode);
      audioWorkletNode.connect(audioContext.destination);

    } catch (error) {
      console.error('Error setting up AudioWorklet:', error);
    }
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

function stopAudio(closeWebsocket) {
  playTime = 0;
  isPlaying = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;

  if (ws && closeWebsocket) {
    ws.close();
    ws = null;
  }

  if (source) {
    source.disconnect();
    source = null;
  }
  if (analyser) {
    analyser.disconnect();
    analyser = null;
  }
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  if (silenceTimeout) {
    clearTimeout(silenceTimeout);
    silenceTimeout = null;
  }
  if (aiDisplayTimer) {
    clearTimeout(aiDisplayTimer);
    aiDisplayTimer = null;
  }
  
  // Stop any playing audio
  stopAllAIAudio();
  
  // Reset AI response tracking
  resetAIMessageTracking();
  isAIResponding = false;

  // Close the audio context
  if (audioContext) {
    audioContext.close().then(() => {
      audioContext = null;
    });
  }

  // Stop the microphone stream
  if (microphoneStream) {
    microphoneStream.getTracks().forEach(track => track.stop());
    microphoneStream = null;
  }
} 