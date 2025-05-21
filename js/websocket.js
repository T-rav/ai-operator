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

      const bytes = new Uint8Array(arrayBuffer);
      const firstByte = bytes[0];
      const fieldNumber = firstByte >> 3;
      const wireType = firstByte & 0x07;
      
      // All our messages use length-delimited encoding (wire type 2)
      if (wireType !== 2) {
        console.warn(`Unexpected wire type: ${wireType}, trying fallback parsing`);
      }

      // Handle audio frames directly without protobuf decoding
      if (fieldNumber === 2) { // AudioFrame (field tag 18)
        const audioPlayed = enqueueAudioFromProto(arrayBuffer);
        if (!audioPlayed) {
          console.warn('Failed to play audio from frame');
        }
        return;
      }

      // For text/transcription frames (field tag 26), try manual parsing first
      if (fieldNumber === 3) {
        try {
          // Skip the header bytes and try to find the text content
          const messageLength = bytes[1]; // Length byte after field tag
          let offset = 2; // Start after field tag and length
          
          // Skip frame type and ID fields
          while (offset < bytes.length && bytes[offset] !== 26) { // 26 is field tag for text content
            offset++;
          }
          
          if (offset < bytes.length) {
            offset++; // Skip text field tag
            const textLength = bytes[offset];
            offset++;
            
            // Extract the text content
            const textContent = new TextDecoder().decode(
              bytes.slice(offset, offset + textLength)
            );
            
            // Look for user_id field (field tag 34)
            let userId = 'ai';
            let userIdOffset = offset + textLength;
            while (userIdOffset < bytes.length && bytes[userIdOffset] !== 34) {
              userIdOffset++;
            }
            
            if (userIdOffset < bytes.length - 2) {
              userIdOffset++; // Skip field tag
              const userIdLength = bytes[userIdOffset];
              userIdOffset++;
              userId = new TextDecoder().decode(
                bytes.slice(userIdOffset, userIdOffset + userIdLength)
              );
            }
            
            const speaker = userId === 'ai' ? 'ai' : 'user';
            if (speaker === 'ai') {
              isAIResponding = true;
              queueAIMessage(textContent, new Date().toISOString());
            } else {
              addMessageToTranscript(textContent, speaker);
              lastUserSpeakTimestamp = Date.now();
              resetAIMessageTracking();
            }
            return;
          }
        } catch (manualError) {
          console.warn('Manual parsing failed:', manualError);
        }
      }

      // Fallback to protobuf decoding if manual parsing fails
      try {
        const frame = Frame.decode(bytes);
        
        if (frame.transcription) {
          const transcription = frame.transcription;
          const userId = transcription.user_id || 'ai';
          const speaker = userId === 'ai' ? 'ai' : 'user';
          
          if (transcription.text && transcription.text.trim()) {
            if (speaker === 'ai') {
              isAIResponding = true;
              queueAIMessage(transcription.text, transcription.timestamp);
            } else {
              addMessageToTranscript(transcription.text, speaker);
              lastUserSpeakTimestamp = Date.now();
              resetAIMessageTracking();
            }
          }
        } else if (frame.text) {
          const text = frame.text;
          const userId = text.user_id || 'ai';
          const speaker = userId === 'ai' ? 'ai' : 'user';
          
          if (text.text && text.text.trim()) {
            if (speaker === 'ai') {
              isAIResponding = true;
              queueAIMessage(text.text, text.timestamp);
            } else {
              addMessageToTranscript(text.text, speaker);
              lastUserSpeakTimestamp = Date.now();
              resetAIMessageTracking();
            }
          }
        }
      } catch (error) {
        console.error('Both manual parsing and protobuf decode failed:', error);
        // Log raw message for debugging
        console.log('Raw message bytes:', Array.from(bytes));
        console.log('Raw message content:', new TextDecoder().decode(arrayBuffer));
      }
    } catch (error) {
      console.error('Error handling message:', error);
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
      await audioContext.audioWorklet.addModule('/js/audio-worklet-processor.js').catch(error => {
        console.error('Failed to load audio worklet:', error);
        throw error;
      });
      
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

      // Handle errors from the audio worklet
      audioWorkletNode.port.onmessageerror = (error) => {
        console.error('Error from audio worklet:', error);
      };

      // Connect the audio processing pipeline
      source.connect(audioWorkletNode);
      audioWorkletNode.connect(audioContext.destination);

    } catch (error) {
      console.error('Error setting up AudioWorklet:', error);
      alert('Failed to initialize audio processing. Please try reloading the page.');
    }
  }).catch((error) => {
    console.error('Error accessing microphone:', error);
    alert('Failed to access microphone. Please ensure microphone permissions are granted and try again.');
  });
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
  // First stop any playing audio and reset flags
  stopAllAIAudio();
  isPlaying = false;
  
  // Update UI
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;

  // Clear timeouts
  if (silenceTimeout) {
    clearTimeout(silenceTimeout);
    silenceTimeout = null;
  }
  if (aiDisplayTimer) {
    clearTimeout(aiDisplayTimer);
    aiDisplayTimer = null;
  }

  // Stop animation
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  // Disconnect audio nodes
  if (source) {
    source.disconnect();
    source = null;
  }
  if (analyser) {
    analyser.disconnect();
    analyser = null;
  }

  // Reset AI response tracking
  resetAIMessageTracking();
  isAIResponding = false;

  // Close WebSocket if requested
  if (ws && closeWebsocket) {
    ws.close();
    ws = null;
  }

  // Close audio context
  if (audioContext) {
    audioContext.close().then(() => {
      audioContext = null;
      console.log('Audio context closed successfully');
    }).catch(error => {
      console.error('Error closing audio context:', error);
    });
  }

  // Stop microphone stream
  if (microphoneStream) {
    microphoneStream.getTracks().forEach(track => track.stop());
    microphoneStream = null;
  }

  // Reset playback time
  playTime = 0;
} 