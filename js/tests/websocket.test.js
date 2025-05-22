/**
 * Tests for websocket.js
 */

// Mock global window object
global.window = {};

// Mock the WebSocket class
const mockWebSocket = {
  addEventListener: jest.fn(),
  send: jest.fn(),
  close: jest.fn(),
  binaryType: null
};

global.WebSocket = jest.fn().mockImplementation(() => mockWebSocket);

// Create a more comprehensive mock for navigator
const mockMediaStream = {
  getTracks: jest.fn().mockReturnValue([
    { stop: jest.fn() }
  ])
};

// Mock getUserMedia with proper Promise
const mockGetUserMedia = jest.fn().mockImplementation(() => {
  return Promise.resolve(mockMediaStream);
});

// Set up navigator mock
global.navigator = {
  mediaDevices: {
    getUserMedia: mockGetUserMedia
  }
};

// Mock global objects needed by the WebSocket module
global.AI_CONFIG = {
  SAMPLE_RATE: 16000,
  NUM_CHANNELS: 1,
  SPEECH_THRESHOLD: 0.01,
  REQUIRED_CONSECUTIVE_FRAMES: 3,
  Frame: {
    decode: jest.fn().mockImplementation((data) => {
      // Use type checking to avoid issues with test data
      const dataArray = new Uint8Array(data);
      
      // Different return values based on the test data
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

global.AI_STATE = {
  isPlaying: true,
  isAIResponding: false,
  isSpeaking: false,
  isBeingInterrupted: false,
  silenceTimeout: null
};

const mockAudioContext = {
  createScriptProcessor: jest.fn().mockReturnValue({
    connect: jest.fn(),
    onaudioprocess: null
  }),
  destination: {},
  currentTime: 0
};

global.AI_AUDIO = {
  audioContext: mockAudioContext,
  convertFloat32ToS16PCM: jest.fn().mockReturnValue(new Int16Array(10)),
  calculateRMS: jest.fn().mockReturnValue(0.005), // Below threshold by default
  enqueueAudioFromProto: jest.fn(),
  stopAllAIAudio: jest.fn(),
  source: null,
  analyser: null,
  dataArray: null,
  activeAudioSources: [],
  resetAIResponseTimeout: jest.fn()
};

global.AI_MAIN = {
  stopAudio: jest.fn()
};

global.AI_TRANSCRIPT = {
  addMessageToTranscript: jest.fn()
};

global.AI_VISUALIZER = {
  drawVisualizer: jest.fn()
};

// Use fake timers for setTimeout/clearTimeout
jest.useFakeTimers();

// Mock the buffer handling for onaudioprocess
const createInputBuffer = () => ({
  getChannelData: jest.fn().mockReturnValue(new Float32Array(512))
});

// Store event handlers so we can manually trigger them
const eventHandlers = {
  open: null,
  message: null,
  close: null,
  error: null
};

// Override addEventListener to capture handlers
mockWebSocket.addEventListener.mockImplementation((event, handler) => {
  eventHandlers[event] = handler;
});

// Import the WebSocket module now that we've set up mocks
require('../websocket.js');

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
    
    // Reset event handlers
    Object.keys(eventHandlers).forEach(key => {
      eventHandlers[key] = null;
    });
  });
  
  test('initWebSocket creates a WebSocket connection', () => {
    window.AI_WEBSOCKET.initWebSocket();
    
    expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:8765');
    expect(mockWebSocket.binaryType).toBe('arraybuffer');
    expect(mockWebSocket.addEventListener).toHaveBeenCalledWith('open', expect.any(Function));
    expect(mockWebSocket.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockWebSocket.addEventListener).toHaveBeenCalledWith('close', expect.any(Function));
    expect(mockWebSocket.addEventListener).toHaveBeenCalledWith('error', expect.any(Function));
  });
  
  test('handleWebSocketOpen requests user media and sets up audio', async () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Get the handler from our mock
    const openHandler = eventHandlers.open;
    expect(openHandler).toBeDefined();
    
    // Call the handler with a mock event
    await openHandler({ type: 'open' });
    
    // Wait for promises to resolve
    await new Promise(process.nextTick);
    
    // Check that getUserMedia was called with the right parameters
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        sampleRate: AI_CONFIG.SAMPLE_RATE,
        channelCount: AI_CONFIG.NUM_CHANNELS,
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      }
    });
    
    // Verify audio setup
    expect(AI_AUDIO.audioContext.createScriptProcessor).toHaveBeenCalled();
    expect(AI_VISUALIZER.drawVisualizer).toHaveBeenCalled();
  });
  
  test('handleWebSocketMessage handles transcription messages', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Get the message handler
    const messageHandler = eventHandlers.message;
    expect(messageHandler).toBeDefined();
    
    // Create a mock transcription message
    const transcriptionMessage = {
      data: new Uint8Array([1, 2, 3])
    };
    
    // Call the handler
    messageHandler(transcriptionMessage);
    
    // Check that Frame.decode was called with the message data
    expect(AI_CONFIG.Frame.decode).toHaveBeenCalled();
    
    // Check that the transcription was added to the transcript
    expect(AI_TRANSCRIPT.addMessageToTranscript).toHaveBeenCalledWith('Test transcription', 'user');
  });
  
  test('handleWebSocketMessage handles audio messages', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Get the message handler
    const messageHandler = eventHandlers.message;
    
    // Create a mock audio message
    const audioMessage = {
      data: new Uint8Array([2, 3, 4])
    };
    
    // Call the handler
    messageHandler(audioMessage);
    
    // Check that Frame.decode was called with the message data
    expect(AI_CONFIG.Frame.decode).toHaveBeenCalled();
    
    // Check that the audio was processed
    expect(AI_AUDIO.enqueueAudioFromProto).toHaveBeenCalledWith(audioMessage.data);
  });
  
  test('handleWebSocketMessage handles bot interruption', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Get the message handler
    const messageHandler = eventHandlers.message;
    
    // Create a mock interruption message
    const interruptionMessage = {
      data: new Uint8Array([3, 4, 5])
    };
    
    // Call the handler
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
    
    // Get the message handler
    const messageHandler = eventHandlers.message;
    
    // Create a mock end message
    const endMessage = {
      data: new Uint8Array([4, 5, 6])
    };
    
    // Call the handler
    messageHandler(endMessage);
    
    // Check that Frame.decode was called with the message data
    expect(AI_CONFIG.Frame.decode).toHaveBeenCalled();
    
    // Check that the call was stopped
    expect(AI_MAIN.stopAudio).toHaveBeenCalledWith(true);
  });
  
  test('handleWebSocketClose stops audio when connection closes', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Get the close handler
    const closeHandler = eventHandlers.close;
    expect(closeHandler).toBeDefined();
    
    // Call the handler with a mock event
    closeHandler({ code: 1000, reason: 'Normal closure' });
    
    // Check that audio was stopped
    expect(AI_MAIN.stopAudio).toHaveBeenCalledWith(false);
  });
  
  test('setupAudioProcessing detects speech and sends interruption', () => {
    // Initialize WebSocket
    window.AI_WEBSOCKET.initWebSocket();
    
    // Set up audio processing
    window.AI_WEBSOCKET.ws = mockWebSocket;
    
    // Get the scriptProcessor
    const scriptProcessor = AI_AUDIO.audioContext.createScriptProcessor.mock.results[0].value;
    expect(scriptProcessor).toBeDefined();
    
    // Create a mock audio processing event
    const audioProcessingEvent = {
      inputBuffer: createInputBuffer()
    };
    
    // Mock RMS to detect speech
    AI_AUDIO.calculateRMS.mockReturnValue(0.02); // Above threshold
    
    // Set AI as responding
    AI_STATE.isAIResponding = true;
    
    // Manually call onaudioprocess multiple times to trigger speech detection
    for (let i = 0; i < AI_CONFIG.REQUIRED_CONSECUTIVE_FRAMES; i++) {
      // Set audio processor callback
      if (scriptProcessor.onaudioprocess) {
        scriptProcessor.onaudioprocess(audioProcessingEvent);
      }
    }
    
    // Check that RMS was calculated
    expect(AI_AUDIO.calculateRMS).toHaveBeenCalled();
    
    // Check that speech was detected
    expect(AI_STATE.isSpeaking).toBe(true);
    
    // Check that interruption was sent
    expect(AI_CONFIG.Frame.create).toHaveBeenCalledWith(expect.objectContaining({
      botInterruption: expect.anything()
    }));
    
    // Check that a timeout was set
    expect(setTimeout).toHaveBeenCalled();
    
    // Fast-forward to trigger silence detection
    jest.advanceTimersByTime(1500);
    
    // Check that speech state was reset
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
    
    // Check that the frame was created
    expect(AI_CONFIG.Frame.create).toHaveBeenCalledWith(expect.objectContaining({
      botInterruption: expect.anything()
    }));
    
    // Check that the frame was encoded
    expect(AI_CONFIG.Frame.encode).toHaveBeenCalled();
    
    // Check that the frame was sent
    expect(mockWebSocket.send).toHaveBeenCalled();
    
    // Check that audio was stopped
    expect(AI_AUDIO.stopAllAIAudio).toHaveBeenCalled();
    
    // Check that AI state was updated
    expect(AI_STATE.isAIResponding).toBe(false);
    
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