/**
 * Unit test for transcript functionality
 * Tests that placeholders are correctly replaced with actual transcripts
 */

const mockDocument = {
  createElement: jest.fn().mockImplementation((tag) => {
    return {
      className: '',
      textContent: '',
      appendChild: jest.fn(),
      querySelector: jest.fn().mockImplementation(() => {
        return { textContent: '' };
      })
    };
  })
};

global.document = mockDocument;

global.isSpeaking = false;
global.isAIResponding = false;
global.latestUserMessage = null;
global.latestAIMessage = null;
global.transcriptContainer = {
  appendChild: jest.fn(),
  children: { length: 0 }
};

function addMessageToTranscript(text, type = 'user', isPlaceholder = false) {
  if (!isPlaceholder) {
    if (type === 'user' && global.latestUserMessage && global.isSpeaking) {
      const content = global.latestUserMessage.querySelector('.content');
      if (content) {
        content.textContent = text;
        return; // Exit early, no need to create a new message
      }
    } else if (type === 'ai' && global.latestAIMessage && global.isAIResponding) {
      const content = global.latestAIMessage.querySelector('.content');
      if (content) {
        content.textContent = text;
        return; // Exit early, no need to create a new message
      }
    }
  }
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = type === 'user' ? 'U' : 'AI';
  
  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = text;
  
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(content);
  global.transcriptContainer.appendChild(messageDiv);
  
  if (isPlaceholder) {
    if (type === 'user') {
      global.latestUserMessage = messageDiv;
    } else if (type === 'ai') {
      global.latestAIMessage = messageDiv;
    }
  }
}

describe('Transcript Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.isSpeaking = false;
    global.isAIResponding = false;
    global.latestUserMessage = null;
    global.latestAIMessage = null;
    global.transcriptContainer.appendChild.mockClear();
  });
  
  test('User placeholder is created correctly', () => {
    const userPlaceholderDiv = {
      className: '',
      textContent: '',
      querySelector: jest.fn().mockReturnValue({ textContent: '' }),
      appendChild: jest.fn()
    };
    document.createElement.mockReturnValueOnce(userPlaceholderDiv);
    
    addMessageToTranscript('User speaking...', 'user', true);
    
    expect(userPlaceholderDiv.className).toBe('message user');
    expect(global.latestUserMessage).toBe(userPlaceholderDiv);
    expect(global.transcriptContainer.appendChild).toHaveBeenCalledWith(userPlaceholderDiv);
  });
  
  test('AI placeholder is created correctly', () => {
    const aiPlaceholderDiv = {
      className: '',
      textContent: '',
      querySelector: jest.fn().mockReturnValue({ textContent: '' }),
      appendChild: jest.fn()
    };
    document.createElement.mockReturnValueOnce(aiPlaceholderDiv);
    
    addMessageToTranscript('AI response...', 'ai', true);
    
    expect(aiPlaceholderDiv.className).toBe('message ai');
    expect(global.latestAIMessage).toBe(aiPlaceholderDiv);
    expect(global.transcriptContainer.appendChild).toHaveBeenCalledWith(aiPlaceholderDiv);
  });
  
  test('User placeholder is replaced with transcript', () => {
    const contentEl = { textContent: 'User speaking...' };
    const userPlaceholderDiv = {
      className: 'message user',
      querySelector: jest.fn().mockReturnValue(contentEl),
      appendChild: jest.fn()
    };
    global.latestUserMessage = userPlaceholderDiv;
    global.isSpeaking = true;
    
    addMessageToTranscript('Hello, this is a test of the transcription system.', 'user');
    
    expect(contentEl.textContent).toBe('Hello, this is a test of the transcription system.');
    expect(global.transcriptContainer.appendChild).not.toHaveBeenCalled();
  });
  
  test('AI placeholder is replaced with response', () => {
    const contentEl = { textContent: 'AI response...' };
    const aiPlaceholderDiv = {
      className: 'message ai',
      querySelector: jest.fn().mockReturnValue(contentEl),
      appendChild: jest.fn()
    };
    global.latestAIMessage = aiPlaceholderDiv;
    global.isAIResponding = true;
    
    addMessageToTranscript('I received your test message. The transcription system is working correctly!', 'ai');
    
    expect(contentEl.textContent).toBe('I received your test message. The transcription system is working correctly!');
    expect(global.transcriptContainer.appendChild).not.toHaveBeenCalled();
  });
  
  test('New message is created when no placeholder exists', () => {
    global.latestUserMessage = null;
    
    addMessageToTranscript('This is a new message without a placeholder', 'user');
    
    expect(global.transcriptContainer.appendChild).toHaveBeenCalled();
  });
});
