/**
 * Tests for visualizer.js
 */

// Save original globals
const originalWindow = global.window;
const originalDocument = global.document;

// Create mock canvas
const mockCanvasContext = {
  fillStyle: null,
  fillRect: jest.fn(),
  beginPath: jest.fn(),
  stroke: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  strokeStyle: null,
  lineWidth: 0
};

const mockCanvas = {
  width: 800,
  height: 200,
  getContext: jest.fn().mockReturnValue(mockCanvasContext)
};

// Mock document with visualizer canvas
global.document = {
  getElementById: jest.fn().mockImplementation((id) => {
    if (id === 'visualizer') {
      return mockCanvas;
    }
    return null;
  })
};

// Mock window
global.window = {
  addEventListener: jest.fn()
};

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn();

// Import the module under test
require('../visualizer.js');

describe('Visualizer Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Reset canvas properties
    mockCanvas.width = 800;
    mockCanvas.height = 200;
  });

  test('AI_VISUALIZER is properly initialized', () => {
    // Check that AI_VISUALIZER is exported to the global scope
    expect(global.AI_VISUALIZER).toBeDefined();

    // Check that it contains required methods
    expect(typeof global.AI_VISUALIZER.drawVisualizer).toBe('function');
    expect(typeof global.AI_VISUALIZER.setContext).toBe('function');
    expect(typeof global.AI_VISUALIZER.resizeCanvas).toBe('function');
  });

  test('setContext sets the visualizer context', () => {
    // Call the function
    global.AI_VISUALIZER.setContext(mockCanvasContext);
    
    // Check that the context was set
    expect(global.AI_VISUALIZER.canvasContext).toBe(mockCanvasContext);
  });

  test('resizeCanvas resizes the canvas', () => {
    // Get the original dimensions
    const originalWidth = mockCanvas.width;
    const originalHeight = mockCanvas.height;
    
    // Set a new width that should trigger a resize
    mockCanvas.width = 1200;
    
    // Call the function
    global.AI_VISUALIZER.resizeCanvas();
    
    // Check that the canvas height was updated proportionally
    expect(mockCanvas.height).not.toBe(originalHeight);
    
    // Reset for next test
    mockCanvas.width = originalWidth;
    mockCanvas.height = originalHeight;
  });

  test('drawVisualizer does nothing if no context is set', () => {
    // Remove the context
    const originalContext = global.AI_VISUALIZER.canvasContext;
    global.AI_VISUALIZER.canvasContext = null;
    
    // Call the function
    global.AI_VISUALIZER.drawVisualizer();
    
    // Check that no drawing operations were performed
    expect(mockCanvasContext.fillRect).not.toHaveBeenCalled();
    expect(mockCanvasContext.beginPath).not.toHaveBeenCalled();
    
    // Restore the context for other tests
    global.AI_VISUALIZER.canvasContext = originalContext;
  });

  test('drawVisualizer draws to the canvas when context is set', () => {
    // Ensure the context is set
    global.AI_VISUALIZER.setContext(mockCanvasContext);
    
    // Mock AI_AUDIO with required properties
    global.AI_AUDIO = {
      analyser: {
        frequencyBinCount: 128,
        getByteTimeDomainData: jest.fn((array) => {
          // Fill with some sample data
          for (let i = 0; i < array.length; i++) {
            array[i] = 128 + Math.sin(i / 10) * 20; // Simulate a sine wave
          }
        })
      },
      dataArray: new Uint8Array(128)
    };
    
    // Call the function
    global.AI_VISUALIZER.drawVisualizer();
    
    // Check that drawing operations were performed
    expect(mockCanvasContext.fillRect).toHaveBeenCalled();
    expect(mockCanvasContext.beginPath).toHaveBeenCalled();
    expect(mockCanvasContext.stroke).toHaveBeenCalled();
    expect(global.requestAnimationFrame).toHaveBeenCalled();
  });
}); 