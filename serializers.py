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
    
    async def deserialize(self, data):
        """Custom deserialize method to handle different frame formats from clients."""
        try:
            # First try the normal deserialization
            frame = await super().deserialize(data)
            return frame
        except Exception as e:
            # Log the initial error
            logger.error(f"Primary deserialization failed: {e}")
            
            try:
                # Handle binary audio data as a fallback
                # This is a last resort for data that might be audio but doesn't follow our protocol
                logger.debug(f"Attempting direct binary data processing for length: {len(data)}")
                
                # For audio data we'll create a raw frame that bypasses protobuf
                # But for other data types, we can't do much
                if len(data) > 100:  # Only try for data large enough to be audio
                    # Try to look for raw audio data
                    bytes_data = bytes(data)
                    
                    # Check for WAV header "RIFF"
                    riff_pos = -1
                    for i in range(min(100, len(bytes_data) - 4)):
                        if bytes_data[i:i+4] == b'RIFF':
                            riff_pos = i
                            break
                            
                    if riff_pos >= 0:
                        # Found WAV data - use it directly
                        from pipecat.frames.frames import OutputAudioRawFrame
                        logger.info(f"Found WAV header at position {riff_pos}, creating audio frame")
                        
                        # Just return a dict with the necessary information
                        return {
                            "type": "audio_raw",
                            "audio": bytes_data[riff_pos:],
                            "sample_rate": 16000,
                            "num_channels": 1
                        }
                
                logger.error("Unable to deserialize a valid frame after all fallback attempts")
                return None
            except Exception as fallback_e:
                logger.error(f"Fallback deserialization also failed: {fallback_e}")
                return None 