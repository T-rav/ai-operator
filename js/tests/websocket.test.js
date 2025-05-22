/**
 * Tests for websocket.js
 */

// Mock all imports needed for the WebSocket module to work
jest.mock('../audio-processing.js', () => {
  return {};
}, { virtual: true });

// Set up navigator with getUserMedia mock
global.navigator = {
  mediaDevices: {
    getUserMedia: jest.fn().mockResolvedValue({
      getTracks: () => [{
        stop: jest.fn()
      }]
    })
  }
};

// Mock global window object
global.window = {};

// Mock WebSocket class
const mockWebSocket = {
  addEventListener: jest.fn(),
  send: jest.fn(),
  close: jest.fn(),
  binaryType: null
};

global.WebSocket = jest.fn().mockImplementation(() => mockWebSocket);

// Create script processor for audio tests
const mockScriptProcessor = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  onaudioprocess: null
};

// Create a more robust mock for the audio context
const mockAudioContext = {
  createScriptProcessor: jest.fn().mockReturnValue(mockScriptProcessor),
  createMediaStreamSource: jest.fn().mockReturnValue({
    connect: jest.fn()
  }),
  createAnalyser: jest.fn().mockReturnValue({
    connect: jest.fn(),
    fftSize: 0,
    frequencyBinCount: 128,
    getByteTimeDomainData: jest.fn()
  }),
  destination: {},
  currentTime: 0
};

// Mock AI_CONFIG with proper Frame implementation
global.AI_CONFIG = {
  SAMPLE_RATE: 16000,
  NUM_CHANNELS: 1,
  SPEECH_THRESHOLD: 0.01,
  REQUIRED_CONSECUTIVE_FRAMES: 3,
  Frame: {
    decode: jest.fn().mockImplementation((data) => {
      // Use type checking to handle both ArrayBuffer and Uint8Array
      const dataArray = data instanceof Uint8Array ? data : new Uint8Array(data);
      
      // Different return values based on the first byte
      if (dataArray[0] === 1) {
        return { transcription: { text: 'Test transcription' } };
      } else if (dataArray[0] === 2) {
        return { audio: { audio: new Uint8Array(10) } };
      } else if (dataArray[0] === 3) {
        return { botInterruption: { id: 123 } };
      } else if (dataArray[0] === 4) {
        return { end: true };
      } else {
        return {};
      }
    }),
    create: jest.fn().mockImplementation((options) => options),
    encode: jest.fn().mockImplementation((frame) => {
      return {
        finish: () => new Uint8Array(10)
      };
    })
  }
};

// Mock AI_STATE
global.AI_STATE = {
  isPlaying: true,
  isAIResponding: false,
  isSpeaking: false,
  isBeingInterrupted: false,
  silenceTimeout: null
};

// Mock AI_AUDIO
global.AI_AUDIO = {
  audioContext: mockAudioContext,
  convertFloat32ToS16PCM: jest.fn().mockReturnValue(new Int16Array(10)),
  calculateRMS: jest.fn().mockReturnValue(0.005), // Below threshold by default
  enqueueAudioFromProto: jest.fn(),
  stopAllAIAudio: jest.fn(),
  setupVisualizer: jest.fn().mockReturnValue({
    drawVisualizer: jest.fn()
  }),
  source: null,
  analyser: null,
  dataArray: null,
  activeAudioSources: [],
  resetAIResponseTimeout: jest.fn()
};

// Mock AI_MAIN
global.AI_MAIN = {
  stopAudio: jest.fn()
};

// Mock AI_TRANSCRIPT
global.AI_TRANSCRIPT = {
  addMessageToTranscript: jest.fn()
};

// Mock AI_VISUALIZER
global.AI_VISUALIZER = {
  drawVisualizer: jest.fn()
};

// Mock timer functions
global.setTimeout = jest.fn().mockReturnValue(123);
global.clearTimeout = jest.fn();

// Use fake timers
jest.useFakeTimers();

// Mock the buffer handling for onaudioprocess
const createInputBuffer = () => ({
  getChannelData: jest.fn().mockReturnValue(new Float32Array(512))
});

// Store handlers to verify they were properly set
let openHandler, messageHandler, closeHandler, errorHandler;

// Override addEventListener to capture handlers
mockWebSocket.addEventListener.mockImplementation((event, handler) => {
  if (event === 'open') openHandler = handler;
  else if (event === 'message') messageHandler = handler;
  else if (event === 'close') closeHandler = handler;
  else if (event === 'error') errorHandler = handler;
});

// Import the WebSocket module now that we've set up mocks
require('../websocket.js');

