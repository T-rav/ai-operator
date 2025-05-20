// Transcript management functions

// Reset AI message tracking for a new round of conversation
function resetAIMessageTracking() {
  aiMessageQueue = [];
  aiFullTranscript = "";
  aiCurrentIndex = 0;
  isDisplayingMessage = false;
  currentSpeechId = null;
  
  if (aiDisplayTimer) {
    clearTimeout(aiDisplayTimer);
    aiDisplayTimer = null;
  }
}

// Queue AI messages for progressive display
function queueAIMessage(text, timestamp) {
  // If AI has been interrupted, don't queue new messages
  if (!isAIResponding) {
    console.log('Ignoring new AI message due to interruption');
    return;
  }
  
  // Determine if this is a new speech response
  const isFirstMessage = !currentSpeechId;
  
  // Always create a new region after user has spoken
  if (needNewAIRegion || isFirstMessage) {
    console.log("Creating new AI speech region");
    
    // Complete any existing message display
    if (isDisplayingMessage) {
      completeCurrentAIMessage();
    }
    
    // Start a new message
    resetAIMessageTracking();
    currentSpeechId = timestamp || Date.now().toString();
    
    // Store the text for this new message
    aiFullTranscript = text;
    
    // Create a new AI message placeholder
    addMessageToTranscript('', 'ai', true);
    
    // Start displaying character by character
    startProgressiveDisplay();
    
    // Reset the flag since we've created a new region
    needNewAIRegion = false;
  } else {
    // Same speech response, append to current transcript
    if (aiFullTranscript) {
      aiFullTranscript += " " + text;
    } else {
      aiFullTranscript = text;
      
      // Create a new message if none exists
      if (!findCurrentAIMessage()) {
        addMessageToTranscript('', 'ai', true);
      }
      
      // Start the display if not already running
      if (!isDisplayingMessage) {
        startProgressiveDisplay();
      }
    }
  }
}

// Complete the current AI message by finishing display
function completeCurrentAIMessage() {
  if (!isDisplayingMessage) return;
  
  // Force completion of the current message
  const aiMessage = findCurrentAIMessage();
  if (aiMessage) {
    const content = aiMessage.querySelector('.content');
    content.textContent = aiFullTranscript;
  }
  
  // Reset display state
  isDisplayingMessage = false;
  if (aiDisplayTimer) {
    clearTimeout(aiDisplayTimer);
    aiDisplayTimer = null;
  }
}

// Immediately end all AI message processing due to interruption
function stopAITranscription() {
  // Complete current message to show what was said so far
  if (isDisplayingMessage) {
    completeCurrentAIMessage();
  }
  
  // Clear any queued messages
  aiMessageQueue = [];
  
  // Prevent new messages from being processed
  isAIResponding = false;
  
  console.log('AI transcription stopped due to interruption');
}

// Find the current AI message
function findCurrentAIMessage() {
  if (!transcriptContainer) return null;
  
  const messages = transcriptContainer.querySelectorAll('.message.ai');
  if (messages.length === 0) return null;
  
  // Return the last AI message
  return messages[messages.length - 1];
}

// Process the AI message queue progressively
function processAIMessageQueue() {
  // Don't process if AI has been interrupted
  if (!isAIResponding) return;
  
  // Just trigger the progressive display if not already running
  if (!isDisplayingMessage) {
    startProgressiveDisplay();
  }
}

// Start displaying text character by character
function startProgressiveDisplay() {
  if (isDisplayingMessage || aiCurrentIndex >= aiFullTranscript.length) {
    return;
  }
  
  isDisplayingMessage = true;
  displayNextCharacter();
}

// Display the next character in the transcript
function displayNextCharacter() {
  // Stop if AI has been interrupted
  if (!isAIResponding) {
    isDisplayingMessage = false;
    return;
  }
  
  if (aiCurrentIndex >= aiFullTranscript.length) {
    isDisplayingMessage = false;
    return;
  }
  
  // Get the next character
  const nextChar = aiFullTranscript.charAt(aiCurrentIndex);
  aiCurrentIndex++;
  
  // Update the display
  updateAITranscript(aiFullTranscript.substring(0, aiCurrentIndex));
  
  // Schedule the next character
  aiDisplayTimer = setTimeout(displayNextCharacter, AI_DISPLAY_SPEED);
}

// Update the AI transcript with new text
function updateAITranscript(text) {
  // Get the current AI message
  const aiMessage = findCurrentAIMessage();
  
  if (aiMessage) {
    // Update existing AI message
    const content = aiMessage.querySelector('.content');
    content.textContent = text;
  } else {
    // Create a new AI message
    addMessageToTranscript(text, 'ai');
  }
  
  // Scroll to bottom
  if (transcriptContainer) {
    transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
  }
}

// Function to add a message to the transcript
function addMessageToTranscript(text, type = 'user', placeholder = false) {
  if (!transcriptContainer) return;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  
  // Set appropriate avatar text based on message type
  if (type === 'system') {
    avatar.textContent = 'S';
  } else {
    avatar.textContent = type === 'user' ? 'U' : 'AI';
  }
  
  const content = document.createElement('div');
  content.className = 'content';
  if (placeholder) {
    content.textContent = '...';
  } else {
    content.textContent = text;
  }
  
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(content);
  transcriptContainer.appendChild(messageDiv);
  
  // Scroll to bottom
  transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
  
  // If this is a user message, set flag for next AI response to be in new region
  if (type === 'user') {
    needNewAIRegion = true;
    lastUserSpeakTimestamp = Date.now();
  }
} 