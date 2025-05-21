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
        try:
            # Log data details before trying to deserialize
            import binascii
            logger.debug(f"Attempting to deserialize data: length={len(data)} bytes")
            if data and len(data) > 0:
                prefix = data[:min(32, len(data))]
                hex_prefix = binascii.hexlify(prefix).decode('utf-8')
                logger.debug(f"First bytes (hex): {hex_prefix}")

                # Check first byte for field number and wire type
                if len(data) > 0:
                    first_byte = data[0]
                    field_number = first_byte >> 3
                    wire_type = first_byte & 0x7
                    logger.debug(f"Protobuf first byte analysis: {first_byte} (field_number={field_number}, wire_type={wire_type})")

            return await super().deserialize(data)
        except Exception as e:
            # Log detailed error information for debugging
            logger.error(f"Frame deserialization error: {e}")
            
            # Log binary data details
            try:
                import binascii
                logger.debug(f"Data length: {len(data)} bytes")
                if data and len(data) > 0:
                    prefix = data[:min(32, len(data))]
                    hex_prefix = binascii.hexlify(prefix).decode('utf-8')
                    logger.debug(f"First bytes (hex): {hex_prefix}")
                    
                    # Log byte by byte analysis
                    byte_analysis = []
                    for i, b in enumerate(data[:min(16, len(data))]):
                        byte_analysis.append(f"Byte {i}: {b} (0x{b:02x})")
                    logger.debug("Byte analysis: " + " | ".join(byte_analysis))
                    
                    # Try to dump raw protobuf message structure
                    try:
                        from google.protobuf.message import DecodeError
                        from google.protobuf import json_format
                        from pipecat.frames.protobufs.frames_pb2 import Frame
                        
                        # Create a test frame and try to partially parse
                        logger.debug("Attempting manual protobuf parsing...")
                        test_frame = Frame()
                        try:
                            test_frame.ParseFromString(data)
                            logger.debug(f"Partial parse successful: {json_format.MessageToJson(test_frame)}")
                        except DecodeError as parse_err:
                            logger.debug(f"Manual parsing failed: {parse_err}")
                    except ImportError as imp_err:
                        logger.debug(f"Could not import protobuf modules for manual parsing: {imp_err}")
                    except Exception as parse_err:
                        logger.debug(f"Error in manual message parsing: {parse_err}")
            except Exception as log_error:
                logger.error(f"Error logging binary data: {log_error}")
                
            # Re-raise the original exception
            raise 