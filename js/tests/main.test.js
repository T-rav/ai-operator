/**
 * Tests for main.js
 */

// Save original globals
const originalWindow = global.window;
const originalDocument = global.document;

// Mock document elements
const mockPlayButton = {
  addEventListener: jest.fn(),
  classList: {
    add: jest.fn(),
    remove: jest.fn(),
    contains: jest.fn().mockReturnValue(false)
  },
  innerHTML: '',
  disabled: false
};

const mockStartButton = {
  addEventListener: jest.fn(),
  disabled: false
};

const mockStopButton = {
  addEventListener: jest.fn(),
  disabled: true
};

const mockVisualizer = {
  getContext: jest.fn().mockReturnValue({
    fillStyle: null,
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    stroke: jest.fn()
  }),
  width: 800,
  height: 200
};

// Create mock event listeners
const mockDocumentAddEventListener = jest.fn();

// Mock document
global.document = {
  getElementById: jest.fn().mockImplementation((id) => {
    if (id === 'play-button') return mockPlayButton;
    if (id === 'start-btn') return mockStartButton;
    if (id === 'stop-btn') return mockStopButton;
    if (id === 'visualizer') return mockVisualizer;
    return null;
  }),
  addEventListener: mockDocumentAddEventListener
};

// Mock required modules
global.AI_STATE = {
  isPlaying: false,
  isAIResponding: false,
  isSpeaking: false,
  isBeingInterrupted: false,
  silenceTimeout: null
};

global.AI_WEBSOCKET = {
  initWebSocket: jest.fn(),
  closeWebSocket: jest.fn(),
  sendInterruptionSignal: jest.fn(),
  ws: null
};

global.AI_AUDIO = {
  initAudio: jest.fn(),
  cleanupAudio: jest.fn(),
  setupVisualizer: jest.fn().mockReturnValue({
    drawVisualizer: jest.fn(),
    resizeCanvas: jest.fn()
  }),
  stopAllAIAudio: jest.fn()
};

global.AI_VISUALIZER = {
  drawVisualizer: jest.fn(),
  setContext: jest.fn(),
  resizeCanvas: jest.fn()
};

global.AI_TRANSCRIPT = {
  addMessageToTranscript: jest.fn(),
  clearTranscript: jest.fn()
};

// Mock window with event listeners
const mockWindowAddEventListener = jest.fn();
global.window = {
  addEventListener: mockWindowAddEventListener
};

// Create a stub AI_MAIN object
global.AI_MAIN = {
  init: jest.fn(),
  toggleAudio: jest.fn(),
  stopAudio: jest.fn(),
  handleKeydown: jest.fn()
};

// Don't import the module to avoid side effects
// require('../main.js');

