from loguru import logger
from pipecat.frames.frames import TranscriptionFrame
from pipecat.serializers.protobuf import ProtobufFrameSerializer


class CustomProtobufSerializer(ProtobufFrameSerializer):
    def __init__(self):
        super().__init__()
        logger.info("CustomProtobufSerializer initialized")

    async def serialize(self, frame):
        # Only log TextFrames, not audio frames
        if not (hasattr(frame, '__class__') and frame.__class__.__name__ == 'OutputAudioRawFrame'):
            logger.debug(f"Serializing frame type: {type(frame).__name__}")
        
        # Special handling for TranscriptionFrame 
        if isinstance(frame, TranscriptionFrame):
            try:
                # Create a field with both formats to ensure client can read it
                frame.user_id = 'ai'  # Standard snake_case format
                logger.debug(f"Set TranscriptionFrame user_id to 'ai'")
            except Exception as e:
                logger.error(f"Error processing TranscriptionFrame: {e}")
            
        # Use the normal serialization for all frames
        return await super().serialize(frame) 