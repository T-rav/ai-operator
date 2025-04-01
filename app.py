import os
import sys
import asyncio
import json
import logging
from flask import Flask, render_template, request, jsonify, Response
from dotenv import load_dotenv
from loguru import logger

# Pipecat imports
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import BotInterruptionFrame, EndFrame, TextFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.services.openai.stt import OpenAISTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.network.websocket_server import (
    WebsocketServerParams,
    WebsocketServerTransport,
)

# Load environment variables
load_dotenv('.env')

# Configure logging
logger.remove(0)
logger.add(sys.stderr, level="INFO")

# Initialize Flask app for serving static content
app = Flask(__name__, static_folder='static', template_folder='templates')

# AI Operator configuration
bot_display_name = os.getenv('BOT_DISPLAY_NAME', 'AI Operator')
voice_model = os.getenv('VOICE_MODEL', 'tts-1')
voice_voice = os.getenv('VOICE_VOICE', 'alloy')
llm_model = os.getenv('LLM_MODEL', 'gpt-4o')

# Session timeout handler for managing connection timeouts
class SessionTimeoutHandler:
    """Handles actions to be performed when a session times out."""

    def __init__(self, task, tts):
        self.task = task
        self.tts = tts
        self.background_tasks = set()

    async def handle_timeout(self, client_address):
        """Handles the timeout event for a session."""
        try:
            logger.info(f"Connection timeout for {client_address}")

            # Queue a BotInterruptionFrame to notify the user
            await self.task.queue_frames([BotInterruptionFrame()])

            # Send the TTS message to inform the user about the timeout
            await self.tts.say(
                "I'm sorry, we are ending the call now. Please feel free to reach out again if you need assistance."
            )

            # Start the process to gracefully end the call in the background
            end_call_task = asyncio.create_task(self._end_call())
            self.background_tasks.add(end_call_task)
            end_call_task.add_done_callback(self.background_tasks.discard)
        except Exception as e:
            logger.error(f"Error during session timeout handling: {e}")

    async def _end_call(self):
        """Completes the session termination process after the TTS message."""
        try:
            # Wait for a duration to ensure TTS has completed
            await asyncio.sleep(5)

            # Queue both BotInterruptionFrame and EndFrame to conclude the session
            await self.task.queue_frames([BotInterruptionFrame(), EndFrame()])

            logger.info("TTS completed and EndFrame pushed successfully.")
        except Exception as e:
            logger.error(f"Error during call termination: {e}")

# Custom WebSocket message handler to process raw audio data from the browser
class CustomWebSocketHandler:
    def __init__(self, pipeline_task):
        self.pipeline_task = pipeline_task
        self.clients = set()
        self.audio_buffer = bytearray()
        
    async def on_connect(self, websocket, path):
        logger.info(f"Client connected: {websocket.remote_address}")
        self.clients.add(websocket)
        
        try:
            # Keep the connection open and process incoming messages
            async for message in websocket:
                if isinstance(message, bytes):
                    # Process binary audio data
                    await self.handle_audio_data(message)
                elif isinstance(message, str):
                    # Process text messages (commands, etc.)
                    await self.handle_text_message(websocket, message)
        except Exception as e:
            logger.error(f"Error in WebSocket handler: {e}")
        finally:
            # Clean up when the connection is closed
            self.clients.remove(websocket)
            logger.info(f"Client disconnected: {websocket.remote_address}")
    
    async def handle_audio_data(self, audio_data):
        try:
            # Skip empty audio chunks (often sent as end-of-stream signals)
            if len(audio_data) < 10:
                logger.info("Received empty audio chunk, skipping processing")
                return
                
            # Check if the audio data has a valid WebM header
            has_webm_header = len(audio_data) >= 4 and audio_data[0:4] == b'\x1A\x45\xDF\xA3'
            
            if has_webm_header:
                logger.debug("Audio data has valid WebM header")
            else:
                logger.warning("Audio data missing WebM header, may cause processing issues")
            
            # Add the audio data to the pipeline task
            # This will be processed by the STT service
            await self.pipeline_task.process_audio(audio_data)
            logger.debug(f"Processed {len(audio_data)} bytes of audio data")
        except Exception as e:
            logger.error(f"Error processing audio data: {e}")
    
    async def handle_text_message(self, websocket, message):
        try:
            # Parse the message as JSON
            data = json.loads(message)
            logger.info(f"Received text message: {data}")
            
            # Handle different message types
            msg_type = data.get('type', '')
            
            if msg_type == 'ping':
                # Respond to ping messages to keep the connection alive
                await websocket.send(json.dumps({'type': 'pong'}))
                logger.info("Sent pong response to ping")
                
            elif msg_type == 'init':
                # Handle initialization message from client
                logger.info(f"Received initialization message: {data}")
                # Send an acknowledgment
                await websocket.send(json.dumps({
                    'type': 'init_ack',
                    'status': 'success',
                    'message': 'Connection initialized successfully'
                }))
                logger.info("Sent initialization acknowledgment")
                
            elif msg_type == 'audio_data':
                # Handle audio data sent as JSON
                logger.info(f"Received audio data as JSON, converting to binary")
                # Convert the array back to binary
                if 'data' in data:
                    try:
                        # Convert the array back to binary
                        audio_bytes = bytes(data['data'])
                        # Process the audio data
                        await self.handle_audio_data(audio_bytes)
                    except Exception as e:
                        logger.error(f"Error processing JSON audio data: {e}")
        except Exception as e:
            logger.error(f"Error handling text message: {e}")

