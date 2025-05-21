from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.network.websocket_server import (
    WebsocketServerParams,
    WebsocketServerTransport,
)

import config


class ServiceManager:
    """Manages the creation and configuration of services used in the bot."""
    
    def __init__(self, serializer):
        """Initialize the service manager with a serializer."""
        self.serializer = serializer
        self.transport = None
        self.llm = None
        self.stt = None
        self.tts = None
        self.context = None
        self.context_aggregator = None
    
    def setup_transport(self):
        """Create and configure the WebSocket transport."""
        self.transport = WebsocketServerTransport(
            params=WebsocketServerParams(
                serializer=self.serializer,
                audio_out_enabled=True,
                add_wav_header=True,
                vad_enabled=True,
                vad_analyzer=SileroVADAnalyzer(),
                vad_audio_passthrough=True,
                session_timeout=config.SESSION_TIMEOUT,
            )
        )
        return self.transport
    
    def setup_llm(self):
        """Create and configure the LLM service."""
        self.llm = OpenAILLMService(
            api_key=config.OPENAI_API_KEY, 
            model=config.LLM_MODEL
        )
        return self.llm
    
    def setup_stt(self):
        """Create and configure the Speech-to-Text service."""
        self.stt = DeepgramSTTService(
            api_key=config.DEEPGRAM_API_KEY
        )
        return self.stt
    
    def setup_tts(self):
        """Create and configure the Text-to-Speech service."""
        self.tts = CartesiaTTSService(
            api_key=config.CARTESIA_API_KEY,
            voice_id=config.TTS_VOICE_ID
        )
        return self.tts
    
    def setup_context(self, messages=None):
        """Create and configure the LLM context and context aggregator."""
        if messages is None:
            messages = [config.SYSTEM_MESSAGE]
            
        self.context = OpenAILLMContext(messages)
        self.context_aggregator = self.llm.create_context_aggregator(self.context)
        return self.context_aggregator
    
    def setup_all(self, messages=None):
        """Set up all services and return them as a dictionary."""
        self.setup_transport()
        self.setup_llm()
        self.setup_stt()
        self.setup_tts()
        self.setup_context(messages)
        
        return {
            'transport': self.transport,
            'llm': self.llm,
            'stt': self.stt,
            'tts': self.tts,
            'context': self.context,
            'context_aggregator': self.context_aggregator
        } 