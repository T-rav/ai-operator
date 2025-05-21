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
// Handle transcription messages
if (parsedFrame.transcription) {
    console.log('Transcription received:', JSON.stringify(parsedFrame.transcription));
    // Display detailed information about the transcription frame
    const transcriptionFrame = parsedFrame.transcription;
    const userId = transcriptionFrame.user_id || 'ai';
    console.log(`Transcription details - text: "${transcriptionFrame.text}", user_id: "${userId}", timestamp: "${transcriptionFrame.timestamp}"`);
    if (transcriptionFrame.text && transcriptionFrame.text.trim()) {
        if (userId === "user") {
            // Show user transcription as a user message in the UI
            if (typeof queueUserMessage === "function") {
                queueUserMessage(transcriptionFrame.text, transcriptionFrame.timestamp);
            }
            if (typeof addMessageToTranscript === "function") {
                addMessageToTranscript(transcriptionFrame.text, "user");
            }
        } else {
            queueAIMessage(transcriptionFrame.text, transcriptionFrame.timestamp);
            addMessageToTranscript(transcriptionFrame.text, "ai");
        }
        // Stop the transcription from continuing
    }
}
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