from loguru import logger
from pipecat.frames.frames import TranscriptionFrame
from pipecat.serializers.protobuf import ProtobufFrameSerializer
# Import correct protobuf definitions from pipecat
from pipecat.frames.protobufs.frames_pb2 import Frame, AudioRawFrame


class CustomProtobufSerializer(ProtobufFrameSerializer):
    def __init__(self):
        super().__init__()
        logger.info("CustomProtobufSerializer initialized")

    async def serialize(self, frame):
        # Add more detailed logging for audio frames
        if hasattr(frame, '__class__') and frame.__class__.__name__ == 'OutputAudioRawFrame':
            try:
                # Log audio frame details without dumping the entire frame
                audio_length = len(frame.audio) if hasattr(frame, 'audio') else 0
                sample_rate = frame.sample_rate if hasattr(frame, 'sample_rate') else 'unknown'
                logger.debug(f"Serializing audio frame: length={audio_length}, sample_rate={sample_rate}")
                
                # Check if audio is empty
                if audio_length == 0:
                    logger.warning("Empty audio frame detected, this won't play in the browser")
                
                # Important: Make sure we map OutputAudioRawFrame to AudioRawFrame in protobuf
                if hasattr(frame, 'name') and frame.name != 'AudioRawFrame':
                    logger.debug(f"Changing audio frame name from '{frame.name}' to 'AudioRawFrame'")
                    frame.name = 'AudioRawFrame'
                    
                # Ensure pts field is set
                if not hasattr(frame, 'pts') or frame.pts is None:
                    logger.debug("Setting missing pts field on audio frame")
                    frame.pts = 0
            except Exception as e:
                logger.error(f"Error processing audio frame: {e}")
        elif hasattr(frame, '__class__'):
            logger.debug(f"Serializing frame type: {frame.__class__.__name__}")
        
        # Special handling for TranscriptionFrame 
        if isinstance(frame, TranscriptionFrame):
            try:
                # Create a field with both formats to ensure client can read it
                frame.user_id = 'ai'  # Standard snake_case format
                logger.debug(f"Set TranscriptionFrame user_id to 'ai'")
            except Exception as e:
                logger.error(f"Error processing TranscriptionFrame: {e}")
            
        # Use the normal serialization for all frames
        serialized = await super().serialize(frame)
        
        # Log serialization results for debugging
        if serialized:
            logger.debug(f"Serialized frame size: {len(serialized)} bytes")
            if len(serialized) == 0:
                logger.warning("Serialization produced empty data - this won't work!")
                
        return serialized
        
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
                        # Use the official pipecat protobuf definition
                        from pipecat.frames.protobufs.frames_pb2 import Frame
                        
                        # Create a test frame and try to partially parse
                        logger.debug("Attempting manual protobuf parsing...")
                        
                        # Log expected protobuf structure details
                        logger.debug(f"Expected Frame fields: {Frame.DESCRIPTOR.fields_by_name.keys()}")
                        if 'audio' in Frame.DESCRIPTOR.fields_by_name:
                            audio_field = Frame.DESCRIPTOR.fields_by_name['audio']
                            logger.debug(f"Audio field type: {audio_field.type}, message_type: {audio_field.message_type.name if audio_field.message_type else 'None'}")
                            if audio_field.message_type:
                                logger.debug(f"AudioFrame expected fields: {audio_field.message_type.fields_by_name.keys()}")
                        
                        # Check for oneof fields
                        if Frame.DESCRIPTOR.oneofs:
                            logger.debug(f"Frame has oneofs: {[o.name for o in Frame.DESCRIPTOR.oneofs]}")
                            for oneof in Frame.DESCRIPTOR.oneofs:
                                logger.debug(f"Oneof '{oneof.name}' fields: {[f.name for f in oneof.fields]}")
                        
                        # Try to parse the whole message
                        test_frame = Frame()
                        try:
                            test_frame.ParseFromString(data)
                            logger.debug(f"Partial parse successful: {json_format.MessageToJson(test_frame)}")
                        except DecodeError as parse_err:
                            logger.debug(f"Manual parsing failed: {parse_err}")
                            
                            # Log specific error location info if available
                            if "invalid wire type" in str(parse_err):
                                logger.debug("Common issue: invalid wire type suggests field type mismatch")
                    except ImportError as imp_err:
                        logger.debug(f"Could not import protobuf modules for manual parsing: {imp_err}")
                    except Exception as parse_err:
                        logger.debug(f"Error in manual message parsing: {parse_err}")
            except Exception as log_error:
                logger.error(f"Error logging binary data: {log_error}")
                
            # Re-raise the original exception
            raise 