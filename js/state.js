// Global state management
const state = {
  // Audio playback state
  isPlaying: false,
  
  // Speech detection state
  isSpeaking: false,
  silenceTimeout: null,
  
  // AI response state
  isAIResponding: false
};

// Export the state object
window.AI_STATE = state; 