// Audio processing functions

// Track active audio sources to be able to stop them
let activeAudioSources = [];

// Audio worklet node to get data from microphone
let audioWorkletNode = null;

// Audio processing worklet code for modern browsers
const audioWorkletProcessorCode = `
  class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.bufferSize = 512;
      this.buffer = new Float32Array(this.bufferSize);
      this.bufferIndex = 0;
    }
    
    process(inputs, outputs, parameters) {
      const input = inputs[0][0];
      if (!input) return true;
      
      // Add input samples to buffer
      for (let i = 0; i < input.length; i++) {
        this.buffer[this.bufferIndex++] = input[i];
        
        // When buffer is full, send it to main thread
        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage({
            type: 'audio',
            audioData: this.buffer.slice()
          });
          this.bufferIndex = 0;
        }
      }
      return true;
    }
  }
  
  registerProcessor('audio-processor', AudioProcessor);
`;

// Setup AudioWorklet for modern browsers
async function setupAudioWorklet() {
  try {
    console.log("Setting up AudioWorklet...");
    // Create the worklet from the code
    const blob = new Blob([audioWorkletProcessorCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    
    await audioContext.audioWorklet.addModule(url);
    
    // Create the worklet node
    audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');
    
    // Handle messages from the processor
    audioWorkletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio') {
        processAudioChunk(event.data.audioData);
      }
    };
    
    console.log("AudioWorklet setup complete");
    return true;
  } catch (error) {
    console.error('Failed to setup AudioWorklet:', error);
    return false;
  }
}

// Process audio data (shared between AudioWorklet and ScriptProcessor)
function processAudioChunk(audioData) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  // Process audio data for transmission
  const pcmS16Array = convertFloat32ToS16PCM(audioData);
  const pcmByteArray = new Uint8Array(pcmS16Array.buffer);
  
  // Convert pcmByteArray to an array of numbers which protobuf expects
  const audioBytes = Array.from(pcmByteArray);
  
  try {
    // Create the frame with proper field names and values to match frames.proto
    const frame = Frame.create({
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
    
    const encodedFrame = Frame.encode(frame).finish();
    ws.send(encodedFrame);
  } catch (error) {
    console.error('Error encoding frame:', error);
  }
  
  // Check for speech
  const rms = calculateRMS(audioData);
  const speechThreshold = 0.03; // Adjust threshold as needed
  
  if (rms > speechThreshold) {
    if (!isSpeaking) {
      isSpeaking = true;
      addMessageToTranscript('User speaking...', 'user');
      
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
    }, 1000); // Adjust timeout as needed
  }
}

function calculateRMS(audioData) {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  return Math.sqrt(sum / audioData.length);
}

function convertFloat32ToS16PCM(float32Array) {
  let int16Array = new Int16Array(float32Array.length);

  for (let i = 0; i < float32Array.length; i++) {
      let clampedValue = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = clampedValue < 0 ? clampedValue * 32768 : clampedValue * 32767;
  }
  return int16Array;
}

// Original function - keep but won't be used
function enqueueAudioFromProto(arrayBuffer) {
  try {
    // Log received data for debugging
    console.log('Received audio data length:', arrayBuffer.byteLength);
    
    // Bypass the protobuf decoding and extract audio directly
    extractAndPlayAudio(arrayBuffer);
    return true;
  } catch (error) {
    console.error('Error processing audio frame:', error);
    return false;
  }
}

