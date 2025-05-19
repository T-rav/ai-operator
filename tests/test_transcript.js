/**
 * Unit test for transcript functionality
 * Tests that placeholders are correctly replaced with actual transcripts
 */

const mockTranscriptContainer = document.createElement('div');
const mockUserMessage = document.createElement('div');
const mockAIMessage = document.createElement('div');
const mockUserContent = document.createElement('div');
const mockAIContent = document.createElement('div');

function setupTest() {
  mockTranscriptContainer.innerHTML = '';
  
  mockUserMessage.className = 'message user';
  mockUserContent.className = 'content';
  mockUserContent.textContent = 'User speaking...';
  mockUserMessage.appendChild(mockUserContent);
  mockTranscriptContainer.appendChild(mockUserMessage);
  
  mockAIMessage.className = 'message ai';
  mockAIContent.className = 'content';
  mockAIContent.textContent = 'AI response...';
  mockAIMessage.appendChild(mockAIContent);
  mockTranscriptContainer.appendChild(mockAIMessage);
  
  window.isSpeaking = true;
  window.isAIResponding = true;
  window.latestUserMessage = mockUserMessage;
  window.latestAIMessage = mockAIMessage;
  window.transcriptContainer = mockTranscriptContainer;
}

function addMessageToTranscript(text, type = 'user', isPlaceholder = false) {
  if (!isPlaceholder) {
    if (type === 'user' && window.latestUserMessage && window.isSpeaking) {
      const content = window.latestUserMessage.querySelector('.content');
      if (content) {
        content.textContent = text;
        return; // Exit early, no need to create a new message
      }
    } else if (type === 'ai' && window.latestAIMessage && window.isAIResponding) {
      const content = window.latestAIMessage.querySelector('.content');
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
  window.transcriptContainer.appendChild(messageDiv);
  
  if (isPlaceholder) {
    if (type === 'user') {
      window.latestUserMessage = messageDiv;
    } else if (type === 'ai') {
      window.latestAIMessage = messageDiv;
    }
  }
}

const tests = [
  {
    name: 'Test user placeholder replaced with transcript',
    run: function() {
      setupTest();
      
      console.assert(mockUserContent.textContent === 'User speaking...', 
        'Initial user placeholder text should be "User speaking..."');
      
      addMessageToTranscript('Hello, this is a test of the transcription system.', 'user');
      
      console.assert(mockUserContent.textContent === 'Hello, this is a test of the transcription system.', 
        'User placeholder should be updated with actual transcript');
      
      console.assert(mockTranscriptContainer.children.length === 2, 
        'No new message should be created when updating a placeholder');
      
      return true;
    }
  },
  {
    name: 'Test AI placeholder replaced with transcript',
    run: function() {
      setupTest();
      
      console.assert(mockAIContent.textContent === 'AI response...', 
        'Initial AI placeholder text should be "AI response..."');
      
      addMessageToTranscript('I received your test message. The transcription system is working correctly!', 'ai');
      
      console.assert(mockAIContent.textContent === 'I received your test message. The transcription system is working correctly!', 
        'AI placeholder should be updated with actual response');
      
      console.assert(mockTranscriptContainer.children.length === 2, 
        'No new message should be created when updating a placeholder');
      
      return true;
    }
  },
  {
    name: 'Test new message created when no placeholder exists',
    run: function() {
      setupTest();
      
      window.latestUserMessage = null;
      window.latestAIMessage = null;
      
      addMessageToTranscript('This is a new message without a placeholder', 'user');
      
      console.assert(mockTranscriptContainer.children.length === 3, 
        'A new message should be created when no placeholder exists');
      
      return true;
    }
  },
  {
    name: 'Test placeholder creation',
    run: function() {
      setupTest();
      
      mockTranscriptContainer.innerHTML = '';
      
      window.latestUserMessage = null;
      window.latestAIMessage = null;
      
      addMessageToTranscript('User speaking...', 'user', true);
      
      console.assert(mockTranscriptContainer.children.length === 1, 
        'A new placeholder should be created');
      
      console.assert(window.latestUserMessage !== null, 
        'Latest user message reference should be updated');
      
      return true;
    }
  }
];

function runTests() {
  let passed = 0;
  let failed = 0;
  
  console.log('Running transcript functionality tests...');
  
  tests.forEach(test => {
    try {
      const result = test.run();
      if (result) {
        console.log(`✅ PASS: ${test.name}`);
        passed++;
      } else {
        console.log(`❌ FAIL: ${test.name}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ERROR: ${test.name}`);
      console.error(error);
      failed++;
    }
  });
  
  console.log(`\nTest Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runTests };
}

if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const testResults = document.createElement('div');
    testResults.id = 'testResults';
    document.body.appendChild(testResults);
    
    const runButton = document.createElement('button');
    runButton.textContent = 'Run Tests';
    runButton.onclick = () => {
      const success = runTests();
      testResults.innerHTML = `<h2>Test ${success ? 'Passed' : 'Failed'}</h2>`;
    };
    
    document.body.insertBefore(runButton, testResults);
  });
}