# Main function to set up and run the Pipecat pipeline
async def main():
    # Create a simpler WebSocket server transport for real-time audio streaming
    # Using a more direct approach without the complexity of Pipecat's default handler
    transport = WebsocketServerTransport(
        params=WebsocketServerParams(
            host="0.0.0.0",          # Listen on all interfaces for better compatibility
            port=int(os.getenv("WEBSOCKET_PORT", "8765")),
            path="/ws",              # Explicitly set the WebSocket path
            serializer=ProtobufFrameSerializer(),
            audio_out_enabled=True,  # Enable audio output
            add_wav_header=True,     # Add WAV header to audio chunks
            vad_enabled=False,       # Disable VAD to simplify processing
            session_timeout=600,     # 10 minutes timeout for longer sessions
            audio_sample_rate=16000, # Match the client's audio sample rate
            debug=True,              # Enable debug logging
            raw_audio_mode=True,     # Accept raw audio data without protocol buffers
            audio_format="webm",     # Treat incoming audio as WebM format
            binary_ping=False,       # Use text pings instead of binary
            accept_raw_audio=True,   # Accept raw audio data from browsers
            max_message_size=10485760, # 10MB max message size
            ping_interval=10,        # Send ping every 10 seconds
            ping_timeout=30,         # 30 seconds ping timeout
        )
    )
    
    # Add a log message to track transport initialization
    logger.info("WebSocket transport initialized with custom handler for raw audio data")

    # Initialize OpenAI services with API keys from environment variables
    llm = OpenAILLMService(api_key=os.getenv("OPENAI_API_KEY"), model=llm_model)
    stt = OpenAISTTService(api_key=os.getenv("OPENAI_API_KEY"))
    tts = OpenAITTSService(
        api_key=os.getenv("OPENAI_API_KEY"),
        voice=voice_voice,
        model=voice_model
    )

    # Set up the conversation context with system prompt
    messages = [
        {
            "role": "system",
            "content": "You are an AI voice assistant named Tracey. Keep your responses concise and helpful. Your goal is to provide clear, accurate information and assistance.",
        },
    ]

    # Create an OpenAI LLM context to manage conversation history
    context = OpenAILLMContext(messages)
    context_aggregator = llm.create_context_aggregator(context)

    # Build the Pipecat pipeline with all components
    pipeline = Pipeline(
        [
            transport.input(),         # WebSocket input from client
            stt,                      # Speech-To-Text using OpenAI
            context_aggregator.user(), # Add user messages to context
            llm,                      # Language model for generating responses
            tts,                      # Text-To-Speech using OpenAI
            transport.output(),       # WebSocket output to client
            context_aggregator.assistant(), # Add assistant responses to context
        ]
    )

    # Create a pipeline task with parameters optimized for browser WebM audio
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,  # Sample rate for input audio
            audio_out_sample_rate=16000, # Sample rate for output audio
            allow_interruptions=True,    # Allow user to interrupt the assistant
            audio_format="webm",         # Explicitly set audio format to WebM
            raw_audio_mode=True,        # Accept raw audio data from browsers
        ),
    )

    # Set up event handlers for the WebSocket transport
    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        # Send a welcome message when a client connects
        logger.info(f"Client connected: {client.remote_address}")
        
        # Add a welcome instruction to the context
        messages.append({"role": "system", "content": "Please introduce yourself to the user."})
        
        # Queue the context frame to trigger the welcome message
        await task.queue_frames([context_aggregator.user().get_context_frame()])

    @transport.event_handler("on_session_timeout")
    async def on_session_timeout(transport, client):
        logger.info(f"Session timeout for {client.remote_address}")

        # Create a timeout handler and process the timeout
        timeout_handler = SessionTimeoutHandler(task, tts)
        await timeout_handler.handle_timeout(client.remote_address)

    # Create a pipeline runner and run the task
    runner = PipelineRunner()
    await runner.run(task)

# Routes for the Flask web application
@app.route('/')
def index():
    """Serve the main application page"""
    return render_template('index.html', bot_display_name=bot_display_name)

@app.route('/api/config')
def get_config():
    """API endpoint to get configuration for the client"""
    return jsonify({
        'bot_display_name': bot_display_name,
        'websocket_url': f'ws://localhost:{os.getenv("WEBSOCKET_PORT", "8765")}/ws'
    })

# Run the Flask app and Pipecat WebSocket server
if __name__ == '__main__':
    # Flask web server settings
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5001))
    websocket_port = int(os.getenv('WEBSOCKET_PORT', 8765))
    
    # Create a function to run the Flask app
    def run_flask_app():
        app.run(host=host, port=port, debug=False, use_reloader=False)
    
    # Start the Flask app in a separate thread
    import threading
    flask_thread = threading.Thread(target=run_flask_app)
    flask_thread.daemon = True
    flask_thread.start()
    
    logger.info(f"Flask app running on http://{host}:{port}")
    logger.info(f"WebSocket server will run on ws://{host}:{websocket_port}/ws")
    
    # Run the Pipecat pipeline
    asyncio.run(main())
