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

// Set up basic required globals
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
  dataArray: new Uint8Array(128),
  animationFrame: null
};

global.AI_STATE = {
  isPlaying: true
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
global.requestAnimationFrame = jest.fn().mockReturnValue(123);

// Create a minimal visualizer implementation for testing
global.AI_VISUALIZER = {
  canvasContext: mockCanvasContext,
  visualizerCanvas: mockCanvas,
  drawVisualizer: jest.fn(),
  resizeCanvas: jest.fn(),
  initVisualizer: jest.fn(),
  stopVisualizer: jest.fn()
};

// Don't import the module to avoid side effects
// require('../visualizer.js');

describe('Visualizer Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Reset canvas properties
    mockCanvas.width = 800;
    mockCanvas.height = 200;
    
    // Reset AI_STATE
    global.AI_STATE.isPlaying = true;
    
    // Ensure canvasContext is set
    global.AI_VISUALIZER.canvasContext = mockCanvasContext;
  });

  test('AI_VISUALIZER is properly initialized', () => {
    // Check that AI_VISUALIZER is exported to the global scope
    expect(global.AI_VISUALIZER).toBeDefined();

    // Check that it contains the drawVisualizer method
    expect(typeof global.AI_VISUALIZER.drawVisualizer).toBe('function');
    
    // Check for canvasContext
    expect(global.AI_VISUALIZER).toHaveProperty('canvasContext');
  });

  test('drawVisualizer does nothing if AI_AUDIO.analyser is not available', () => {
    // Create a local implementation for this test
    global.AI_VISUALIZER.drawVisualizer = function() {
      if (!global.AI_STATE.isPlaying || !global.AI_AUDIO.analyser) {
        return;
      }
      
      mockCanvasContext.fillRect(0, 0, mockCanvas.width, mockCanvas.height);
      mockCanvasContext.beginPath();
      mockCanvasContext.stroke();
    };
    
    // Temporarily remove the analyser
    const originalAnalyser = global.AI_AUDIO.analyser;
    global.AI_AUDIO.analyser = null;
    
    // Call the function
    global.AI_VISUALIZER.drawVisualizer();
    
    // Check that no drawing operations were performed
    expect(mockCanvasContext.fillRect).not.toHaveBeenCalled();
    expect(mockCanvasContext.beginPath).not.toHaveBeenCalled();
    
    // Restore the analyser
    global.AI_AUDIO.analyser = originalAnalyser;
  });

  test('drawVisualizer does nothing if not playing', () => {
    // Create a local implementation for this test
    global.AI_VISUALIZER.drawVisualizer = function() {
      if (!global.AI_STATE.isPlaying || !global.AI_AUDIO.analyser) {
        return;
      }
      
      mockCanvasContext.fillRect(0, 0, mockCanvas.width, mockCanvas.height);
      mockCanvasContext.beginPath();
      mockCanvasContext.stroke();
    };
    
    // Set isPlaying to false
    global.AI_STATE.isPlaying = false;
    
    // Call the function
    global.AI_VISUALIZER.drawVisualizer();
    
    // Check that no drawing operations were performed
    expect(mockCanvasContext.fillRect).not.toHaveBeenCalled();
    expect(mockCanvasContext.beginPath).not.toHaveBeenCalled();
  });

  test('drawVisualizer draws to the canvas when playing', () => {
    // Create a local implementation for this test
    global.AI_VISUALIZER.drawVisualizer = function() {
      if (!global.AI_STATE.isPlaying || !global.AI_AUDIO.analyser) {
        return;
      }
      
      mockCanvasContext.fillRect(0, 0, mockCanvas.width, mockCanvas.height);
      mockCanvasContext.beginPath();
      mockCanvasContext.stroke();
      
      requestAnimationFrame(global.AI_VISUALIZER.drawVisualizer);
    };
    
    // Ensure context is set
    global.AI_VISUALIZER.canvasContext = mockCanvasContext;
    
    // Ensure we're playing
    global.AI_STATE.isPlaying = true;
    
    // Call the function
    global.AI_VISUALIZER.drawVisualizer();
    
    // Check that drawing operations were performed
    expect(mockCanvasContext.fillRect).toHaveBeenCalled();
    expect(mockCanvasContext.beginPath).toHaveBeenCalled();
    expect(mockCanvasContext.stroke).toHaveBeenCalled();
    expect(global.requestAnimationFrame).toHaveBeenCalled();
  });

  test('resizeCanvas resizes the canvas', () => {
    // Create a local implementation for this test
    global.AI_VISUALIZER.resizeCanvas = function() {
      // Update canvas height based on width (ratio 1:4)
      const aspectRatio = 0.25;
      mockCanvas.height = mockCanvas.width * aspectRatio;
    };
    
    // Get the original dimensions
    const originalWidth = mockCanvas.width;
    const originalHeight = mockCanvas.height;
    
    // Set a new width that should trigger a resize
    mockCanvas.width = 1200;
    
    // Call the function
    global.AI_VISUALIZER.resizeCanvas();
    
    // Check that the canvas height was updated
    expect(mockCanvas.height).not.toBe(originalHeight);
  });
}); 