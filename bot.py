#
# Copyright (c) 2024–2025, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

import asyncio
import os
import sys
import datetime

from dotenv import load_dotenv
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import BotInterruptionFrame, EndFrame, TextFrame, LLMTextFrame, TranscriptionFrame
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
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

# Custom serializer that converts TextFrames to Transcription frames
class CustomProtobufSerializer(ProtobufFrameSerializer):
    def __init__(self):
        super().__init__()
        logger.info("CustomProtobufSerializer initialized")

    async def serialize(self, frame):
        # Only log TextFrames, not audio frames
        if not (hasattr(frame, '__class__') and frame.__class__.__name__ == 'OutputAudioRawFrame'):
            logger.debug(f"Serializing frame type: {type(frame).__name__}")
        
        # Special handling for TranscriptionFrame 
        if isinstance(frame, TranscriptionFrame):
            try:
                # Create a field with both formats to ensure client can read it
                frame.user_id = 'ai'  # Standard snake_case format
                logger.debug(f"Set TranscriptionFrame user_id to 'ai'")
            except Exception as e:
                logger.error(f"Error processing TranscriptionFrame: {e}")
            
        # Use the normal serialization for all frames
        return await super().serialize(frame)

# A custom processor to capture and convert LLM text frames directly
class TextTranscriptionProcessor(FrameProcessor):
    def __init__(self, transport, serializer):
        super().__init__()
        self.transport = transport
        self.serializer = serializer
        self.client = None  # Add a client attribute to store the connection
        self.accumulated_text = ""  # Store accumulated text
        self.last_send_time = datetime.datetime.now()
        self.send_interval = 0.8  # Increased time between sends to batch more words
        self.min_batch_size = 15  # Minimum number of characters before sending
        logger.info("TextTranscriptionProcessor initialized")
    
    async def process_frame(self, frame, direction=None):
        # Make sure to call the parent's process_frame method first
        await super().process_frame(frame, direction)
        
        # If this is an LLMTextFrame, create a transcription frame
        if isinstance(frame, LLMTextFrame):
            text = frame.text if hasattr(frame, 'text') else str(frame)
            logger.debug(f"TextTranscriptionProcessor: Processing LLMTextFrame: {text}")
            
            # First pass through the original frame for TTS conversion
            await self.push_frame(frame, direction)
            
            # Accumulate text
            self.accumulated_text += text
            
            # Check if we should send the accumulated text
            # We want to send complete sentences or phrases whenever possible
            now = datetime.datetime.now()
            time_since_last_send = (now - self.last_send_time).total_seconds()
            
            # Send if: 
            # 1. It's been at least send_interval seconds since the last send
            # 2. We have accumulated text that ends with sentence-ending punctuation
            # 3. We have a minimum amount of text accumulated
            should_send = (
                (time_since_last_send >= self.send_interval and len(self.accumulated_text.strip()) >= self.min_batch_size) or
                any(self.accumulated_text.endswith(p) for p in ['.', '!', '?']) or
                len(self.accumulated_text) > 100  # Some reasonable max length
            )
            
            if should_send and self.accumulated_text.strip():
                # Create a TranscriptionFrame with the accumulated text
                transcription_frame = TranscriptionFrame(
                    text=self.accumulated_text,
                    user_id="ai",  # This must be explicitly set to 'ai'
                    timestamp=now.isoformat()
                )
                
                # Send the transcription frame
                try:
                    # Serialize the transcription frame
                    serialized_frame = await self.serializer.serialize(transcription_frame)
                    
                    # Try using our stored client reference first
                    if self.client is not None:
                        logger.debug(f"Sending batched transcription: {self.accumulated_text}")
                        await self.client.send(serialized_frame)
                    # Otherwise try transport methods
                    elif hasattr(self.transport, 'broadcast'):
                        logger.debug(f"Broadcasting transcription: {self.accumulated_text}")
                        await self.transport.broadcast(serialized_frame)
                    elif hasattr(self.transport, '_client') and self.transport._client:
                        logger.debug(f"Sending via transport._client: {self.accumulated_text}")
                        await self.transport._client.send(serialized_frame)
                    else:
                        logger.warning(f"No method to send transcription frame, using pipeline: {self.accumulated_text}")
                        # Use WebsocketServerOutputTransport for output
                        if hasattr(self.transport, 'output'):
                            await self.transport.output().push_frame(transcription_frame, FrameDirection.DOWNSTREAM)
                        else:
                            # Last resort: push to normal pipeline
                            await self.push_frame(transcription_frame, direction)
                    
                    # Reset accumulated text and update last send time
                    self.accumulated_text = ""
                    self.last_send_time = now
                except Exception as e:
                    logger.error(f"Error sending transcription frame: {e}")
                    # Try the pipeline as fallback
                    await self.push_frame(transcription_frame, direction)
        else:
            # For any non-LLMTextFrame, just pass it through
            await self.push_frame(frame, direction)

load_dotenv(override=True)

logger.remove(0)
logger.add(sys.stderr, level="INFO")


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


async def main():
    # Create our custom serializer
    serializer = CustomProtobufSerializer()
    
    transport = WebsocketServerTransport(
        params=WebsocketServerParams(
            serializer=serializer,  # Use our custom serializer
            audio_out_enabled=True,
            add_wav_header=True,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
            vad_audio_passthrough=True,
            session_timeout=60 * 3,  # 3 minutes
        )
    )

    llm = OpenAILLMService(api_key=os.getenv("OPENAI_API_KEY"), model="gpt-4o")

    stt = DeepgramSTTService(api_key=os.getenv("DEEPGRAM_API_KEY"))

    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        voice_id="71a7ad14-091c-4e8e-a314-022ece01c121"
    )

    # Create our custom processor to handle text frames
    text_processor = TextTranscriptionProcessor(transport, serializer)

    messages = [
        {
            "role": "system",
            "content": "You are a helpful LLM in a WebRTC call. Your goal is to demonstrate your capabilities in a succinct way. Your output will be converted to audio so don't include special characters in your answers. Respond to what the user said in a creative and helpful way.",
        },
    ]

    context = OpenAILLMContext(messages)
    context_aggregator = llm.create_context_aggregator(context)

    pipeline = Pipeline(
        [
            transport.input(),  # Websocket input from client
            stt,  # Speech-To-Text
            context_aggregator.user(),
            llm,  # LLM
            text_processor,  # Our custom processor to handle LLM text
            tts,  # Text-To-Speech
            transport.output(),  # Websocket output to client
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,
            audio_out_sample_rate=16000,
            allow_interruptions=True,
        ),
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        # Make the client accessible to our processor
        text_processor.client = client  # Store the client connection
        logger.info(f"Client connected and stored in TextTranscriptionProcessor: {client.remote_address}")
        # Kick off the conversation.
        messages.append({"role": "system", "content": "Please introduce yourself to the user."})
        await task.queue_frames([context_aggregator.user().get_context_frame()])

    @transport.event_handler("on_session_timeout")
    async def on_session_timeout(transport, client):
        logger.info(f"Entering in timeout for {client.remote_address}")

        timeout_handler = SessionTimeoutHandler(task, tts)

        await timeout_handler.handle_timeout(client)

    runner = PipelineRunner()

    await runner.run(task)


if __name__ == "__main__":
    asyncio.run(main())

