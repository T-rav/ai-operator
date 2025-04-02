import os
import sys
import asyncio
from dotenv import load_dotenv
from loguru import logger
from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from fastapi import Request

from pipecat.transports.network.fastapi_websocket import (
    FastAPIWebsocketTransport,
    FastAPIWebsocketParams
)
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.serializers.twilio import TwilioFrameSerializer

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
            serializer=TwilioFrameSerializer(),
        )
    )

    # Create pipeline with the transport
    pipeline = Pipeline([
        transport.input(),    # Handle incoming audio
        stt,                  # Speech-to-text
        llm,                  # Language model
        tts,                  # Text-to-speech
        transport.output()    # Handle outgoing audio
    ])

    # Run pipeline
    task = PipelineTask(pipeline)
    await PipelineRunner().run(task)

if __name__ == '__main__':
    import uvicorn
    
    # Server settings
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5001))
    
    logger.info(f"Starting server on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port)
