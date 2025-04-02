import asyncio
import websockets
import json
from loguru import logger
from pipecat.frames.frames import AudioRawFrame

class DirectWebSocketServer:
    """
    A direct WebSocket server implementation that handles raw WebM audio data
    and forwards it to the Pipecat pipeline task.
    """
    
    def __init__(self, host, port, path, pipeline_task):
        self.host = host
        self.port = port
        self.path = path
        self.pipeline_task = pipeline_task
        self.clients = set()
        self.server = None
        self.webm_header = None
        self.is_first_chunk = True
        
    async def start(self):
        """Start the WebSocket server"""
        # Create a handler that checks if the path matches before calling the real handler
        async def path_router(websocket, path):
            if path == self.path:
                await self.handle_connection(websocket, path)
            else:
                logger.warning(f"Rejected connection to invalid path: {path}")
                await websocket.close(1008, f"Invalid path: {path}")
                
        self.server = await websockets.serve(
            path_router,
            self.host,
            self.port,
            max_size=10485760,  # 10MB max message size
            ping_interval=10,   # Send ping every 10 seconds
            ping_timeout=30,    # 30 seconds ping timeout
        )
        logger.info(f"Direct WebSocket server running on ws://{self.host}:{self.port}{self.path}")
        
    async def handle_connection(self, websocket, path):
        """Handle a WebSocket connection"""
        client_address = websocket.remote_address
        logger.info(f"Client connected: {client_address}")
        self.clients.add(websocket)
        
        try:
            # Send a welcome message to the client
            await websocket.send(json.dumps({
                'type': 'connection',
                'status': 'connected',
                'message': 'Connected to AI Operator WebSocket server'
            }))
            
            # Process incoming messages
            async for message in websocket:
                if isinstance(message, bytes):
                    # Process binary audio data
                    await self.handle_audio_data(message)
                elif isinstance(message, str):
                    # Process text messages (commands, etc.)
                    await self.handle_text_message(websocket, message)
        except websockets.exceptions.ConnectionClosed as e:
            logger.info(f"Client disconnected: {client_address} - {e}")
        except Exception as e:
            logger.error(f"Error in WebSocket handler: {e}")
        finally:
            # Clean up when the connection is closed
            self.clients.remove(websocket)
            logger.info(f"Client disconnected: {client_address}")
            
    async def handle_audio_data(self, audio_data):
        """Process incoming audio data"""
        try:
            # Skip empty audio chunks
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
            
            # Create an AudioRawFrame with the processed audio data
            audio_frame = AudioRawFrame(data=processed_chunk, format="webm")
            
            # Queue the audio frame to the pipeline task
            await self.pipeline_task.queue_frames([audio_frame])
            logger.debug(f"Queued {len(processed_chunk)} bytes of audio data to pipeline")
        except Exception as e:
            logger.error(f"Error processing audio data: {e}")
            
    async def handle_text_message(self, websocket, message):
        """Process incoming text messages"""
        try:
            # Parse the message as JSON
            data = json.loads(message)
            logger.info(f"Received text message: {data}")
            
            # Handle different message types
            msg_type = data.get('type', '')
            
            if msg_type == 'ping':
                # Respond to ping messages to keep the connection alive
                await websocket.send(json.dumps({'type': 'pong'}))
                logger.debug("Sent pong response to ping")
                
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
            
    async def broadcast(self, message):
        """Broadcast a message to all connected clients"""
        if not self.clients:
            return
            
        # Convert message to JSON if it's not already a string
        if not isinstance(message, (str, bytes)):
            message = json.dumps(message)
            
        # Send the message to all clients
        await asyncio.gather(
            *[client.send(message) for client in self.clients],
            return_exceptions=True
        )
        
    async def stop(self):
        """Stop the WebSocket server"""
        if self.server:
            self.server.close()
            await self.server.wait_closed()
            logger.info("WebSocket server stopped")
