import os
import json
import asyncio
import logging
import time
import requests
import threading
import base64
import io
import queue
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

# Streaming session management
active_streaming_sessions = {}

# Create a Socket.IO server
sio = socketio.Server(cors_allowed_origins='*')
app.wsgi_app = socketio.WSGIApp(sio, app.wsgi_app)

# Process audio chunk with OpenAI's streaming API
def process_audio_chunk(sid, audio_chunk):
    try:
        # Get or create session data for this client
        if sid not in active_streaming_sessions:
            active_streaming_sessions[sid] = {
                'buffer': b'',
                'partial_transcript': '',
                'is_speaking': False,
                'last_activity': time.time(),
                'current_message': ''
            }
        
        session = active_streaming_sessions[sid]
        
        # Remove the data URL prefix if present
        if isinstance(audio_chunk, str):
            if audio_chunk.startswith('data:'):
                audio_chunk = audio_chunk.split(',')[1]
            audio_bytes = base64.b64decode(audio_chunk)
        else:
            audio_bytes = audio_chunk
            
        # Add to buffer
        session['buffer'] += audio_bytes
        session['last_activity'] = time.time()
        
        # Check if we have enough audio data to process (at least 0.5 seconds)
        # For real-time streaming, we want to process smaller chunks
        if len(session['buffer']) > 8000:  # Approximate size for 0.5s of audio
            # Log the size of the audio buffer for debugging
            logger.info(f"Audio buffer size: {len(session['buffer'])} bytes")
            
            # Get format information from the session
            format_info = session.get('audio_format', '')
            logger.info(f"Using format from session: {format_info}")
            
            # For WebM with Opus codec, we need to convert to a supported format
            if 'webm' in format_info and 'opus' in format_info:
                try:
                    # Import pydub for audio conversion
                    from pydub import AudioSegment
                    import tempfile
                    
                    # Create temporary files for the conversion process
                    with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as webm_file:
                        webm_file.write(session['buffer'])
                        webm_path = webm_file.name
                    
                    # Convert WebM to MP3 using pydub
                    try:
                        audio = AudioSegment.from_file(webm_path, format="webm")
                        mp3_path = webm_path.replace('.webm', '.mp3')
                        audio.export(mp3_path, format="mp3")
                        
                        # Use the converted MP3 file
                        with open(mp3_path, 'rb') as mp3_file:
                            audio_file = io.BytesIO(mp3_file.read())
                            audio_file.name = 'audio.mp3'
                            logger.info("Successfully converted WebM to MP3")
                            
                        # Clean up temporary files
                        import os
                        os.remove(webm_path)
                        os.remove(mp3_path)
                    except Exception as e:
                        logger.error(f"Error converting WebM to MP3: {e}")
                        # Fallback to using the original buffer
                        audio_file = io.BytesIO(session['buffer'])
                        audio_file.name = 'audio.webm'
                except ImportError:
                    logger.error("pydub not available for audio conversion")
                    audio_file = io.BytesIO(session['buffer'])
                    audio_file.name = 'audio.webm'
            else:
                # Create a file-like object directly from the buffer
                audio_file = io.BytesIO(session['buffer'])
                
                # Map MIME types to file extensions
                if 'wav' in format_info:
                    audio_file.name = 'audio.wav'
                elif 'mp3' in format_info:
                    audio_file.name = 'audio.mp3'
                elif 'webm' in format_info:
                    audio_file.name = 'audio.webm'
                elif 'ogg' in format_info:
                    audio_file.name = 'audio.ogg'
                else:
                    # Fallback to detection based on header bytes
                    header = session['buffer'][:4]
                    logger.info(f"Detecting format from header bytes: {header.hex()}")
                    
                    if header.startswith(b'RIFF'):  # WAV file signature
                        audio_file.name = 'audio.wav'
                        logger.info("Detected WAV format")
                    elif header.startswith(b'ID3') or header.startswith(b'\xff\xfb'):  # MP3 signatures
                        audio_file.name = 'audio.mp3'
                        logger.info("Detected MP3 format")
                    elif header.startswith(b'1A45DFA3'):  # WebM signature
                        audio_file.name = 'audio.webm'
                        logger.info("Detected WebM format")
                    elif header.startswith(b'OggS'):  # Ogg signature
                        audio_file.name = 'audio.ogg'
                        logger.info("Detected OGG format")
                    else:
                        # If we can't detect the format, default to WAV
                        logger.info(f"Unknown audio format, defaulting to WAV")
                        audio_file.name = 'audio.wav'
            
            # Transcribe the audio chunk
            try:
                transcript_response = openai.audio.transcriptions.create(
                    model=speech_model,
                    file=audio_file
                )
                
                transcript = transcript_response.text
                
                if transcript.strip():
                    # We have speech, update the session
                    if not session['is_speaking']:
                        # New speech detected
                        session['is_speaking'] = True
                        session['current_message'] = transcript
                    else:
                        # Continue existing speech
                        session['current_message'] += " " + transcript
                    
                    # Send partial transcript to client
                    sio.emit('partial_transcript', {
                        'text': transcript,
                        'is_final': False
                    }, room=sid)
                    
                    # Check if this might be the end of a sentence
                    if transcript.strip().endswith('.') or transcript.strip().endswith('?') or transcript.strip().endswith('!'):
                        # Process the complete message
                        process_complete_message(sid, session['current_message'])
                        session['current_message'] = ''
                        session['is_speaking'] = False
                else:
                    # No speech detected in this chunk
                    if session['is_speaking'] and time.time() - session['last_activity'] > 1.5:
                        # If we were speaking but have silence for 1.5 seconds, end the message
                        if session['current_message']:
                            process_complete_message(sid, session['current_message'])
                            session['current_message'] = ''
                        session['is_speaking'] = False
            except Exception as e:
                logger.error(f"Error transcribing audio chunk: {e}")
            
            # Clear the buffer after processing
            session['buffer'] = b''
            
        return True
    except Exception as e:
        logger.error(f"Error processing audio chunk: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False

# Process a complete message and generate a streaming response
def process_complete_message(sid, message):
    try:
        logger.info(f"Processing complete message: {message}")
        
        # Add user message to conversation history
        conversation_history.append({"role": "user", "content": message})
        
        # Send final transcript to client
        sio.emit('partial_transcript', {
            'text': message,
            'is_final': True
        }, room=sid)
        
        # Get AI response with streaming
        response_text = ""
        
        # Start streaming chat completion
        for chunk in openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=conversation_history,
            stream=True
        ):
            if chunk.choices[0].delta.content is not None:
                content = chunk.choices[0].delta.content
                response_text += content
                
                # Stream the text response to the client
                sio.emit('streaming_response', {
                    'text': content,
                    'is_final': False
                }, room=sid)
        
        # Add AI response to conversation history
        conversation_history.append({"role": "assistant", "content": response_text})
        
        # Signal that the text response is complete
        sio.emit('streaming_response', {
            'text': '',
            'is_final': True
        }, room=sid)
        
        # Convert the complete response to speech and stream it
        stream_speech_response(sid, response_text)
        
    except Exception as e:
        logger.error(f"Error processing complete message: {e}")
        import traceback
        logger.error(traceback.format_exc())
        sio.emit('ai_response', {
            'text': f"Error: {str(e)}",
            'audio': None
        }, room=sid)

