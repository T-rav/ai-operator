# AI Operator

A voice assistant client that provides a natural conversation interface with AI through WebSockets.

## Features

- Real-time audio streaming through WebSockets
- Live voice visualization
- Natural conversation transcript with progressive text display
- Intelligent message grouping for a better conversation experience

## Getting Started

1. Make sure the AI Operator backend server is running on `ws://localhost:8765`
2. Open the `index.html` file in a modern browser
3. Click the "Start Audio" button to begin a conversation
4. Speak naturally and wait for the AI to respond
5. Click "Stop Audio" to end the session

## Code Structure

The codebase is organized into the following files:

- **index.html**: Main HTML structure
- **css/styles.css**: All styling for the application
- **js/config.js**: Configuration constants and global variables
- **js/audio-processing.js**: Audio handling functions
- **js/visualizer.js**: Audio visualization
- **js/transcript.js**: Conversation transcript and text display
- **js/websocket.js**: WebSocket communication
- **js/main.js**: Application initialization
- **frames.proto**: Protocol Buffers definition for message formats

## Requirements

- Modern web browser with WebAudio API support
- Backend server running on localhost:8765
- Microphone access

## License

MIT
