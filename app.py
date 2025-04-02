import os
import sys
import asyncio
from dotenv import load_dotenv
from loguru import logger
from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi import Request

from pipecat.transports.network.fastapi_websocket import (
    FastAPIWebsocketTransport,
    FastAPIWebsocketParams
)
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.stt import OpenAISTTService
from pipecat.services.openai.tts import OpenAITTSService

# Load environment variables
load_dotenv('.env')

# Configure logging
logger.remove(0)
logger.add(sys.stderr, level="INFO")

# AI Operator configuration
bot_display_name = os.getenv('BOT_DISPLAY_NAME', 'AI Operator')
voice_model = os.getenv('VOICE_MODEL', 'tts-1')
voice_voice = os.getenv('VOICE_VOICE', 'alloy')
llm_model = os.getenv('LLM_MODEL', 'gpt-4')

# Initialize services
openai_service = OpenAILLMService(
    api_key=os.getenv('OPENAI_API_KEY'),
    model=llm_model
)

whisper_service = OpenAISTTService(
    api_key=os.getenv('OPENAI_API_KEY'),
    model="whisper-1"
)

tts_service = OpenAITTSService(
    api_key=os.getenv('OPENAI_API_KEY'),
    model=voice_model,
    voice=voice_voice
)

# Initialize FastAPI app
app = FastAPI()

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "bot_name": bot_display_name}
    )

@app.get("/api/config")
async def get_config():
    """Return configuration settings for the frontend."""
    return JSONResponse({
        "bot_name": bot_display_name,
        "voice_model": voice_model,
        "voice_voice": voice_voice,
        "llm_model": llm_model,
        "websocket_url": "/ws"  # Relative path for WebSocket connection
    })

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # Configure transport with VAD and audio output
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_out_enabled=True,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
            vad_audio_passthrough=True,
            serializer=ProtobufFrameSerializer(),
        )
    )

    # Create pipeline with the transport
    pipeline = Pipeline([
        transport.input(),    # Handle incoming audio
        whisper_service,      # Speech-to-text
        openai_service,       # Language model
        tts_service,          # Text-to-speech
        transport.output()    # Handle outgoing audio
    ])

    # Run pipeline
    await pipeline.run()

if __name__ == '__main__':
    import uvicorn
    
    # Server settings
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5001))
    
    logger.info(f"Starting server on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port)
