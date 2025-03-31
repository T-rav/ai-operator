import os
import json
import logging
import time
import base64
import io
import queue
import traceback
import tempfile
from flask import Flask, render_template, request, jsonify, Response
from dotenv import load_dotenv
import openai
import socketio
import eventlet
from datetime import datetime, timedelta
from pydub import AudioSegment

# Load environment variables
load_dotenv('.env')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__, static_folder='static', template_folder='templates')

# Configure OpenAI
from openai import OpenAI

# Create a clean client instance with just the API key
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

voice_model = os.getenv('VOICE_MODEL', 'tts-1')
voice_voice = os.getenv('VOICE_VOICE', 'alloy')
speech_model = os.getenv('SPEECH_MODEL', 'whisper-1')

# AI Operator configuration
bot_display_name = os.getenv('BOT_DISPLAY_NAME', 'AI Operator')

# AI conversation context
conversation_history = [
    {"role": "system", "content": "You are an AI voice assistant. Keep your responses concise and helpful."}
]

# Streaming session management
active_streaming_sessions = {}

# Audio processing queue
audio_processing_queue = queue.Queue(maxsize=100)

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
                'webm_header': None,  # Store WebM header for reuse
                'partial_transcript': '',
                'is_speaking': False,
                'last_activity': time.time(),
                'current_message': '',
                'format_failures': 0  # Track format failures to trigger format conversion
            }
        
        session = active_streaming_sessions[sid]
        
        # Remove the data URL prefix if present
        if isinstance(audio_chunk, str):
            if audio_chunk.startswith('data:'):
                audio_chunk = audio_chunk.split(',')[1]
            audio_bytes = base64.b64decode(audio_chunk)
        else:
            audio_bytes = audio_chunk
        
        # If this is the first chunk with data, save it as the WebM header
        if session['webm_header'] is None and len(audio_bytes) > 0:
            # WebM headers are typically in the first few bytes
            session['webm_header'] = audio_bytes
            logger.info(f"Saved WebM header, size: {len(audio_bytes)} bytes")
            
        # Add to buffer
        session['buffer'] += audio_bytes
        session['last_activity'] = time.time()
        
        # Check if we have enough audio data to process (at least 0.2 seconds)
        # For real-time streaming, we want to process smaller chunks
        if len(session['buffer']) > 3200:  # Smaller buffer size for lower latency
            # Log the size of the audio buffer for debugging
            logger.debug(f"Audio buffer size: {len(session['buffer'])} bytes")
            
            # Get format information from the session
            format_info = session.get('audio_format', '')
            logger.debug(f"Using format from session: {format_info}")
            
            # Check if the current buffer has a valid WebM header
            has_valid_header = False
            if len(session['buffer']) >= 4:
                # Simple check for WebM header (0x1A 0x45 0xDF 0xA3)
                has_valid_header = session['buffer'][0:4] == b'\x1a\x45\xdf\xa3'
            
            # Prepare audio data for transcription
            transcription_data = session['buffer']
            
            # If current buffer doesn't have a valid header but we have a saved header
            if not has_valid_header and session['webm_header'] is not None:
                logger.info("Adding WebM header to buffer for transcription")
                transcription_data = session['webm_header'] + session['buffer']
            
            # Create a file-like object for transcription
            audio_file = io.BytesIO(transcription_data)
            audio_file.name = 'audio.webm'

            # Transcribe the audio chunk
            try:
                # First try with WebM format
                try:
                    transcript_response = client.audio.transcriptions.create(
                        model=speech_model,
                        file=audio_file
                    )
                    transcript = transcript_response.text
                    # Reset format failures counter on success
                    session['format_failures'] = 0
                    
                except Exception as e:
                    # If WebM format fails, try converting to MP3
                    if "Invalid file format" in str(e) or session['format_failures'] > 3:
                        logger.info("WebM format failed, converting to MP3 for transcription")
                        session['format_failures'] += 1
                        
                        # Save WebM data to a temporary file
                        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_webm:
                            temp_webm.write(transcription_data)
                            temp_webm_path = temp_webm.name
                        
                        try:
                            # Convert WebM to MP3 using pydub
                            audio = AudioSegment.from_file(temp_webm_path, format="webm")
                            
                            # Export as MP3 to another temporary file
                            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as temp_mp3:
                                temp_mp3_path = temp_mp3.name
                            
                            audio.export(temp_mp3_path, format="mp3")
                            
                            # Use the MP3 file for transcription
                            with open(temp_mp3_path, 'rb') as mp3_file:
                                transcript_response = client.audio.transcriptions.create(
                                    model=speech_model,
                                    file=mp3_file
                                )
                                transcript = transcript_response.text
                            
                            # Clean up temporary files
                            os.unlink(temp_webm_path)
                            os.unlink(temp_mp3_path)
                            
                        except Exception as conv_error:
                            logger.error(f"Error converting audio format: {conv_error}")
                            # Clean up temp file if conversion failed
                            if os.path.exists(temp_webm_path):
                                os.unlink(temp_webm_path)
                            raise
                    else:
                        # If not a format error, re-raise the original exception
                        raise
                
                # Send audio data for visualization
                sio.emit('audio_data', {
                    'buffer_size': len(session['buffer']),
                    'has_speech': bool(transcript.strip())
                }, room=sid)
                
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
                    if session['is_speaking'] and time.time() - session['last_activity'] > 1.0:  # Reduced silence threshold
                        # If we were speaking but have silence for 1.0 seconds, end the message
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
        logger.error(traceback.format_exc())
        return False

