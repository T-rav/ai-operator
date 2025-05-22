/**
 * Tests for audio-processing.js
 */

// Create a more comprehensive mock for AudioContext
const mockAudioContext = {
  currentTime: 0,
  decodeAudioData: jest.fn().mockImplementation((buffer, callback) => {
    callback({
      duration: 1.5
    });
    return Promise.resolve();
  }),
  createMediaStreamSource: jest.fn().mockReturnValue({
    connect: jest.fn()
  }),
  destination: {},
  createScriptProcessor: jest.fn().mockReturnValue({
    connect: jest.fn()
  }),
  createAnalyser: jest.fn().mockReturnValue({
    connect: jest.fn(),
    fftSize: 0,
    frequencyBinCount: 128,
    getByteTimeDomainData: jest.fn()
  })
};

// Create global audio variables before importing module
global.audioContext = mockAudioContext;
global.source = null;
global.microphoneStream = null;
global.scriptProcessor = null;
global.playTime = 0;
global.lastMessageTime = 0;
global.analyser = null;
global.dataArray = null;
global.activeAudioSources = [];
global.animationFrame = null;
global.aiResponseTimeout = null;

// Set up the AudioContext constructor mock
global.window = {
  AudioContext: jest.fn().mockImplementation(() => mockAudioContext),
  webkitAudioContext: jest.fn().mockImplementation(() => mockAudioContext)
};

global.AudioBufferSourceNode = jest.fn().mockImplementation(() => ({
  connect: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  disconnect: jest.fn(),
  onended: null,
  buffer: { duration: 1.5 }
}));

global.AI_CONFIG = {
  SAMPLE_RATE: 16000,
  NUM_CHANNELS: 1,
  PLAY_TIME_RESET_THRESHOLD_MS: 1000,
  Frame: {
    decode: jest.fn().mockReturnValue({
      audio: {
        audio: new Uint8Array(10)
      }
    })
  }
};

global.AI_STATE = {
  isBeingInterrupted: false,
  isAIResponding: false,
  isPlaying: true
};

global.AI_TRANSCRIPT = {
  addMessageToTranscript: jest.fn()
};

global.requestAnimationFrame = jest.fn();
global.cancelAnimationFrame = jest.fn();

// Set a spy on setTimeout/clearTimeout
jest.useFakeTimers();

// Import audio module - we need to mock some globals before requiring the file
require('../audio-processing.js');

