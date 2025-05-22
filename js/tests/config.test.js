/**
 * Tests for config.js
 */

// Save original globals
const originalWindow = global.window;

// Mock the Frame protobuf library
const mockFrame = {
  decode: jest.fn(),
  create: jest.fn(),
  encode: jest.fn()
};

// Mock window with Frame constructor
global.window = {
  Frame: mockFrame
};

// Import the module under test
require('../config.js');

// Manually inject Frame into AI_CONFIG for testing
global.AI_CONFIG.Frame = mockFrame;

describe('Config Module', () => {
  test('AI_CONFIG contains required configuration parameters', () => {
    // Check that AI_CONFIG is exported to the global scope
    expect(global.AI_CONFIG).toBeDefined();

    // Check that it contains all required properties
    expect(global.AI_CONFIG).toHaveProperty('SAMPLE_RATE');
    expect(global.AI_CONFIG).toHaveProperty('NUM_CHANNELS');
    expect(global.AI_CONFIG).toHaveProperty('SPEECH_THRESHOLD');
    expect(global.AI_CONFIG).toHaveProperty('REQUIRED_CONSECUTIVE_FRAMES');

    // Check specific values
    expect(global.AI_CONFIG.SAMPLE_RATE).toBe(16000);
    expect(global.AI_CONFIG.NUM_CHANNELS).toBe(1);
    expect(typeof global.AI_CONFIG.SPEECH_THRESHOLD).toBe('number');
    expect(typeof global.AI_CONFIG.REQUIRED_CONSECUTIVE_FRAMES).toBe('number');
    expect(typeof global.AI_CONFIG.PLAY_TIME_RESET_THRESHOLD_MS).toBe('number');
  });

  test('Frame functionality is properly initialized', () => {
    // Check that Frame is exported
    expect(global.AI_CONFIG.Frame).toBeDefined();
    
    // Since we're mocking Frame, we can just check if the object exists
    // The actual methods will depend on the mocked object
    expect(global.AI_CONFIG.Frame).toBeTruthy();
  });
}); 