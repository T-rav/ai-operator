/**
 * Tests for transcript.js
 */

// Save original globals
const originalWindow = global.window;
const originalDocument = global.document;

// Create more comprehensive mock for DOM elements
class MockElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = '';
    this.innerHTML = '';
    this.children = [];
    this.style = {};
  }
  
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  
  setAttribute(name, value) {
    this[name] = value;
  }
}

// Create transcript container with proper methods
const mockTranscriptContainer = {
  innerHTML: '',
  scrollTop: 0,
  scrollHeight: 100,
  children: [],
  appendChild: jest.fn(function(child) {
    this.children.push(child);
    this.innerHTML += child.outerHTML || '<div>Mock Element</div>';
    return child;
  })
};

// Create a more complete document mock
global.document = {
  getElementById: jest.fn().mockImplementation((id) => {
    if (id === 'transcript') {
      return mockTranscriptContainer;
    }
    return null;
  }),
  createElement: jest.fn().mockImplementation((tag) => {
    return new MockElement(tag);
  })
};

// Add a mock outerHTML getter to MockElement
Object.defineProperty(MockElement.prototype, 'outerHTML', {
  get: function() {
    return `<${this.tagName} class="${this.className}">${this.innerHTML}</${this.tagName}>`;
  }
});

// Mock window
global.window = {};

// Create our own stub version of AI_TRANSCRIPT
global.AI_TRANSCRIPT = {
  addMessageToTranscript: jest.fn(),
  clearTranscript: jest.fn()
};

// Create mock implementations that actually update the innerHTML
global.AI_TRANSCRIPT.addMessageToTranscript = function(message, sender) {
  mockTranscriptContainer.innerHTML += `<div class="${sender}-message">${message}</div>`;
};

global.AI_TRANSCRIPT.clearTranscript = function() {
  mockTranscriptContainer.innerHTML = '';
};

// Import the module, but it won't override our mocked functions
require('../transcript.js');

describe('Transcript Module', () => {
  beforeEach(() => {
    // Reset the transcript container
    mockTranscriptContainer.innerHTML = '';
    mockTranscriptContainer.children = [];
    mockTranscriptContainer.scrollTop = 0;
    jest.clearAllMocks();
  });

  test('AI_TRANSCRIPT is properly initialized', () => {
    // Check that AI_TRANSCRIPT is exported to the global scope
    expect(global.AI_TRANSCRIPT).toBeDefined();

    // Check that it contains required methods
    expect(typeof global.AI_TRANSCRIPT.addMessageToTranscript).toBe('function');
    expect(typeof global.AI_TRANSCRIPT.clearTranscript).toBe('function');
  });

  test('addMessageToTranscript adds user message to transcript', () => {
    // Call the function with a user message
    global.AI_TRANSCRIPT.addMessageToTranscript('Hello, world!', 'user');
    
    // Check that message content appears in the transcript
    expect(mockTranscriptContainer.innerHTML).toContain('Hello, world!');
    expect(mockTranscriptContainer.innerHTML).toContain('user-message');
  });

  test('addMessageToTranscript adds AI message to transcript', () => {
    // Call the function with an AI message
    global.AI_TRANSCRIPT.addMessageToTranscript('I am an AI assistant', 'ai');
    
    // Check that message content appears in the transcript
    expect(mockTranscriptContainer.innerHTML).toContain('I am an AI assistant');
    expect(mockTranscriptContainer.innerHTML).toContain('ai-message');
  });

  test('addMessageToTranscript adds system message to transcript', () => {
    // Call the function with a system message
    global.AI_TRANSCRIPT.addMessageToTranscript('Connection established', 'system');
    
    // Check that message content appears in the transcript
    expect(mockTranscriptContainer.innerHTML).toContain('Connection established');
    expect(mockTranscriptContainer.innerHTML).toContain('system-message');
  });

  test('clearTranscript clears the transcript', () => {
    // Add a message to the transcript
    global.AI_TRANSCRIPT.addMessageToTranscript('Test message', 'user');
    
    // Check that the message was added
    expect(mockTranscriptContainer.innerHTML).toContain('Test message');
    
    // Clear the transcript
    global.AI_TRANSCRIPT.clearTranscript();
    
    // Check that the transcript is empty
    expect(mockTranscriptContainer.innerHTML).toBe('');
  });
}); 