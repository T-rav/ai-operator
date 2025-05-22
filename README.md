# AI Operator - Real-time Voice Conversation System

This project implements a low-latency, real-time voice conversation system with a web client. It combines specialized services to create a responsive AI assistant that can understand speech, respond intelligently, and be interrupted naturally during conversation.

## Key Features

- **Real-time voice conversations** with GPT-4o
- **Low-latency responses** through WebSocket streaming
- **Natural interruption handling** - speak while AI is talking to interrupt it
- **Multi-service architecture** optimizing each part of the conversation pipeline:
  - Deepgram for speech-to-text
  - OpenAI GPT-4o for language processing
  - Cartesia TTS for high-quality voice output

## Advantages Over Other Systems

- **Speed**: Optimized for reduced latency compared to single-provider solutions
- **Voice Quality**: Uses Cartesia's "British Reading Lady" voice for natural speech
- **Interruption**: Supports natural conversation flow with immediate response to interruptions
- **Customizable**: Each component can be swapped with alternatives

## Getting Started

### Setup

```python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp env.example .env # and add your API credentials
```

### Required API Keys

Add the following to your `.env` file:
- `OPENAI_API_KEY` - For GPT-4o language model
- `DEEPGRAM_API_KEY` - For speech recognition
- `CARTESIA_API_KEY` - For text-to-speech

### Run the Bot Server

```bash
python bot.py
```

### Run the Web Client

```bash
python -m http.server
```

Then, visit `http://localhost:8000` in your browser to start a conversation.

## Technical Architecture

The system uses a pipeline architecture:
1. Web client captures audio and streams to server via WebSockets
2. Speech is converted to text using Deepgram
3. Text is processed by GPT-4o
4. Responses are converted to speech using Cartesia TTS
5. Audio is streamed back to client for playback

Voice detection monitors audio levels and triggers interruption handling when the user starts speaking during AI responses.
