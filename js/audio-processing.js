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
    // Create the frame with proper field names and values
    const frame = Frame.create({
      audio: {
        id: 1,
        name: "microphone",
        audio: audioBytes,
        sample_rate: SAMPLE_RATE,
        num_channels: NUM_CHANNELS
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

function enqueueAudioFromProto(arrayBuffer) {
  try {
    const parsedFrame = Frame.decode(new Uint8Array(arrayBuffer));
    
    // Check if frame has data and audio
    if (!parsedFrame.data || !parsedFrame.data.audio) {
        console.log('No audio in frame');
        return false;
    }
    
    const audioFrame = parsedFrame.data.audio;

    // Reset play time if it's been a while we haven't played anything
    const diffTime = audioContext.currentTime - lastMessageTime;
    if ((playTime == 0) || (diffTime > PLAY_TIME_RESET_THRESHOLD_MS)) {
        playTime = audioContext.currentTime;
    }
    lastMessageTime = audioContext.currentTime;

    // Log the raw audio data properties to help debug
    console.log('Raw audio data type:', typeof audioFrame.audio);
    if (audioFrame.audio) {
        console.log('Audio instanceof Uint8Array:', audioFrame.audio instanceof Uint8Array);
        console.log('Audio instanceof Array:', Array.isArray(audioFrame.audio));
        console.log('Audio data length:', audioFrame.audio.length || 0);
    }

    // Check if the server included WAV header (pipecat often does this)
    let audioData;
    if (audioFrame.audio) {
        if (audioFrame.audio instanceof Uint8Array) {
            audioData = audioFrame.audio;
        } else if (Array.isArray(audioFrame.audio)) {
            // Convert array to Uint8Array for audio processing
            audioData = new Uint8Array(audioFrame.audio);
        } else {
            // String or other format - try to convert
            try {
                // If it's a base64 string, convert it
                audioData = new Uint8Array(atob(audioFrame.audio).split('').map(c => c.charCodeAt(0)));
            } catch (e) {
                console.error('Unable to convert audio data:', e);
                return false;
            }
        }
    } else {
        console.error('No audio data found in frame');
        return false;
    }
    
    console.log('Processed audio data length:', audioData.length);
    
    if (audioData.length === 0) {
        console.warn('Empty audio data');
        return false;
    }

  // Check if the data has a WAV header (typically starts with "RIFF")
  const isWavFile = audioData.length > 12 && 
                    audioData[0] === 82 && // R
                    audioData[1] === 73 && // I
                    audioData[2] === 70 && // F
                    audioData[3] === 70;   // F
                    
  console.log('Data appears to be a WAV file:', isWavFile);
  
  // Try to decode the audio data
  audioContext.decodeAudioData(
    audioData.buffer, 
    function(buffer) {
      // Skip playing if we've been interrupted
      if (!isAIResponding) {
          console.log('Skipping audio playback due to interruption');
          return;
      }
      
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
    }
  );
  
  return true;
  } catch (error) {
    console.error('Error processing audio frame:', error);
    return false;
  }
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