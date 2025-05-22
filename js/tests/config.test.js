/**
 * Tests for config.js
 */

// Save original globals
const originalWindow = global.window;

// Mock window
global.window = {};

// Import the module under test
require('../config.js');

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
    // Check that Frame is exported and has required methods
    expect(global.AI_CONFIG.Frame).toBeDefined();
    expect(typeof global.AI_CONFIG.Frame.decode).toBe('function');
    expect(typeof global.AI_CONFIG.Frame.create).toBe('function');
    expect(typeof global.AI_CONFIG.Frame.encode).toBe('function');
  });
}); 