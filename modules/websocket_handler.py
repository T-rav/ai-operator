import json
import asyncio
from loguru import logger

class CustomWebSocketHandler:
    def __init__(self, pipeline_task):
        self.pipeline_task = pipeline_task
        self.clients = set()
        self.audio_buffer = bytearray()
        self.webm_header = None
        self.is_first_chunk = True
        
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
            
            # Store WebM header from the first chunk with a valid header
            if has_webm_header and (self.webm_header is None or self.is_first_chunk):
                # Find the end of the header (EBML header + Segment header)
                # This is a simplification - in a real implementation, you'd parse the WebM structure
                # For now, we'll just store the first part of the chunk with the header
                header_size = min(1024, len(audio_data))  # Take up to 1KB as header
                self.webm_header = audio_data[:header_size]
                self.is_first_chunk = False
                logger.debug(f"Stored WebM header of size {header_size} bytes")
            
            # If this chunk doesn't have a header but we have one stored, prepend it
            processed_chunk = audio_data
            if not has_webm_header and self.webm_header is not None:
                processed_chunk = self.webm_header + audio_data
                logger.debug(f"Added WebM header to chunk, new size: {len(processed_chunk)} bytes")
            
            # Add the audio data to the pipeline task
            # This will be processed by the STT service
            await self.pipeline_task.process_audio(processed_chunk)
            logger.debug(f"Processed {len(processed_chunk)} bytes of audio data")
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