// Enhanced raw audio extraction and direct playback
function extractAndPlayAudio(arrayBuffer) {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    console.log('First few bytes:', Array.from(bytes.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    // Enhanced WAV header detection
    // RIFF header check - standard WAV starts with "RIFF"
    const isWavFile = bytes.length > 12 && 
                      bytes[0] === 82 && bytes[1] === 73 && 
                      bytes[2] === 70 && bytes[3] === 70; // "RIFF"
    
    let audioData;
    
    if (isWavFile) {
      // If it's already a WAV file, use it directly
      console.log('Data appears to be a WAV file, using directly');
      audioData = bytes;
    } else {
      // Try to find embedded WAV header anywhere in the buffer
      let dataStart = -1;
      
      // Look for WAV header markers within the buffer
      for (let i = 0; i < bytes.length - 12; i++) {
        if (bytes[i] === 82 && bytes[i+1] === 73 && 
            bytes[i+2] === 70 && bytes[i+3] === 70) { // "RIFF"
          dataStart = i;
          console.log('Found WAV header at position', i);
          break;
        }
      }
      
      if (dataStart >= 0) {
        // Extract from the WAV header position
        audioData = bytes.slice(dataStart);
        console.log('Extracting audio from WAV header at position', dataStart);
      } else {
        // Diagnostic info
        console.log('No WAV header found. First 50 bytes:', 
          Array.from(bytes.slice(0, 50)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        
        // Skip protobuf wrapper bytes for common binary patterns
        // Analytics of what we typically see in the protobuf messages
        if (bytes[0] === 26 || bytes[0] === 10 || bytes[0] === 18) {
          // These are common protobuf field markers
          // Format is usually [field_id][length][data]
          // Length byte is usually at position 1
          const possibleLength = bytes[1];
          
          if (possibleLength < 250 && possibleLength < bytes.length - 2) {
            // Skip the field marker, length byte, and the content
            const skipBytes = 2 + possibleLength;
            console.log(`Possible protobuf wrapper, skipping ${skipBytes} bytes`);
            
            // If there's a sub-message, there may be another wrapper
            let offset = skipBytes;
            
            // Look for WAV header after skipping the wrapper
            for (let i = offset; i < Math.min(bytes.length - 12, offset + 50); i++) {
              if (bytes[i] === 82 && bytes[i+1] === 73 && 
                  bytes[i+2] === 70 && bytes[i+3] === 70) { // "RIFF"
                console.log('Found WAV header after protobuf wrapper at position', i);
                audioData = bytes.slice(i);
                break;
              }
            }
            
            // If still not found, just try from the offset
            if (!audioData) {
              console.log('No WAV header after wrapper, trying from offset', offset);
              audioData = bytes.slice(offset);
            }
          }
        }
        
        // If still no audio data, use our fallback methods
        if (!audioData) {
          console.log('No audio data identified through protobuf analysis, trying fallbacks');
          tryDifferentOffsets(bytes);
          return;
        }
      }
    }
    
    // Minimum viable audio data check
    if (!audioData || audioData.length < 44) { // Minimum WAV header size
      console.log('Audio data too small, trying different offsets');
      tryDifferentOffsets(bytes);
      return;
    }
    
    console.log('Extracted audio data length:', audioData.length);
    
    // Reset play time if it's been a while since we played anything
    const diffTime = audioContext.currentTime - lastMessageTime;
    if ((playTime == 0) || (diffTime > PLAY_TIME_RESET_THRESHOLD_MS)) {
      playTime = audioContext.currentTime;
    }
    lastMessageTime = audioContext.currentTime;
    
    // Try to play the extracted audio
    try {
      audioContext.decodeAudioData(
        audioData.buffer, 
        function(buffer) {
          // Skip playing if we've been interrupted
          if (!isAIResponding) {
            console.log('Skipping audio playback due to interruption');
            return;
          }
          
          console.log('Successfully decoded audio, playing');
          const audioSource = new AudioBufferSourceNode(audioContext);
          audioSource.buffer = buffer;
          
          // Connect output to analyzer and destination
          audioSource.connect(analyser);
          audioSource.connect(audioContext.destination);
          
          // Start displaying AI transcriptions as audio plays
          processAIMessageQueue();
          
          // Add to active sources for potential stopping
          activeAudioSources.push(audioSource);
          
          // Clean up when finished
          audioSource.onended = function() {
            // Remove from active sources array
            const index = activeAudioSources.indexOf(audioSource);
            if (index > -1) {
              activeAudioSources.splice(index, 1);
            }
          };
          
          audioSource.start(playTime);
          playTime = playTime + buffer.duration;
        },
        function(error) {
          console.error('Error decoding audio data:', error);
          // Fallback approach: try with different offsets
          tryDifferentOffsets(bytes);
        }
      );
    } catch (e) {
      console.error('Exception in audio decoding:', e);
      // Fallback approach: try with different offsets
      tryDifferentOffsets(bytes);
    }
  } catch (error) {
    console.error('Error in extractAndPlayAudio:', error);
  }
}

// Try different starting offsets to find valid audio data
function tryDifferentOffsets(bytes) {
  console.log('Trying different offsets to find valid audio data');
  
  // Try a larger series of offsets with smaller increments
  const offsetsToTry = [0, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 88, 96, 112, 128, 144, 160, 192, 224, 256];
  
  // Track if we've found valid audio
  let foundValidAudio = false;
  
  // Find the right audio data by trying different offsets
  for (let i = 0; i < offsetsToTry.length; i++) {
    const offset = offsetsToTry[i];
    if (offset >= bytes.length) continue;
    
    console.log(`Trying offset ${offset}`);
    const slicedData = bytes.slice(offset);
    
    try {
      audioContext.decodeAudioData(
        slicedData.buffer, 
        function(buffer) {
          // If we've already found valid audio or been interrupted, don't play more
          if (foundValidAudio || !isAIResponding) return;
          
          console.log(`Successfully decoded audio with offset ${offset}`);
          foundValidAudio = true;
          
          const audioSource = new AudioBufferSourceNode(audioContext);
          audioSource.buffer = buffer;
          audioSource.connect(analyser);
          audioSource.connect(audioContext.destination);
          activeAudioSources.push(audioSource);
          
          audioSource.onended = function() {
            const index = activeAudioSources.indexOf(audioSource);
            if (index > -1) activeAudioSources.splice(index, 1);
          };
          
          // Process any queued AI messages as audio plays
          processAIMessageQueue();
          
          audioSource.start(playTime);
          playTime = playTime + buffer.duration;
        },
        function(error) {
          // Just ignore errors for individual offsets
        }
      );
    } catch (e) {
      // Ignore errors for individual offsets
    }
  }
  
  // If we couldn't find valid audio after trying all offsets, log it
  setTimeout(() => {
    if (!foundValidAudio) {
      console.warn('Could not find valid audio data at any offset');
    }
  }, 1000); // Check after a second to allow async decoding to complete
}

// Stop all actively playing AI audio sources
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
  
  // Reset play time to prevent scheduled audio from playing
  playTime = audioContext.currentTime;
}

function startAudioBtnHandler() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('getUserMedia is not supported in your browser.');
      return;
  }

  startBtn.disabled = true;
  stopBtn.disabled = false;

  audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'interactive',
      sampleRate: SAMPLE_RATE
  });

  isPlaying = true;

  initWebSocket();
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

  if (scriptProcessor) {
      scriptProcessor.disconnect();
  }
  if (audioWorkletNode) {
      audioWorkletNode.disconnect();
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
  if (silenceTimeout) {
      clearTimeout(silenceTimeout);
  }
  if (aiDisplayTimer) {
      clearTimeout(aiDisplayTimer);
  }
  
  // Stop any playing audio
  stopAllAIAudio();
  
  // Reset AI response tracking
  resetAIMessageTracking();
  isAIResponding = false;
}

function stopAudioBtnHandler() {
  stopAudio(true);
} 