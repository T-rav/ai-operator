// Get transcript container element
let transcriptContainer = document.getElementById('transcript-container');

// Function to add a message to the transcript
function addMessageToTranscript(text, type = 'user') {
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
  content.textContent = text;
  
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(content);
  transcriptContainer.appendChild(messageDiv);
  
  // Scroll to bottom
  transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
}

// Clear transcript
function clearTranscript() {
  if (transcriptContainer) {
    transcriptContainer.innerHTML = '';
  }
}

// Export transcript functions
window.AI_TRANSCRIPT = {
  addMessageToTranscript,
  clearTranscript
}; 