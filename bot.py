import asyncio
import os
import sys

from dotenv import load_dotenv
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import BotInterruptionFrame, EndFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.network.websocket_server import (
    WebsocketServerParams,
    WebsocketServerTransport,
)

load_dotenv(override=True)

logger.remove(0)
logger.add(sys.stderr, level="DEBUG")


class SessionTimeoutHandler:
    """Handles actions to be performed when a session times out.
    Inputs:
    - task: Pipeline task (used to queue frames).
    - tts: TTS service (used to generate speech output).
    """

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
            await asyncio.sleep(15)

            # Queue both BotInterruptionFrame and EndFrame to conclude the session
            await self.task.queue_frames([BotInterruptionFrame(), EndFrame()])

            logger.info("TTS completed and EndFrame pushed successfully.")
        except Exception as e:
            logger.error(f"Error during call termination: {e}")


class Bot:
    """Main bot class that sets up and runs the conversation pipeline."""
    
    def __init__(self):
        self.transport = None
        self.llm = None
        self.stt = None
        self.tts = None
        self.context = None
        self.context_aggregator = None
        self.pipeline = None
        self.task = None
        self.runner = None
        self.messages = [
            {
                "role": "system",
                "content": "You are a helpful LLM in a WebRTC call. Your goal is to demonstrate your capabilities in a succinct way. Your output will be converted to audio so don't include special characters in your answers. Respond to what the user said in a creative and helpful way.",
            },
        ]
    
    def setup_transport(self):
        """Set up the WebSocket transport."""
        self.transport = WebsocketServerTransport(
            params=WebsocketServerParams(
                serializer=ProtobufFrameSerializer(),
                audio_out_enabled=True,
                add_wav_header=True,
                vad_enabled=True,
                vad_analyzer=SileroVADAnalyzer(),
                vad_audio_passthrough=True,
                session_timeout=60 * 3,  # 3 minutes
            )
        )
        return self.transport
    
    def setup_services(self):
        """Set up LLM, STT, and TTS services."""
        self.llm = OpenAILLMService(api_key=os.getenv("OPENAI_API_KEY"), model="gpt-4o")
        
        self.stt = DeepgramSTTService(api_key=os.getenv("DEEPGRAM_API_KEY"))
        
        # todo : this might be better suited for a different service? OpenAI? Not that this is bad? But is it the best?
        self.tts = CartesiaTTSService(
            api_key=os.getenv("CARTESIA_API_KEY"),
            voice_id="71a7ad14-091c-4e8e-a314-022ece01c121" 
            # "71a7ad14-091c-4e8e-a314-022ece01c121",  # British Reading Lady
            #"694f9389-aac1-45b6-b726-9d9369183238" # Sarah USA 
        )
    
    def setup_context(self):
        """Set up the LLM context and aggregator."""
        self.context = OpenAILLMContext(self.messages)
        self.context_aggregator = self.llm.create_context_aggregator(self.context)
    
    def setup_pipeline(self):
        """Set up the processing pipeline."""
        self.pipeline = Pipeline(
            [
                self.transport.input(),  # Websocket input from client
                self.stt,  # Speech-To-Text
                self.context_aggregator.user(),
                self.llm,  # LLM
                self.tts,  # Text-To-Speech
                self.transport.output(),  # Websocket output to client
                self.context_aggregator.assistant(),
            ]
        )
        
        self.task = PipelineTask(
            self.pipeline,
            params=PipelineParams(
                audio_in_sample_rate=16000,
                audio_out_sample_rate=16000,
                allow_interruptions=True,
            ),
        )
    
    def setup_event_handlers(self):
        """Set up event handlers for the transport."""
        @self.transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            # Kick off the conversation.
            self.messages.append({"role": "system", "content": "Please introduce yourself to the user."})
            await self.task.queue_frames([self.context_aggregator.user().get_context_frame()])

        @self.transport.event_handler("on_session_timeout")
        async def on_session_timeout(transport, client):
            logger.info(f"Entering in timeout for {client.remote_address}")
            timeout_handler = SessionTimeoutHandler(self.task, self.tts)
            await timeout_handler.handle_timeout(client)
    
    def initialize(self):
        """Initialize all components of the bot."""
        self.setup_transport()
        self.setup_services()
        self.setup_context()
        self.setup_pipeline()
        self.setup_event_handlers()
        self.runner = PipelineRunner()
    
    async def run(self):
        """Run the bot."""
        await self.runner.run(self.task)


async def main():
    """Initialize and run the bot."""
    bot = Bot()
    bot.initialize()
    await bot.run()


if __name__ == "__main__":
    asyncio.run(main())
