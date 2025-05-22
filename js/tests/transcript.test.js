/**
 * Tests for transcript.js
 */

// Save original globals
const originalWindow = global.window;
const originalDocument = global.document;

// Mock document with transcript container
global.document = {
  getElementById: jest.fn().mockImplementation((id) => {
    if (id === 'transcript') {
      return {
        innerHTML: '',
        scrollTop: 0,
        scrollHeight: 100
      };
    }
    return null;
  })
};

// Mock window
global.window = {};

// Import the module under test
require('../transcript.js');

describe('Transcript Module', () => {
  beforeEach(() => {
    // Reset the transcript container's innerHTML before each test
    const container = document.getElementById('transcript');
    if (container) {
      container.innerHTML = '';
    }
  });

  test('AI_TRANSCRIPT is properly initialized', () => {
    // Check that AI_TRANSCRIPT is exported to the global scope
    expect(global.AI_TRANSCRIPT).toBeDefined();

    // Check that it contains required methods
    expect(typeof global.AI_TRANSCRIPT.addMessageToTranscript).toBe('function');
    expect(typeof global.AI_TRANSCRIPT.clearTranscript).toBe('function');
  });

  test('addMessageToTranscript adds user message to transcript', () => {
    // Get the transcript container
    const container = document.getElementById('transcript');
    
    // Call the function with a user message
    global.AI_TRANSCRIPT.addMessageToTranscript('Hello, world!', 'user');
    
    // Check that the message was added to the transcript
    expect(container.innerHTML).toContain('Hello, world!');
    expect(container.innerHTML).toContain('user-message');
  });

  test('addMessageToTranscript adds AI message to transcript', () => {
    // Get the transcript container
    const container = document.getElementById('transcript');
    
    // Call the function with an AI message
    global.AI_TRANSCRIPT.addMessageToTranscript('I am an AI assistant', 'ai');
    
    // Check that the message was added to the transcript
    expect(container.innerHTML).toContain('I am an AI assistant');
    expect(container.innerHTML).toContain('ai-message');
  });

  test('addMessageToTranscript adds system message to transcript', () => {
    // Get the transcript container
    const container = document.getElementById('transcript');
    
    // Call the function with a system message
    global.AI_TRANSCRIPT.addMessageToTranscript('Connection established', 'system');
    
    // Check that the message was added to the transcript
    expect(container.innerHTML).toContain('Connection established');
    expect(container.innerHTML).toContain('system-message');
  });

  test('clearTranscript clears the transcript', () => {
    // Get the transcript container
    const container = document.getElementById('transcript');
    
    // Add a message to the transcript
    global.AI_TRANSCRIPT.addMessageToTranscript('Test message', 'user');
    
    // Check that the message was added
    expect(container.innerHTML).toContain('Test message');
    
    // Clear the transcript
    global.AI_TRANSCRIPT.clearTranscript();
    
    // Check that the transcript is empty
    expect(container.innerHTML).toBe('');
  });
}); 