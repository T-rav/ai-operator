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

# Main function to set up and run the Pipecat pipeline
async def main():
    # Create a WebSocket server transport for real-time audio streaming
    transport = WebsocketServerTransport(
        params=WebsocketServerParams(
            serializer=ProtobufFrameSerializer(),
            audio_out_enabled=True,  # Enable audio output
            add_wav_header=True,     # Add WAV header to audio chunks
            vad_enabled=True,        # Enable Voice Activity Detection
            vad_analyzer=SileroVADAnalyzer(),  # Use Silero VAD for speech detection
            vad_audio_passthrough=True,  # Pass through audio even when no speech is detected
            session_timeout=180,     # 3 minutes timeout
        )
    )

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

    # Create a pipeline task with parameters
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,  # Sample rate for input audio
            audio_out_sample_rate=16000, # Sample rate for output audio
            allow_interruptions=True,    # Allow user to interrupt the assistant
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
        'websocket_url': f'ws://{os.getenv("HOST", "localhost")}:{os.getenv("WEBSOCKET_PORT", "8765")}/ws'
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
