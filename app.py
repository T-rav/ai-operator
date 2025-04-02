import os
import sys
import asyncio
import threading
from dotenv import load_dotenv
from loguru import logger

# Import our modularized components
from modules.pipeline_manager import start_pipeline
from modules.flask_app import run_flask_app

# Load environment variables
load_dotenv('.env')

# Configure logging
logger.remove(0)
logger.add(sys.stderr, level="INFO")

# AI Operator configuration
bot_display_name = os.getenv('BOT_DISPLAY_NAME', 'AI Operator')
voice_model = os.getenv('VOICE_MODEL', 'tts-1')
voice_voice = os.getenv('VOICE_VOICE', 'alloy')
llm_model = os.getenv('LLM_MODEL', 'gpt-4o')

# Run the Flask app and Pipecat WebSocket server
if __name__ == '__main__':
    # Flask web server settings
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5001))
    websocket_port = int(os.getenv('WEBSOCKET_PORT', 8765))
    
    # Start the Flask app in a separate thread
    flask_thread = threading.Thread(
        target=run_flask_app,
        args=(host, port, bot_display_name)
    )
    flask_thread.daemon = True
    flask_thread.start()
    
    logger.info(f"Flask app running on http://{host}:{port}")
    logger.info(f"WebSocket server will run on ws://{host}:{websocket_port}/ws")
    
    # Run the Pipecat pipeline
    asyncio.run(start_pipeline(bot_display_name, voice_model, voice_voice, llm_model))
