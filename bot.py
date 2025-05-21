import asyncio

import config
from serializers import CustomProtobufSerializer
from services import ServiceManager
from pipeline_manager import PipelineManager
from event_handlers import EventHandlerManager


async def main():
    """Main function to initialize and run the bot."""
    
    # Create our custom serializer
    serializer = CustomProtobufSerializer()
    
    # Set up all services
    service_manager = ServiceManager(serializer)
    services = service_manager.setup_all()
    
    # Add serializer to the services dictionary for access in other components
    services['serializer'] = serializer
    
    # Set up the pipeline and task
    pipeline_manager = PipelineManager(services)
    task, text_processor = pipeline_manager.create_task()
    
    # Set up event handlers
    EventHandlerManager(
        transport=services['transport'],
        task=task,
        tts=services['tts'],
        text_processor=text_processor,
        messages=pipeline_manager.messages,
        context_aggregator=services['context_aggregator']
    )
    
    # Run the pipeline
    await pipeline_manager.run_pipeline()


if __name__ == "__main__":
    asyncio.run(main())

