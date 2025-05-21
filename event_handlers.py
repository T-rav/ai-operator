from loguru import logger
from handlers import SessionTimeoutHandler


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
            # Make the client accessible to our processor
            self.text_processor.client = client  # Store the client connection
            logger.info(f"Client connected and stored in TextTranscriptionProcessor: {client.remote_address}")
            
            # Log transport and client details for debugging
            logger.debug(f"Transport details: id={id(transport)}, type={type(transport).__name__}")
            logger.debug(f"Client details: id={id(client)}, type={type(client).__name__}")
            
            # Log serializer info
            if hasattr(transport, 'serializer'):
                logger.debug(f"Transport serializer: {type(transport.serializer).__name__}")
            
            # Kick off the conversation.
            logger.debug("Adding initial system message")
            self.messages.append({"role": "system", "content": "Please introduce yourself to the user."})
            
            logger.debug("Queueing context frame to start conversation")
            await self.task.queue_frames([self.context_aggregator.user().get_context_frame()])
            logger.debug("on_client_connected handler completed")

        @self.transport.event_handler("on_session_timeout")
        async def on_session_timeout(transport, client):
            logger.info(f"Entering in timeout for {client.remote_address}")

            timeout_handler = SessionTimeoutHandler(self.task, self.tts)

            await timeout_handler.handle_timeout(client.remote_address) 