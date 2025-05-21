import os
import sys
from dotenv import load_dotenv
from loguru import logger

# Load environment variables
load_dotenv(override=True)

# Configure logger
logger.remove(0)
logger.add(sys.stderr, level="INFO")

# System message for LLM
SYSTEM_NAME = "Jarvis"
SYSTEM_MESSAGE = {
    "role": "system",
    "content": f"You are a helpful assistant named '{SYSTEM_NAME}'. Your goal is to demonstrate your capabilities in a succinct way. Your output will be converted to audio so don't include special characters in your answers. Respond to what the user said in a creative and helpful way.",
}

# Audio configuration
AUDIO_SAMPLE_RATE = 16000

# Session configuration
SESSION_TIMEOUT = 60 * 3  # 3 minutes

# API Keys
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY")

# TTS Voice ID
TTS_VOICE_ID = "71a7ad14-091c-4e8e-a314-022ece01c121"

# LLM Model
LLM_MODEL = "gpt-4o" 