// Audio processing functions

// Track active audio sources to be able to stop them
let activeAudioSources = [];

function calculateRMS(audioData) {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  return Math.sqrt(sum / audioData.length);
}

function convertFloat32ToS16PCM(float32Array) {
  try {
    console.log('Converting Float32 to S16PCM, input length:', float32Array.length);
    
    let int16Array = new Int16Array(float32Array.length);

    for (let i = 0; i < float32Array.length; i++) {
        let clampedValue = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = clampedValue < 0 ? clampedValue * 32768 : clampedValue * 32767;
    }
    
    // Log endianness info for debugging
    if (window.endianCheckDone === undefined) {
      const isLittleEndian = (() => {
        const buffer = new ArrayBuffer(2);
        new DataView(buffer).setInt16(0, 256, true);
        return new Int16Array(buffer)[0] === 256;
      })();
      console.log('System endianness:', isLittleEndian ? 'little-endian' : 'big-endian');
      window.endianCheckDone = true;
    }
    
    return int16Array;
  } catch (error) {
    console.error('Error converting audio format:', error);
    throw error;
  }
}

function enqueueAudioFromProto(arrayBuffer) {
  try {
    const parsedFrame = Frame.decode(new Uint8Array(arrayBuffer));
    if (!parsedFrame.audio) {
      console.log('Frame does not contain audio data');
      return false;
    }

    // Add debug logging
    console.log('Received audio frame:', {
      id: parsedFrame.audio.id,
      name: parsedFrame.audio.name,
      audioLength: parsedFrame.audio.audio ? parsedFrame.audio.audio.length : 0,
      sampleRate: parsedFrame.audio.sample_rate
    });

    // Skip empty frames
    if (!parsedFrame.audio.audio || parsedFrame.audio.audio.length === 0) {
      console.warn('Received empty audio frame, skipping playback');
      return false;
    }

    // Reset play time if it's been a while we haven't played anything
    const diffTime = audioContext.currentTime - lastMessageTime;
    if ((playTime == 0) || (diffTime > PLAY_TIME_RESET_THRESHOLD_MS)) {
      playTime = audioContext.currentTime;
    }
    lastMessageTime = audioContext.currentTime;

    // Get the audio data from the message
    const audioData = parsedFrame.audio.audio;
    
    // Get audio parameters from the frame
    const sampleRate = parsedFrame.audio.sample_rate || SAMPLE_RATE;
    const numChannels = parsedFrame.audio.num_channels || 1;
    
    // Create audio context buffer
    const audioBuffer = audioContext.createBuffer(numChannels, audioData.length/2, sampleRate);
    
    // Convert bytes to float32 values
    const channelData = audioBuffer.getChannelData(0);
    const int16View = new Int16Array(audioData.buffer);
    
    // Fill the audio buffer with normalized values
    for (let i = 0; i < channelData.length; i++) {
      if (i < int16View.length) {
        // Convert Int16 to normalized Float32 in range [-1, 1]
        channelData[i] = int16View[i] / 32768.0;
      }
    }
    
    console.log(`Created audio buffer: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.numberOfChannels} channels`);
    
    // Skip playing if we've been interrupted
    if (!isAIResponding) {
      console.log('Skipping audio playback due to interruption');
      return;
    }
    
    const audioSource = new AudioBufferSourceNode(audioContext);
    audioSource.buffer = audioBuffer;
    
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
    playTime = playTime + audioBuffer.duration;
    
    return true;
  } catch (error) {
    console.error('Error in enqueueAudioFromProto:', error);
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
  if (audioContext) {
    playTime = audioContext.currentTime;
  } else {
    playTime = 0;
  }
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