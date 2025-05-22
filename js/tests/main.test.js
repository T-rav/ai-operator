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
    contains: jest.fn()
  },
  innerHTML: ''
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

// Mock document
global.document = {
  getElementById: jest.fn().mockImplementation((id) => {
    if (id === 'play-button') return mockPlayButton;
    if (id === 'visualizer') return mockVisualizer;
    return null;
  }),
  addEventListener: jest.fn()
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

// Mock window
global.window = {
  addEventListener: jest.fn()
};

// Import the module under test
require('../main.js');

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
    // Call the function
    global.AI_MAIN.init();

    // Check that event listeners were added to the play button
    expect(mockPlayButton.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    
    // Check that the window load event listener was added
    expect(window.addEventListener).toHaveBeenCalledWith('load', expect.any(Function));
    
    // Check that the document keydown event listener was added
    expect(document.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  test('toggleAudio starts audio when not playing', () => {
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
    // Set initial state
    global.AI_STATE.isPlaying = true;
    mockPlayButton.classList.contains.mockReturnValue(true);
    
    // Call the function
    global.AI_MAIN.toggleAudio();
    
    // Check that the audio was stopped
    expect(global.AI_MAIN.stopAudio).toHaveBeenCalledWith(false);
  });

  test('stopAudio cleans up resources', () => {
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

  test('keydown handler triggers interruption on spacebar when AI is responding', () => {
    // Set initial state
    global.AI_STATE.isPlaying = true;
    global.AI_STATE.isAIResponding = true;
    
    // Call the init function to set up event listeners
    global.AI_MAIN.init();
    
    // Get the keydown handler
    const keydownHandler = document.addEventListener.mock.calls.find(
      call => call[0] === 'keydown'
    )[1];
    
    // Call the handler with a spacebar event
    keydownHandler({ code: 'Space', preventDefault: jest.fn() });
    
    // Check that interruption was triggered
    expect(global.AI_WEBSOCKET.sendInterruptionSignal).toHaveBeenCalled();
  });
}); 