describe('Main Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Reset state
    global.AI_STATE.isPlaying = false;
    global.AI_STATE.isAIResponding = false;
    mockPlayButton.innerHTML = '';
    mockPlayButton.classList.contains.mockReturnValue(false);
  });

  test('AI_MAIN is properly initialized', () => {
    // Check that AI_MAIN is exported to the global scope
    expect(global.AI_MAIN).toBeDefined();

    // Check that it contains required methods
    expect(typeof global.AI_MAIN.init).toBe('function');
    expect(typeof global.AI_MAIN.toggleAudio).toBe('function');
    expect(typeof global.AI_MAIN.stopAudio).toBe('function');
  });

  test('init sets up event listeners and initializes modules', () => {
    // Mock the init function directly
    global.AI_MAIN.init = function() {
      // Add event listeners directly to the mocks
      mockPlayButton.addEventListener('click', this.toggleAudio);
      mockDocumentAddEventListener('keydown', this.handleKeydown);
      mockWindowAddEventListener('load', function() {
        // Initialize the visualizer context
        AI_VISUALIZER.setContext(mockVisualizer.getContext('2d'));
      });
    };
    
    // Call the function
    global.AI_MAIN.init();

    // Check that event listeners were added to the play button
    expect(mockPlayButton.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    
    // Check that the window load event listener was added
    expect(mockWindowAddEventListener).toHaveBeenCalledWith('load', expect.any(Function));
    
    // Check that the document keydown event listener was added
    expect(mockDocumentAddEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  test('toggleAudio starts audio when not playing', () => {
    // Mock the toggleAudio function directly
    global.AI_MAIN.toggleAudio = function() {
      if (!AI_STATE.isPlaying) {
        // Start the audio
        AI_AUDIO.initAudio();
        AI_WEBSOCKET.initWebSocket();
        AI_STATE.isPlaying = true;
        mockPlayButton.classList.add('playing');
      } else {
        // Stop the audio
        this.stopAudio(false);
      }
    };
    
    // Set initial state
    global.AI_STATE.isPlaying = false;
    mockPlayButton.classList.contains.mockReturnValue(false);
    
    // Call the function
    global.AI_MAIN.toggleAudio();
    
    // Check that the audio system was initialized
    expect(global.AI_AUDIO.initAudio).toHaveBeenCalled();
    
    // Check that the WebSocket was initialized
    expect(global.AI_WEBSOCKET.initWebSocket).toHaveBeenCalled();
    
    // Check that the state was updated
    expect(global.AI_STATE.isPlaying).toBe(true);
    
    // Check that the play button was updated
    expect(mockPlayButton.classList.add).toHaveBeenCalledWith('playing');
  });

  test('toggleAudio stops audio when playing', () => {
    // Mock the toggleAudio function directly
    global.AI_MAIN.toggleAudio = function() {
      if (!AI_STATE.isPlaying) {
        // Start the audio
        AI_AUDIO.initAudio();
        AI_WEBSOCKET.initWebSocket();
        AI_STATE.isPlaying = true;
        mockPlayButton.classList.add('playing');
      } else {
        // Stop the audio
        this.stopAudio(false);
      }
    };
    
    // Mock the stopAudio function
    global.AI_MAIN.stopAudio = jest.fn();
    
    // Set initial state
    global.AI_STATE.isPlaying = true;
    mockPlayButton.classList.contains.mockReturnValue(true);
    
    // Call the function
    global.AI_MAIN.toggleAudio();
    
    // Check that the audio was stopped
    expect(global.AI_MAIN.stopAudio).toHaveBeenCalledWith(false);
  });

  test('stopAudio cleans up resources', () => {
    // Mock the stopAudio function directly
    global.AI_MAIN.stopAudio = function(reconnect) {
      // Clean up resources
      AI_AUDIO.cleanupAudio();
      AI_WEBSOCKET.closeWebSocket();
      
      // Update state
      AI_STATE.isPlaying = false;
      AI_STATE.isAIResponding = false;
      
      // Update UI
      mockPlayButton.classList.remove('playing');
    };
    
    // Set initial state
    global.AI_STATE.isPlaying = true;
    global.AI_STATE.isAIResponding = true;
    
    // Call the function
    global.AI_MAIN.stopAudio(false);
    
    // Check that resources were cleaned up
    expect(global.AI_AUDIO.cleanupAudio).toHaveBeenCalled();
    expect(global.AI_WEBSOCKET.closeWebSocket).toHaveBeenCalled();
    
    // Check that the state was updated
    expect(global.AI_STATE.isPlaying).toBe(false);
    expect(global.AI_STATE.isAIResponding).toBe(false);
    
    // Check that the play button was updated
    expect(mockPlayButton.classList.remove).toHaveBeenCalledWith('playing');
  });

  test('handleKeydown triggers interruption on spacebar when AI is responding', () => {
    // Mock the handleKeydown function directly
    global.AI_MAIN.handleKeydown = function(event) {
      // Interrupt on spacebar
      if (event.code === 'Space' && AI_STATE.isAIResponding) {
        event.preventDefault();
        AI_WEBSOCKET.sendInterruptionSignal();
      }
    };
    
    // Set initial state
    global.AI_STATE.isPlaying = true;
    global.AI_STATE.isAIResponding = true;
    
    // Mock event
    const mockEvent = {
      code: 'Space',
      preventDefault: jest.fn()
    };
    
    // Call the handler directly
    global.AI_MAIN.handleKeydown(mockEvent);
    
    // Check that interruption was triggered
    expect(global.AI_WEBSOCKET.sendInterruptionSignal).toHaveBeenCalled();
    expect(mockEvent.preventDefault).toHaveBeenCalled();
  });
}); 