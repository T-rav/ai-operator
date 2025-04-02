import os
import asyncio
from loguru import logger

from pipecat.frames.frames import BotInterruptionFrame
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

from modules.session_timeout_handler import SessionTimeoutHandler

class PipelineManager:
    def __init__(self, bot_display_name, voice_model, voice_voice, llm_model):
        self.bot_display_name = bot_display_name
        self.voice_model = voice_model
        self.voice_voice = voice_voice
        self.llm_model = llm_model
        self.transport = None
        self.task = None
        self.runner = None
        self.tts = None
        
    def initialize_transport(self):
        """Initialize the WebSocket transport for real-time audio streaming"""
        self.transport = WebsocketServerTransport(
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
        
        logger.info("WebSocket transport initialized with custom handler for raw audio data")
        return self.transport
        
    def initialize_services(self):
        """Initialize OpenAI services with API keys from environment variables"""
        llm = OpenAILLMService(api_key=os.getenv("OPENAI_API_KEY"), model=self.llm_model)
        stt = OpenAISTTService(api_key=os.getenv("OPENAI_API_KEY"))
        self.tts = OpenAITTSService(
            api_key=os.getenv("OPENAI_API_KEY"),
            voice=self.voice_voice,
            model=self.voice_model
        )
        
        return llm, stt, self.tts
        
    def create_context(self):
        """Set up the conversation context with system prompt"""
        messages = [
            {
                "role": "system",
                "content": "You are an AI voice assistant named Tracey. Keep your responses concise and helpful. Your goal is to provide clear, accurate information and assistance.",
            },
        ]
        
        return messages
        
    def setup_pipeline(self, messages):
        """Build and configure the complete pipeline"""
        # Initialize services
        llm, stt, tts = self.initialize_services()
        
        # Create context and aggregator
        context = OpenAILLMContext(messages)
        context_aggregator = llm.create_context_aggregator(context)
        
        # Build the pipeline
        pipeline = Pipeline(
            [
                self.transport.input(),         # WebSocket input from client
                stt,                           # Speech-To-Text using OpenAI
                context_aggregator.user(),     # Add user messages to context
                llm,                           # Language model for generating responses
                tts,                           # Text-To-Speech using OpenAI
                self.transport.output(),       # WebSocket output to client
                context_aggregator.assistant(), # Add assistant responses to context
            ]
        )
        
        # Create a pipeline task
        self.task = PipelineTask(
            pipeline,
            params=PipelineParams(
                audio_in_sample_rate=16000,  # Sample rate for input audio
                audio_out_sample_rate=16000, # Sample rate for output audio
                allow_interruptions=True,    # Allow user to interrupt the assistant
                audio_format="webm",         # Explicitly set audio format to WebM
                raw_audio_mode=True,        # Accept raw audio data from browsers
            ),
        )
        
        # Set up event handlers
        self.setup_event_handlers(messages, context_aggregator)
        
        return self.task
        
    def setup_event_handlers(self, messages, context_aggregator):
        """Set up event handlers for the WebSocket transport"""
        
        @self.transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            # Send a welcome message when a client connects
            logger.info(f"Client connected: {client.remote_address}")
            
            # Add a welcome instruction to the context
            messages.append({"role": "system", "content": "Please introduce yourself to the user."})
            
            # Queue the context frame to trigger the welcome message
            await self.task.queue_frames([context_aggregator.user().get_context_frame()])
        
        @self.transport.event_handler("on_session_timeout")
        async def on_session_timeout(transport, client):
            logger.info(f"Session timeout for {client.remote_address}")
            
            # Create a timeout handler and process the timeout
            timeout_handler = SessionTimeoutHandler(self.task, self.tts)
            await timeout_handler.handle_timeout(client.remote_address)
    
    async def run(self):
        """Run the pipeline"""
        # Initialize transport
        self.initialize_transport()
        
        # Create context
        messages = self.create_context()
        
        # Setup pipeline
        self.setup_pipeline(messages)
        
        # Create a pipeline runner and run the task
        self.runner = PipelineRunner()
        await self.runner.run(self.task)

async def start_pipeline(bot_display_name, voice_model, voice_voice, llm_model):
    """Main function to set up and run the Pipecat pipeline"""
    pipeline_manager = PipelineManager(bot_display_name, voice_model, voice_voice, llm_model)
    await pipeline_manager.run()
