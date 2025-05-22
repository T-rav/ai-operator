/**
 * Tests for state.js
 */

// Save original globals
const originalWindow = global.window;

// Mock window
global.window = {};

// Import the module under test
require('../state.js');

describe('State Module', () => {
  test('AI_STATE initializes with default values', () => {
    // Check that AI_STATE is exported to the global scope
    expect(global.AI_STATE).toBeDefined();

    // Check that it contains all required properties
    expect(global.AI_STATE).toHaveProperty('isPlaying');
    expect(global.AI_STATE).toHaveProperty('isAIResponding');
    expect(global.AI_STATE).toHaveProperty('isSpeaking');
    expect(global.AI_STATE).toHaveProperty('isBeingInterrupted');
    expect(global.AI_STATE).toHaveProperty('silenceTimeout');

    // Check default values
    expect(global.AI_STATE.isPlaying).toBe(false);
    expect(global.AI_STATE.isAIResponding).toBe(false);
    expect(global.AI_STATE.isSpeaking).toBe(false);
    expect(global.AI_STATE.isBeingInterrupted).toBe(false);
    expect(global.AI_STATE.silenceTimeout).toBeNull();
  });
}); 