# Stream speech response to client
def stream_speech_response(sid, text):
    try:
        # For longer responses, we might want to split them into smaller chunks
        # to start streaming audio sooner
        max_chunk_length = 100  # characters
        
        if len(text) <= max_chunk_length:
            chunks = [text]
        else:
            # Split by sentences or at max_chunk_length
            chunks = []
            current_chunk = ""
            
            for sentence in text.replace('. ', '.|').replace('? ', '?|').replace('! ', '!|').split('|'):
                if len(current_chunk) + len(sentence) <= max_chunk_length:
                    current_chunk += sentence + ('' if sentence.endswith(('.', '?', '!')) else '. ')
                else:
                    if current_chunk:
                        chunks.append(current_chunk)
                    current_chunk = sentence + ('' if sentence.endswith(('.', '?', '!')) else '. ')
            
            if current_chunk:
                chunks.append(current_chunk)
        
        # Process each chunk and stream the audio
        for i, chunk in enumerate(chunks):
            speech_response = openai.audio.speech.create(
                model=voice_model,
                voice=voice_voice,
                input=chunk
            )
            
            # Get the speech content as bytes and convert to base64
            speech_bytes = speech_response.content
            speech_base64 = base64.b64encode(speech_bytes).decode('utf-8')
            
            # Stream the audio chunk to the client
            sio.emit('streaming_audio', {
                'audio': speech_base64,
                'chunk_index': i,
                'total_chunks': len(chunks),
                'is_final': i == len(chunks) - 1
            }, room=sid)
            
    except Exception as e:
        logger.error(f"Error streaming speech response: {e}")
        import traceback
        logger.error(traceback.format_exc())

# Cleanup inactive sessions periodically
def cleanup_inactive_sessions():
    while True:
        try:
            current_time = time.time()
            to_remove = []
            
            for sid, session in active_streaming_sessions.items():
                # If no activity for 5 minutes, clean up the session
                if current_time - session['last_activity'] > 300:  # 5 minutes
                    to_remove.append(sid)
            
            for sid in to_remove:
                del active_streaming_sessions[sid]
                logger.info(f"Cleaned up inactive session: {sid}")
            
            # Sleep for 1 minute before checking again
            eventlet.sleep(60)
        except Exception as e:
            logger.error(f"Error in session cleanup: {e}")
            eventlet.sleep(60)

# Socket.IO events
@sio.event
def connect(sid, environ):
    logger.info(f"Client connected: {sid}")

@sio.event
def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")

@sio.event
def audio_chunk(sid, data):
    """Receive streaming audio chunk from the client"""
    logger.debug(f"Received audio chunk from {sid}")
    
    # Check if data is a dictionary with format information or just raw base64
    if isinstance(data, dict) and 'data' in data:
        # Extract the audio data and format information
        audio_base64 = data['data']
        audio_format = data.get('format', 'audio/webm')
        logger.info(f"Audio format from client: {audio_format}")
        
        # Store format information in the session
        if sid in active_streaming_sessions:
            active_streaming_sessions[sid]['audio_format'] = audio_format
        
        # Process the audio chunk in the background
        eventlet.spawn(process_audio_chunk, sid, audio_base64)
    else:
        # Legacy format - just base64 data
        # Process the audio chunk in the background
        eventlet.spawn(process_audio_chunk, sid, data)

@sio.event
def end_audio_stream(sid):
    """Client signals end of audio stream"""
    logger.info(f"End of audio stream from {sid}")
    
    # Process any remaining audio in the buffer
    if sid in active_streaming_sessions and active_streaming_sessions[sid]['current_message']:
        eventlet.spawn(process_complete_message, sid, active_streaming_sessions[sid]['current_message'])
        active_streaming_sessions[sid]['current_message'] = ''
        active_streaming_sessions[sid]['is_speaking'] = False

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

# Start the session cleanup thread
eventlet.spawn(cleanup_inactive_sessions)

# Run the application
if __name__ == '__main__':
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5001))  # Using port 5001 to match your current setup
    
    # Run the Flask app with eventlet
    eventlet.wsgi.server(eventlet.listen((host, port)), app)