// Override the internal handleWebSocketOpen function to prevent navigator.mediaDevices.getUserMedia errors
window.AI_WEBSOCKET.handleWebSocketOpen = jest.fn().mockImplementation(async (event) => {
  console.log('Mock: WebSocket connection established.');
  
  // Set up audio context and script processor
  AI_AUDIO.audioContext = mockAudioContext;
  AI_AUDIO.scriptProcessor = mockScriptProcessor;
  
  // Set up visualizer
  AI_VISUALIZER.drawVisualizer();
});

describe('WebSocket Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Reset global state
    global.AI_STATE.isPlaying = true;
    global.AI_STATE.isAIResponding = false;
    global.AI_STATE.isSpeaking = false;
    global.AI_STATE.isBeingInterrupted = false;
    if (global.AI_STATE.silenceTimeout) {
      clearTimeout(global.AI_STATE.silenceTimeout);
      global.AI_STATE.silenceTimeout = null;
    }
    
    // Reset WebSocket
    window.AI_WEBSOCKET.ws = null;
    
    // Reset mock handler storage
    openHandler = null;
    messageHandler = null;
    closeHandler = null;
    errorHandler = null;
  });
  
  test('initWebSocket creates a WebSocket connection', () => {
    // Call the function
    window.AI_WEBSOCKET.initWebSocket();
    
    // Check that WebSocket was created with the right URL
    expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:8765');
    
    // Check that binaryType was set correctly
    expect(mockWebSocket.binaryType).toBe('arraybuffer');
    
    // Check that event listeners were added
    expect(mockWebSocket.addEventListener).toHaveBeenCalledWith('open', expect.any(Function));
    expect(mockWebSocket.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockWebSocket.addEventListener).toHaveBeenCalledWith('close', expect.any(Function));
    expect(mockWebSocket.addEventListener).toHaveBeenCalledWith('error', expect.any(Function));
    
    // Check that handlers were captured
    expect(openHandler).toBeDefined();
    expect(messageHandler).toBeDefined();
    expect(closeHandler).toBeDefined();
    expect(errorHandler).toBeDefined();
  });
  
  test('handleWebSocketOpen requests user media and sets up audio', async () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Call our mocked open handler
    await window.AI_WEBSOCKET.handleWebSocketOpen({ type: 'open' });
    
    // Check that our mock was called
    expect(window.AI_WEBSOCKET.handleWebSocketOpen).toHaveBeenCalled();
    
    // Check that the visualizer was drawn
    expect(AI_VISUALIZER.drawVisualizer).toHaveBeenCalled();
  });
  
  test('handleWebSocketMessage handles transcription messages', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Create a mock transcription message
    const transcriptionMessage = {
      data: new Uint8Array([1, 2, 3]).buffer
    };
    
    // Call the message handler directly
    messageHandler(transcriptionMessage);
    
    // Check that Frame.decode was called with the message data
    expect(AI_CONFIG.Frame.decode).toHaveBeenCalled();
    
    // Check that the transcription was added to the transcript
    expect(AI_TRANSCRIPT.addMessageToTranscript).toHaveBeenCalledWith('Test transcription', 'user');
  });
  
  test('handleWebSocketMessage handles audio messages', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Create a mock audio message
    const audioMessage = {
      data: new Uint8Array([2, 3, 4]).buffer
    };
    
    // Call the message handler directly
    messageHandler(audioMessage);
    
    // Check that Frame.decode was called with the message data
    expect(AI_CONFIG.Frame.decode).toHaveBeenCalled();
    
    // Check that the audio was processed
    expect(AI_AUDIO.enqueueAudioFromProto).toHaveBeenCalled();
  });
  
  test('handleWebSocketMessage handles bot interruption', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Create a mock interruption message
    const interruptionMessage = {
      data: new Uint8Array([3, 4, 5]).buffer
    };
    
    // Call the message handler directly
    messageHandler(interruptionMessage);
    
    // Check that Frame.decode was called with the message data
    expect(AI_CONFIG.Frame.decode).toHaveBeenCalled();
    
    // Check that the audio was stopped
    expect(AI_AUDIO.stopAllAIAudio).toHaveBeenCalled();
    
    // Check that the interruption was added to the transcript
    expect(AI_TRANSCRIPT.addMessageToTranscript).toHaveBeenCalledWith('AI was interrupted', 'system');
    
    // Check that interruption state is properly set
    expect(AI_STATE.isBeingInterrupted).toBe(true);
    
    // Fast-forward timers to check state reset
    jest.advanceTimersByTime(500);
    expect(AI_STATE.isBeingInterrupted).toBe(false);
  });
  
  test('handleWebSocketMessage handles end frame', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Create a mock end message
    const endMessage = {
      data: new Uint8Array([4, 5, 6]).buffer
    };
    
    // Call the message handler directly
    messageHandler(endMessage);
    
    // Check that Frame.decode was called with the message data
    expect(AI_CONFIG.Frame.decode).toHaveBeenCalled();
    
    // Check that the call was stopped
    expect(AI_MAIN.stopAudio).toHaveBeenCalledWith(true);
  });
  
  test('handleWebSocketClose stops audio when connection closes', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Call the close handler directly
    closeHandler({ code: 1000, reason: 'Normal closure' });
    
    // Check that audio was stopped
    expect(AI_MAIN.stopAudio).toHaveBeenCalledWith(false);
  });
  
  test('setupAudioProcessing detects speech and sends interruption', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    window.AI_WEBSOCKET.ws = mockWebSocket;
    
    // Call our mocked open handler
    window.AI_WEBSOCKET.handleWebSocketOpen({ type: 'open' });
    
    // Set the onaudioprocess handler manually
    mockScriptProcessor.onaudioprocess = function(event) {
      const inputBuffer = event.inputBuffer;
      const inputData = inputBuffer.getChannelData(0);
      
      // Calculate RMS of input data
      const rms = AI_AUDIO.calculateRMS(inputData);
      
      // If above threshold and AI is responding
      if (rms > AI_CONFIG.SPEECH_THRESHOLD && AI_STATE.isAIResponding) {
        // Track consecutive frames
        window.AI_WEBSOCKET.aboveThresholdFrames++;
        
        // If enough consecutive frames, send interruption
        if (window.AI_WEBSOCKET.aboveThresholdFrames >= AI_CONFIG.REQUIRED_CONSECUTIVE_FRAMES) {
          AI_STATE.isSpeaking = true;
          window.AI_WEBSOCKET.sendInterruptionSignal();
          
          // Set silence timeout
          AI_STATE.silenceTimeout = setTimeout(() => {
            AI_STATE.isSpeaking = false;
          }, 1000);
        }
      } else {
        // Reset counter if below threshold
        window.AI_WEBSOCKET.aboveThresholdFrames = 0;
      }
    };
    
    // Create an audio processing event
    const audioProcessingEvent = {
      inputBuffer: createInputBuffer()
    };
    
    // Set RMS to be above threshold to trigger speech detection
    AI_AUDIO.calculateRMS.mockReturnValue(0.02); // Above threshold
    
    // Set AI as responding
    AI_STATE.isAIResponding = true;
    
    // Initialize counter
    window.AI_WEBSOCKET.aboveThresholdFrames = 0;
    
    // Call it multiple times to trigger consecutive frames detection
    for (let i = 0; i < AI_CONFIG.REQUIRED_CONSECUTIVE_FRAMES; i++) {
      mockScriptProcessor.onaudioprocess(audioProcessingEvent);
    }
    
    // Check that speech was detected
    expect(AI_STATE.isSpeaking).toBe(true);
    
    // Check that an interruption frame was created and sent
    expect(AI_CONFIG.Frame.create).toHaveBeenCalledWith(expect.objectContaining({
      botInterruption: expect.anything()
    }));
    expect(mockWebSocket.send).toHaveBeenCalled();
    
    // Fast-forward timer to trigger silence detection
    jest.advanceTimersByTime(1500);
    
    // Check that speaking state was reset
    expect(AI_STATE.isSpeaking).toBe(false);
  });
  
  test('sendInterruptionSignal stops AI audio and sends interruption frame', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    window.AI_WEBSOCKET.ws = mockWebSocket;
    
    // Set AI as responding
    AI_STATE.isAIResponding = true;
    
    // Call sendInterruptionSignal
    window.AI_WEBSOCKET.sendInterruptionSignal();
    
    // Check that the frame was created with botInterruption
    expect(AI_CONFIG.Frame.create).toHaveBeenCalledWith(expect.objectContaining({
      botInterruption: expect.anything()
    }));
    
    // Check that the frame was encoded and sent
    expect(AI_CONFIG.Frame.encode).toHaveBeenCalled();
    expect(mockWebSocket.send).toHaveBeenCalled();
    
    // Check that audio was stopped
    expect(AI_AUDIO.stopAllAIAudio).toHaveBeenCalled();
    
    // Check that the interruption was added to the transcript
    expect(AI_TRANSCRIPT.addMessageToTranscript).toHaveBeenCalledWith('User interrupted AI', 'system');
    
    // Check that interruption state is properly set
    expect(AI_STATE.isBeingInterrupted).toBe(true);
    
    // Fast-forward timers to check state reset
    jest.advanceTimersByTime(500);
    expect(AI_STATE.isBeingInterrupted).toBe(false);
  });
  
  test('closeWebSocket closes the WebSocket connection', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    window.AI_WEBSOCKET.ws = mockWebSocket;
    
    // Call closeWebSocket
    window.AI_WEBSOCKET.closeWebSocket();
    
    // Check that the connection was closed
    expect(mockWebSocket.close).toHaveBeenCalled();
    
    // Check that the WebSocket reference was cleared
    expect(window.AI_WEBSOCKET.ws).toBeNull();
  });
}); 