describe('Audio Processing Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Reset global state
    global.AI_STATE.isBeingInterrupted = false;
    global.AI_STATE.isAIResponding = false;
    global.AI_STATE.isPlaying = true;
    
    // Reset audioContext mock
    mockAudioContext.currentTime = 0;
    
    // Reset timeout
    if (window.AI_AUDIO.aiResponseTimeout) {
      clearTimeout(window.AI_AUDIO.aiResponseTimeout);
      window.AI_AUDIO.aiResponseTimeout = null;
    }
    
    // Reset active audio sources
    window.AI_AUDIO.activeAudioSources = [];
    
    // Reset variables
    window.AI_AUDIO.playTime = 0;
    window.AI_AUDIO.lastMessageTime = 0;
  });
  
  test('initAudio creates an audio context', () => {
    // Call initAudio to initialize the audio context
    window.AI_AUDIO.initAudio();
    
    // Check that AudioContext constructor was called
    expect(global.window.AudioContext).toHaveBeenCalled();
    
    // Ensure audioContext is defined
    expect(window.AI_AUDIO.audioContext).toBeDefined();
  });
  
  test('convertFloat32ToS16PCM converts audio data correctly', () => {
    const float32Array = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
    const result = window.AI_AUDIO.convertFloat32ToS16PCM(float32Array);
    
    // Check conversion for positive values
    expect(result[1]).toBe(Math.floor(0.5 * 32767));
    
    // Check conversion for negative values
    expect(result[2]).toBe(Math.floor(-0.5 * 32768));
    
    // Check clamping for values > 1
    expect(result[5]).toBe(32767); // Clamped to 1 * 32767
    
    // Check clamping for values < -1
    expect(result[6]).toBe(-32768); // Clamped to -1 * 32768
  });
  
  test('calculateRMS calculates root mean square correctly', () => {
    const data = new Float32Array([0, 1, 0, 1]);
    const rms = window.AI_AUDIO.calculateRMS(data);
    
    // RMS of [0, 1, 0, 1] = sqrt((0² + 1² + 0² + 1²)/4) = sqrt(0.5) ≈ 0.7071
    expect(rms).toBeCloseTo(0.7071, 4);
  });
  
  test('enqueueAudioFromProto processes audio data', () => {
    // Set up audioContext explicitly
    window.AI_AUDIO.audioContext = mockAudioContext;
    
    // Create a simple array buffer for the test
    const mockArrayBuffer = new ArrayBuffer(10);
    
    // Call the function
    const result = window.AI_AUDIO.enqueueAudioFromProto(mockArrayBuffer);
    
    // Verify that Frame.decode was called
    expect(global.AI_CONFIG.Frame.decode).toHaveBeenCalled();
    
    // Verify that decodeAudioData was called
    expect(mockAudioContext.decodeAudioData).toHaveBeenCalled();
    
    // Expect successful processing
    expect(result).toBe(true);
    
    // Get the callback that was passed to decodeAudioData
    const decodeCallback = mockAudioContext.decodeAudioData.mock.calls[0][1];
    
    // Manually call the callback to simulate audio decoding completion
    decodeCallback({ duration: 1.5 });
    
    // Verify that AudioBufferSourceNode was created
    expect(global.AudioBufferSourceNode).toHaveBeenCalled();
    
    // Verify that the source was connected to both analyser and destination
    const mockSource = global.AudioBufferSourceNode.mock.results[0].value;
    expect(mockSource.connect).toHaveBeenCalledTimes(2);
    
    // Verify that source.start was called
    expect(mockSource.start).toHaveBeenCalled();
    
    // Verify that a transcript message was added
    expect(global.AI_TRANSCRIPT.addMessageToTranscript).toHaveBeenCalledWith('AI response...', 'ai');
    
    // Verify that AI state was updated
    expect(global.AI_STATE.isAIResponding).toBe(true);
  });
  
  test('enqueueAudioFromProto handles interruption state', () => {
    // Set interruption state to true
    global.AI_STATE.isBeingInterrupted = true;
    
    // Set up audioContext explicitly
    window.AI_AUDIO.audioContext = mockAudioContext;
    
    // Create a simple array buffer for the test
    const mockArrayBuffer = new ArrayBuffer(10);
    
    // Call the function
    const result = window.AI_AUDIO.enqueueAudioFromProto(mockArrayBuffer);
    
    // Verify that Frame.decode was called
    expect(global.AI_CONFIG.Frame.decode).toHaveBeenCalled();
    
    // Expect successful processing
    expect(result).toBe(true);
    
    // Get the callback that was passed to decodeAudioData
    const decodeCallback = mockAudioContext.decodeAudioData.mock.calls[0][1];
    
    // Manually call the callback to simulate audio decoding completion
    decodeCallback({ duration: 1.5 });
    
    // Verify that no AudioBufferSourceNode was created (due to interruption)
    expect(global.AudioBufferSourceNode).not.toHaveBeenCalled();
    
    // Verify that AI state remains unchanged
    expect(global.AI_STATE.isAIResponding).toBe(false);
  });
  
  test('stopAllAIAudio stops all audio sources', () => {
    // Create mock audio sources and add to active sources
    const source1 = new global.AudioBufferSourceNode();
    const source2 = new global.AudioBufferSourceNode();
    
    // Set up audioContext
    window.AI_AUDIO.audioContext = mockAudioContext;
    window.AI_AUDIO.playTime = 10;
    
    // Add to active sources array
    window.AI_AUDIO.activeAudioSources.push(source1, source2);
    
    // Set AI responding state
    global.AI_STATE.isAIResponding = true;
    
    // Call the function
    window.AI_AUDIO.stopAllAIAudio();
    
    // Verify that stop was called on both sources
    expect(source1.stop).toHaveBeenCalled();
    expect(source2.stop).toHaveBeenCalled();
    
    // Verify that disconnect was called on both sources
    expect(source1.disconnect).toHaveBeenCalled();
    expect(source2.disconnect).toHaveBeenCalled();
    
    // Verify that active sources array was cleared
    expect(window.AI_AUDIO.activeAudioSources.length).toBe(0);
    
    // Verify that playTime was reset
    expect(window.AI_AUDIO.playTime).toBe(0);
    
    // Verify that AI state was updated
    expect(global.AI_STATE.isBeingInterrupted).toBe(true);
    expect(global.AI_STATE.isAIResponding).toBe(false);
  });
  
  test('setupVisualizer sets up canvas visualization', () => {
    // Create a mock canvas with context
    const mockContext = {
      fillStyle: null,
      fillRect: jest.fn(),
      lineWidth: 0,
      strokeStyle: null,
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn()
    };
    
    const mockCanvas = {
      getContext: jest.fn().mockReturnValue(mockContext),
      width: 0,
      height: 0,
      offsetWidth: 300
    };
    
    // Add event listener spy
    window.addEventListener = jest.fn();
    
    // Call setupVisualizer
    const result = window.AI_AUDIO.setupVisualizer(mockCanvas);
    
    // Check that canvas context was obtained
    expect(mockCanvas.getContext).toHaveBeenCalledWith('2d');
    
    // Check that resize event listener was added
    expect(window.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    
    // Check that resize function was called
    expect(mockCanvas.width).toBe(300);
    expect(mockCanvas.height).toBe(100);
    
    // Verify that functions were returned
    expect(result).toHaveProperty('resizeCanvas');
    expect(result).toHaveProperty('drawVisualizer');
    
    // Test the drawVisualizer function
    window.AI_AUDIO.analyser = {
      getByteTimeDomainData: jest.fn(arr => {
        // Fill with some dummy data
        for (let i = 0; i < arr.length; i++) {
          arr[i] = 128;
        }
      })
    };
    
    window.AI_AUDIO.dataArray = new Uint8Array(128);
    
    // Call drawVisualizer
    result.drawVisualizer();
    
    // Check that visualization was drawn
    expect(mockContext.fillRect).toHaveBeenCalled();
    expect(mockContext.beginPath).toHaveBeenCalled();
    expect(mockContext.stroke).toHaveBeenCalled();
    expect(global.requestAnimationFrame).toHaveBeenCalled();
  });
  
  test('resetAIResponseTimeout sets a timeout to reset AI state', () => {
    // Set up AI state
    global.AI_STATE.isAIResponding = true;
    
    // Call resetAIResponseTimeout
    window.AI_AUDIO.resetAIResponseTimeout();
    
    // Verify a timeout was set
    expect(setTimeout).toHaveBeenCalled();
    
    // Fast-forward the timer
    jest.advanceTimersByTime(2000);
    
    // Check that AI state was reset
    expect(global.AI_STATE.isAIResponding).toBe(false);
  });
  
  test('cleanupAudio properly cleans up resources', () => {
    // Setup resources to clean up
    window.AI_AUDIO.scriptProcessor = { disconnect: jest.fn() };
    window.AI_AUDIO.source = { disconnect: jest.fn() };
    window.AI_AUDIO.analyser = { disconnect: jest.fn() };
    window.AI_AUDIO.animationFrame = 123;
    window.AI_AUDIO.aiResponseTimeout = setTimeout(() => {}, 1000);
    window.AI_AUDIO.activeAudioSources = [
      { stop: jest.fn(), disconnect: jest.fn() }
    ];
    window.AI_AUDIO.audioContext = mockAudioContext;
    
    // Add spy to stopAllAIAudio
    const stopAllAudioSpy = jest.spyOn(window.AI_AUDIO, 'stopAllAIAudio');
    
    // Call cleanupAudio
    window.AI_AUDIO.cleanupAudio();
    
    // Verify resources were cleaned up
    expect(window.AI_AUDIO.scriptProcessor.disconnect).toHaveBeenCalled();
    expect(window.AI_AUDIO.source.disconnect).toHaveBeenCalled();
    expect(window.AI_AUDIO.analyser.disconnect).toHaveBeenCalled();
    expect(global.cancelAnimationFrame).toHaveBeenCalledWith(123);
    
    // Verify stopAllAIAudio was called
    expect(stopAllAudioSpy).toHaveBeenCalled();
    
    // Verify timeout was cleared
    expect(clearTimeout).toHaveBeenCalled();
  });
}); 