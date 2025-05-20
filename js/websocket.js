// WebSocket functions

function initWebSocket() {
  ws = new WebSocket('ws://localhost:8765');
  // This is so `event.data` is already an ArrayBuffer.
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', handleWebSocketOpen);
  ws.addEventListener('message', handleWebSocketMessage);
  ws.addEventListener('close', (event) => {
    console.log('WebSocket connection closed.', event.code, event.reason);
    stopAudio(false);
  });
  ws.addEventListener('error', (event) => console.error('WebSocket error:', event));
}

function handleWebSocketMessage(event) {
  const arrayBuffer = event.data;
  if (isPlaying) {
    try {
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
            // Queue AI messages for progressive display
            queueAIMessage(transcriptionFrame.text, transcriptionFrame.timestamp);
            isAIResponding = true;
          } else {
            // User messages displayed immediately
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
  console.log('WebSocket connection established.', event)

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
      const frame = Frame.create({
        audio: {
          id: 0,
          name: "InputAudioRawFrame",
          audio: pcmByteArray,
          sampleRate: SAMPLE_RATE,
          numChannels: NUM_CHANNELS
        }
      });
      const encodedFrame = new Uint8Array(Frame.encode(frame).finish());
      ws.send(encodedFrame);

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