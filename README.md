# AI Operator

A simple voice bot that uses Jitsi Meet and OpenAI's real-time voice API to create an interactive AI operator for conferences.

## Features

- Real-time voice interaction with OpenAI's voice API
- Jitsi Meet integration for conferencing
- Audio capture and processing from conference participants
- Text-to-speech response playback in the conference
- Conversation history tracking
- Initially supports one person, with plans to scale to multiple participants

## Setup

1. Clone this repository
2. Install dependencies: `pip install -r requirements.txt`
3. Set up your environment variables in the `env` file (see `env.example`)
4. Run the application: `python app.py`
5. Open your browser to `http://localhost:5000`

## Requirements

- Python 3.8+
- OpenAI API key
- Microphone and speakers
- Modern web browser with WebRTC support

## How It Works

1. The application starts a Flask server that serves the web interface
2. Users join a Jitsi Meet conference through the web interface
3. When the AI Operator is enabled, it captures audio from the conference
4. The audio is sent to OpenAI's Whisper API for transcription
5. The transcription is processed by OpenAI's GPT-4 to generate a response
6. The response is converted to speech using OpenAI's TTS API
7. The speech is played back in the conference
