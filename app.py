import os
import json
import asyncio
import logging
import time
import requests
import threading
from flask import Flask, render_template, request, jsonify, Response
from dotenv import load_dotenv
import openai
import socketio
import eventlet
from datetime import datetime, timedelta

# Load environment variables
load_dotenv('.env')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__, static_folder='static', template_folder='templates')

# Configure OpenAI
openai.api_key = os.getenv('OPENAI_API_KEY')
voice_model = os.getenv('VOICE_MODEL', 'tts-1')
voice_voice = os.getenv('VOICE_VOICE', 'alloy')
speech_model = os.getenv('SPEECH_MODEL', 'whisper-1')

# Jitsi Meet configuration
jitsi_server_url = os.getenv('JITSI_SERVER_URL', 'https://meet.jit.si')
jitsi_room_name = os.getenv('JITSI_ROOM_NAME', 'ai-operator-room')
bot_display_name = os.getenv('BOT_DISPLAY_NAME', 'AI Operator')

# AI conversation context
conversation_history = [
    {"role": "system", "content": "You are an AI operator in a voice conference. Keep your responses concise and helpful."}
]

# Audio processing queue
audio_queue = asyncio.Queue()
response_queue = asyncio.Queue()

# Create a Socket.IO server
sio = socketio.Server(cors_allowed_origins='*')
app.wsgi_app = socketio.WSGIApp(sio, app.wsgi_app)

# Process audio with OpenAI
async def process_audio_with_openai(audio_data):
    try:
        # Transcribe audio using Whisper
        transcript_response = await openai.Audio.atranscribe(
            model=speech_model,
            file=audio_data
        )
        
        transcript = transcript_response.text
        logger.info(f"Transcribed: {transcript}")
        
        # Add user message to conversation history
        conversation_history.append({"role": "user", "content": transcript})
        
        # Get AI response
        response = await openai.ChatCompletion.acreate(
            model="gpt-4",
            messages=conversation_history
        )
        
        ai_response = response.choices[0].message.content
        logger.info(f"AI Response: {ai_response}")
        
        # Add AI response to conversation history
        conversation_history.append({"role": "assistant", "content": ai_response})
        
        # Convert AI response to speech
        speech_response = await openai.Audio.atts(
            model=voice_model,
            voice=voice_voice,
            input=ai_response
        )
        
        return speech_response, ai_response
    except Exception as e:
        logger.error(f"Error processing audio: {e}")
        return None, f"Error processing audio: {str(e)}"

# Audio processing worker
async def audio_processor():
    while True:
        audio_data = await audio_queue.get()
        speech_response, text_response = await process_audio_with_openai(audio_data)
        await response_queue.put((speech_response, text_response))
        audio_queue.task_done()

# Socket.IO events
@sio.event
def connect(sid, environ):
    logger.info(f"Client connected: {sid}")

@sio.event
def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")

@sio.event
async def audio_data(sid, data):
    """Receive audio data from the client"""
    logger.info(f"Received audio data from {sid}")
    
    # Add audio data to processing queue
    await audio_queue.put(data)
    
    # Wait for response
    speech_response, text_response = await response_queue.get()
    
    # Send response back to client
    sio.emit('ai_response', {
        'audio': speech_response,
        'text': text_response
    }, room=sid)

# Routes
@app.route('/')
def index():
    # Generate a random room name if needed for better anonymity
    room_name = jitsi_room_name
    
    return render_template('index.html', 
                          jitsi_server_url=jitsi_server_url,
                          jitsi_room_name=room_name,
                          bot_display_name=bot_display_name)

@app.route('/api/config')
def get_config():
    """API endpoint to get configuration for the client"""
    return jsonify({
        'jitsi_server_url': jitsi_server_url,
        'jitsi_room_name': jitsi_room_name,
        'bot_display_name': bot_display_name
    })

# Run the application
if __name__ == '__main__':
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5000))
    
    # Start the audio processor in a background task
    eventlet.spawn(audio_processor)
    
    # Run the Flask app with eventlet
    eventlet.wsgi.server(eventlet.listen((host, port)), app)
