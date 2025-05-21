from loguru import logger
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.pipeline.runner import PipelineRunner

import config
from processors import TextTranscriptionProcessor


class PipelineManager:
    """Manages the creation and running of the bot's pipeline."""
    
    def __init__(self, services):
        """Initialize the pipeline manager with services.
        
        Args:
            services: Dictionary containing the services (transport, llm, stt, tts, context_aggregator)
        """
        self.services = services
        self.pipeline = None
        self.task = None
        self.runner = None
        self.messages = [config.SYSTEM_MESSAGE]
        
    def setup_text_processor(self):
        """Create and return the text processor."""
        # Use the serializer passed directly from services
        return TextTranscriptionProcessor(
            self.services['transport'], 
            self.services['serializer']
        )
    
    def setup_user_transcription_processor(self):
        """Create and return the user transcription processor."""
        return UserTranscriptionProcessor(
            self.services['transport'], 
            self.services['serializer']
        )

    def create_pipeline(self):
        """Create the main pipeline with all components."""
        text_processor = self.setup_text_processor()
        user_transcription_processor = self.setup_user_transcription_processor()
        
        self.pipeline = Pipeline(
            [
                self.services['transport'].input(),  # Websocket input from client
                self.services['stt'],  # Speech-To-Text
                user_transcription_processor,        # New: Emit user transcription
                self.services['context_aggregator'].user(),
                self.services['llm'],  # LLM
                text_processor,  # Our custom processor to handle LLM text
                self.services['tts'],  # Text-To-Speech
                self.services['transport'].output(),  # Websocket output to client
                self.services['context_aggregator'].assistant(),
            ]
        )
        
        return self.pipeline, text_processor
    
    def create_task(self):
        """Create a pipeline task with the configured pipeline."""
        self.pipeline, text_processor = self.create_pipeline()
        
        self.task = PipelineTask(
            self.pipeline,
            params=PipelineParams(
                audio_in_sample_rate=config.AUDIO_SAMPLE_RATE,
                audio_out_sample_rate=config.AUDIO_SAMPLE_RATE,
                allow_interruptions=True,
            ),
        )
        
        return self.task, text_processor
    
    async def run_pipeline(self):
        """Run the pipeline using the PipelineRunner."""
        self.runner = PipelineRunner()
        await self.runner.run(self.task) 