# Process a complete message and generate a streaming response
def process_complete_message(sid, message):
    try:
        logger.info(f"👤 USER: {message}")
        
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
        for chunk in client.chat.completions.create(
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
        
        # Log the complete AI response
        logger.info(f"🤖 AI: {response_text}")
        
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
        logger.error(traceback.format_exc())
        
        # Instead of sending an error, provide a helpful response
        helpful_response = "I'm listening. How can I help you today?"
        
        # Log the helpful response
        logger.info(f"🤖 AI: {helpful_response}")
        
        # Add the helpful response to conversation history
        conversation_history.append({"role": "assistant", "content": helpful_response})
        
        # Send the helpful response as streaming text
        sio.emit('streaming_response', {
            'text': helpful_response,
            'is_final': True
        }, room=sid)
        
        # Convert the helpful response to speech
        stream_speech_response(sid, helpful_response)

# Enhanced stream speech response to client with faster processing
def stream_speech_response(sid, text):
    try:
        logger.debug(f"Generating speech for text: {text[:50]}{'...' if len(text) > 50 else ''}")
        # For longer responses, split them into smaller chunks for faster streaming
        max_chunk_length = 50  # Smaller chunks for faster response
        
        if len(text) <= max_chunk_length:
            chunks = [text]
        else:
            # Split by sentences for more natural speech
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
            logger.debug(f"Generating speech for chunk {i+1}/{len(chunks)}: {chunk}")
            speech_response = client.audio.speech.create(
                model=voice_model,
                voice=voice_voice,
                input=chunk,
                speed=1.1  # Slightly faster speech for better responsiveness
            )
            logger.debug(f"Successfully generated speech for chunk {i+1}/{len(chunks)}, size: {len(speech_response.content)} bytes")
            
            # Get the speech content as bytes and convert to base64
            speech_bytes = speech_response.content
            speech_base64 = base64.b64encode(speech_bytes).decode('utf-8')
            
            # Stream the audio chunk to the client
            logger.debug(f"Streaming audio chunk {i+1}/{len(chunks)} to client, base64 length: {len(speech_base64)} chars")
            sio.emit('streaming_audio', {
                'audio': speech_base64,
                'chunk_index': i,
                'total_chunks': len(chunks),
                'is_final': i == len(chunks) - 1
            }, room=sid)
            logger.debug(f"Sent audio chunk {i+1}/{len(chunks)} to client")
            
    except Exception as e:
        logger.error(f"Error streaming speech response: {e}")
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
    
    # Initialize session for this client
    active_streaming_sessions[sid] = {
        'buffer': b'',
        'webm_header': None,  # Store WebM header for reuse
        'last_activity': time.time(),
        'is_speaking': False,
        'current_message': '',
        'audio_format': '',
        'format_failures': 0  # Track format failures to trigger format conversion
    }
    
    # Send welcome message
    welcome_message = "Welcome to AI Operator, my name is Tracey, ask me anything."
    
    # Log the welcome message
    logger.info(f"🤖 AI: {welcome_message}")
    
    # Add the welcome message to conversation history
    conversation_history.append({"role": "assistant", "content": welcome_message})
    
    # Send the welcome message text to the client
    sio.emit('welcome_message', {
        'text': welcome_message
    }, room=sid)
    
    # Generate speech for the welcome message with a small delay to ensure client is ready
    def send_welcome_audio():
        # Small delay to ensure client is fully connected
        eventlet.sleep(0.5)
        stream_speech_response(sid, welcome_message)
    
    eventlet.spawn(send_welcome_audio)

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
        audio_format = data.get('format', 'audio/wav')
        logger.debug(f"Audio format from client: {audio_format}")
        
        # Store format information in the session
        if sid in active_streaming_sessions:
            active_streaming_sessions[sid]['audio_format'] = audio_format
            logger.debug(f"Set session audio format to: {audio_format}")
        
        # Process the audio chunk in the background
        eventlet.spawn(process_audio_chunk, sid, audio_base64)
    else:
        # Legacy format - just base64 data
        logger.debug("Received legacy format audio data without format information")
        # Process the audio chunk in the background
        eventlet.spawn(process_audio_chunk, sid, data)

@sio.event
def end_audio_stream(sid):
    """Client signals end of audio stream"""
    logger.info(f"End of audio stream from {sid}")
    
    # Process any remaining audio in the buffer
    if sid in active_streaming_sessions and active_streaming_sessions[sid]['current_message']:
        process_complete_message(sid, active_streaming_sessions[sid]['current_message'])
        active_streaming_sessions[sid]['current_message'] = ''
        active_streaming_sessions[sid]['is_speaking'] = False

# Routes
@app.route('/')
def index():
        return render_template('index.html', 
                          bot_display_name=bot_display_name)

@app.route('/api/config')
def get_config():
    """API endpoint to get configuration for the client"""
    return jsonify({
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
