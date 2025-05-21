import datetime
from loguru import logger
from pipecat.frames.frames import LLMTextFrame, TranscriptionFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

class UserTranscriptionProcessor(FrameProcessor):
    def __init__(self, transport, serializer):
        super().__init__()
        self.transport = transport
        self.serializer = serializer
        self.client = None
        self.accumulated_text = ""
        self.last_send_time = datetime.datetime.now()
        self.send_interval = 0.8
        self.min_batch_size = 15
        logger.info("UserTranscriptionProcessor initialized")
    
    async def process_frame(self, frame, direction=None):
        await super().process_frame(frame, direction)

        # User STT output is typically a TextFrame with user_id="user"
        # (You may need to adjust this logic if your pipeline emits a different frame for user STT)
        if hasattr(frame, "user_id") and getattr(frame, "user_id", None) == "user" and hasattr(frame, "text"):
            text = frame.text
            logger.debug(f"UserTranscriptionProcessor: Processing user TextFrame: {text}")

            self.accumulated_text += text

            now = datetime.datetime.now()
            time_since_last_send = (now - self.last_send_time).total_seconds()

            should_send = (
                (time_since_last_send >= self.send_interval and len(self.accumulated_text.strip()) >= self.min_batch_size) or
                any(self.accumulated_text.endswith(p) for p in ['.', '!', '?']) or
                len(self.accumulated_text) > 100
            )

            if should_send and self.accumulated_text.strip():
                transcription_frame = TranscriptionFrame(
                    text=self.accumulated_text,
                    user_id="user",
                    timestamp=now.isoformat(),
                )

                try:
                    serialized_frame = await self.serializer.serialize(transcription_frame)
                    if self.client is not None:
                        logger.debug(f"Sending batched user transcription: {self.accumulated_text}")
                        await self.client.send(serialized_frame)
                    elif hasattr(self.transport, 'broadcast'):
                        logger.debug(f"Broadcasting user transcription: {self.accumulated_text}")
                        await self.transport.broadcast(serialized_frame)
                    elif hasattr(self.transport, '_client') and self.transport._client:
                        logger.debug(f"Sending via transport._client: {self.accumulated_text}")
                        await self.transport._client.send(serialized_frame)
                    else:
                        logger.warning(f"No method to send user transcription frame, using pipeline: {self.accumulated_text}")
                        if hasattr(self.transport, 'output'):
                            await self.transport.output().push_frame(transcription_frame, FrameDirection.DOWNSTREAM)
                        else:
                            await self.push_frame(transcription_frame, direction)
                    self.accumulated_text = ""
                    self.last_send_time = now
                except Exception as e:
                    logger.error(f"Error sending user transcription frame: {e}")
                    await self.push_frame(transcription_frame, direction)
        else:
            await self.push_frame(frame, direction) 


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