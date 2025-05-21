from loguru import logger
from handlers import SessionTimeoutHandler
from pipecat.frames.frames import TextFrame
import asyncio


class EventHandlerManager:
    """Manages the event handlers for WebSocket connections."""
    
    def __init__(self, transport, task, tts, text_processor, messages, context_aggregator):
        """Initialize the event handler manager.
        
        Args:
            transport: The WebSocket transport.
            task: The pipeline task.
            tts: The Text-to-Speech service.
            text_processor: The text transcription processor.
            messages: The messages list for the LLM context.
            context_aggregator: The context aggregator for the LLM.
        """
        self.transport = transport
        self.task = task
        self.tts = tts
        self.text_processor = text_processor
        self.messages = messages
        self.context_aggregator = context_aggregator
        
        # Register the event handlers
        self.register_handlers()
    
    def register_handlers(self):
        """Register the WebSocket event handlers."""
        
        @self.transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            try:
                # Make the client accessible to our processor
                self.text_processor.client = client  # Store the client connection
                logger.info(f"Client connected and stored in TextTranscriptionProcessor: {client.remote_address}")
                
                # Send a simple text frame first to test connectivity
                try:
                    test_frame = TextFrame(
                        text="Initializing connection...",
                        timestamp="0"
                    )
                    serialized = await transport.serializer.serialize(test_frame)
                    logger.debug(f"Sending test frame to new client: {serialized[:20]}...")
                    await client.send(serialized)
                    logger.info("Test frame sent successfully")
                    
                    # Small delay to ensure test frame is processed
                    await asyncio.sleep(0.5)
                except Exception as e:
                    logger.error(f"Error sending test frame: {e}")
                
                # Kick off the conversation
                logger.info("Queueing introduction message")
                self.messages.append({"role": "system", "content": "Please introduce yourself to the user."})
                await self.task.queue_frames([self.context_aggregator.user().get_context_frame()])
                logger.info("Introduction message queued successfully")
            except Exception as e:
                logger.error(f"Error in on_client_connected handler: {e}")
                # Try to recover by clearing any existing connections and state
                try:
                    if client:
                        await client.close()
                except:
                    pass
        
        @self.transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            logger.info(f"Client disconnected: {client.remote_address}")
            # Clear the client reference in our processor
            if self.text_processor.client == client:
                self.text_processor.client = None

        @self.transport.event_handler("on_session_timeout")
        async def on_session_timeout(transport, client):
            logger.info(f"Entering in timeout for {client.remote_address}")

            timeout_handler = SessionTimeoutHandler(self.task, self.tts)

            await timeout_handler.handle_timeout(client.remote_address) 