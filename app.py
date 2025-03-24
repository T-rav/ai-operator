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

# Audio processing queue using standard Queue for thread safety
from queue import Queue
audio_queue = Queue()
response_queue = Queue()

# Create a Socket.IO server
sio = socketio.Server(cors_allowed_origins='*')
app.wsgi_app = socketio.WSGIApp(sio, app.wsgi_app)

# Process audio with OpenAI - simplified for real-time voice processing
def process_audio_with_openai(audio_data):
    try:
        # Convert base64 to file-like object
        import base64
        import io
        
        logger.info("Processing audio data...")
        
        # Remove the data URL prefix if present
        if isinstance(audio_data, str) and audio_data.startswith('data:'):
            audio_data = audio_data.split(',')[1]
        
        # Decode the base64 audio data
        audio_bytes = base64.b64decode(audio_data)
        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = 'audio.webm'  # Set a filename with extension
        
        logger.info(f"Audio file size: {len(audio_bytes)} bytes")
        
        # Transcribe audio using Whisper
        logger.info("Sending audio to OpenAI for transcription...")
        transcript_response = openai.audio.transcriptions.create(
            model=speech_model,
            file=audio_file
        )
        
        transcript = transcript_response.text
        logger.info(f"Transcribed: {transcript}")
        
        # If transcript is empty, return early
        if not transcript.strip():
            logger.info("Empty transcript, skipping processing")
            return None, "No speech detected"
        
        # Add user message to conversation history
        conversation_history.append({"role": "user", "content": transcript})
        
        # Get AI response
        logger.info("Getting AI response...")
        response = openai.chat.completions.create(
            model="gpt-3.5-turbo",  # Using a faster model for real-time responses
            messages=conversation_history
        )
        
        ai_response = response.choices[0].message.content
        logger.info(f"AI Response: {ai_response}")
        
        # Add AI response to conversation history
        conversation_history.append({"role": "assistant", "content": ai_response})
        
        # Convert AI response to speech
        logger.info("Converting AI response to speech...")
        speech_response = openai.audio.speech.create(
            model=voice_model,
            voice=voice_voice,
            input=ai_response
        )
        
        # Get the speech content as bytes and convert to base64
        speech_bytes = speech_response.content
        speech_base64 = base64.b64encode(speech_bytes).decode('utf-8')
        logger.info(f"Speech response size: {len(speech_bytes)} bytes")
        
        return speech_base64, ai_response
    except Exception as e:
        logger.error(f"Error processing audio: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None, f"Error processing audio: {str(e)}"

# Audio processing worker
def audio_processor():
    while True:
        try:
            # Get audio data from the queue (this blocks until data is available)
            audio_data = audio_queue.get()
            
            # Process the audio data
            speech_response, text_response = process_audio_with_openai(audio_data)
            
            # Put the response in the queue
            response_queue.put((speech_response, text_response))
            
            # Mark the task as done
            audio_queue.task_done()
        except Exception as e:
            logger.error(f"Error in audio processor: {e}")
            # Put an error response in the queue to avoid blocking the client
            response_queue.put((None, f"Error processing audio: {str(e)}"))
            audio_queue.task_done()

# Socket.IO events
@sio.event
def connect(sid, environ):
    logger.info(f"Client connected: {sid}")

@sio.event
def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")

@sio.event
def audio_data(sid, data):
    """Receive audio data from the client"""
    logger.info(f"Received audio data from {sid}")
    
    # Define a function to process the audio data and respond
    def process_and_respond():
        try:
            # Add audio data to processing queue
            audio_queue.put(data)
            
            # Wait for response
            speech_response, text_response = response_queue.get()
            
            # Send response back to client
            sio.emit('ai_response', {
                'audio': speech_response,
                'text': text_response
            }, room=sid)
        except Exception as e:
            logger.error(f"Error processing audio data: {e}")
            sio.emit('ai_response', {
                'audio': None,
                'text': f"Error: {str(e)}"
            }, room=sid)
    
    # Start the task in the background
    eventlet.spawn(process_and_respond)

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
    port = int(os.getenv('PORT', 5001))  # Using port 5001 to match your current setup
    
    # Start the audio processor in a background thread
    eventlet.spawn(audio_processor)
    
    # Run the Flask app with eventlet
    eventlet.wsgi.server(eventlet.listen((host, port)), app)
