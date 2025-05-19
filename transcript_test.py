import asyncio
import json
import logging
import os
import subprocess
import sys
import time
import websockets
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("transcript_test")

load_dotenv(override=True)

def generate_protobuf_files():
    logger.info("Generating protobuf files from frames.proto")
    try:
        subprocess.run(
            ["python", "-m", "grpc_tools.protoc", "--proto_path=./", "--python_out=./", "frames.proto"],
            check=True
        )
        logger.info("Successfully generated protobuf files")
        
        sys.path.append(os.getcwd())
        
        import frames_pb2
        return frames_pb2
    except Exception as e:
        logger.error(f"Failed to generate protobuf files: {e}")
        sys.exit(1)

frames_pb2 = generate_protobuf_files()

connected_clients = set()

async def send_test_transcription(websocket):
    """Send test transcription frames to simulate user and AI speech"""
    await asyncio.sleep(2)
    
    logger.info("Sending user speaking notification")
    user_placeholder = frames_pb2.TranscriptionFrame()
    user_placeholder.id = 1
    user_placeholder.name = "User Speaking"
    user_placeholder.text = "User speaking..."
    user_placeholder.user_id = "test_user"
    user_placeholder.timestamp = str(time.time())
    
    frame = frames_pb2.Frame()
    frame.transcription.CopyFrom(user_placeholder)
    await websocket.send(frame.SerializeToString())
    
    await asyncio.sleep(1)
    
    logger.info("Sending user transcription")
    user_transcript = frames_pb2.TranscriptionFrame()
    user_transcript.id = 2
    user_transcript.name = "User Transcription"
    user_transcript.text = "Hello, this is a test of the transcription system."
    user_transcript.user_id = "test_user"
    user_transcript.timestamp = str(time.time())
    
    frame = frames_pb2.Frame()
    frame.transcription.CopyFrom(user_transcript)
    await websocket.send(frame.SerializeToString())
    
    await asyncio.sleep(1)
    
    logger.info("Sending AI speaking notification")
    ai_placeholder = frames_pb2.TextFrame()
    ai_placeholder.id = 3
    ai_placeholder.name = "AI Response"
    ai_placeholder.text = "AI response..."
    
    frame = frames_pb2.Frame()
    frame.text.CopyFrom(ai_placeholder)
    await websocket.send(frame.SerializeToString())
    
    await asyncio.sleep(1)
    
    logger.info("Sending AI transcription")
    ai_transcript = frames_pb2.TextFrame()
    ai_transcript.id = 4
    ai_transcript.name = "AI Transcription"
    ai_transcript.text = "I received your test message. The transcription system is working correctly!"
    
    frame = frames_pb2.Frame()
    frame.text.CopyFrom(ai_transcript)
    await websocket.send(frame.SerializeToString())
    
    await asyncio.sleep(3)
    logger.info("Test completed!")

async def handle_client(websocket, path):
    """Handle a websocket client connection"""
    client_address = websocket.remote_address
    logger.info(f"New client connection from {client_address}")
    
    connected_clients.add(websocket)
    
    try:
        asyncio.create_task(send_test_transcription(websocket))
        
        async for message in websocket:
            try:
                frame = frames_pb2.Frame()
                frame.ParseFromString(message)
                logger.info(f"Received frame from client: {frame}")
                
                await websocket.send(message)
            except Exception as e:
                logger.error(f"Error processing message: {e}")
    
    finally:
        connected_clients.remove(websocket)
        logger.info(f"Client {client_address} disconnected")

async def main():
    logger.info("Starting test WebSocket server on localhost:8765")
    async with websockets.serve(handle_client, "localhost", 8765):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
