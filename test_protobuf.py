"""
Test script to verify protobuf serialization works correctly.
"""
from loguru import logger
import sys
from pipecat.frames.protobufs.frames_pb2 import Frame, AudioRawFrame, TranscriptionFrame

# Configure logger
logger.remove()
logger.add(sys.stderr, level="DEBUG")

def test_audio_frame():
    """Test creating and serializing an AudioFrame."""
    logger.info("Testing AudioRawFrame serialization...")
    
    # Create a simple audio frame
    audio_frame = AudioRawFrame()
    audio_frame.id = 1
    audio_frame.name = "AudioRawFrame"
    audio_frame.audio = b'\x01\x02\x03\x04'  # Simple binary data
    audio_frame.sample_rate = 16000
    audio_frame.num_channels = 1
    audio_frame.pts = 123456
    
    # Create a Frame to wrap it
    frame = Frame()
    frame.audio.CopyFrom(audio_frame)
    
    # Serialize to binary
    serialized = frame.SerializeToString()
    logger.info(f"Serialized frame size: {len(serialized)} bytes")
    
    # Deserialize from binary
    new_frame = Frame()
    new_frame.ParseFromString(serialized)
    
    # Verify fields
    logger.info(f"Deserialized audio frame - id: {new_frame.audio.id}, name: {new_frame.audio.name}")
    logger.info(f"  sample_rate: {new_frame.audio.sample_rate}, channels: {new_frame.audio.num_channels}")
    logger.info(f"  audio length: {len(new_frame.audio.audio)} bytes")
    
    # Verify serialization matches
    assert new_frame.audio.id == audio_frame.id
    assert new_frame.audio.name == audio_frame.name
    assert new_frame.audio.sample_rate == audio_frame.sample_rate
    logger.info("Audio frame serialization test passed!")

def test_transcription_frame():
    """Test creating and serializing a TranscriptionFrame."""
    logger.info("Testing TranscriptionFrame serialization...")
    
    # Create a simple transcription frame
    transcription = TranscriptionFrame()
    transcription.text = "Hello, this is a test transcription"
    transcription.user_id = "ai"
    transcription.timestamp = "2023-06-01T12:34:56Z"
    
    # Create a Frame to wrap it
    frame = Frame()
    frame.transcription.CopyFrom(transcription)
    
    # Serialize to binary
    serialized = frame.SerializeToString()
    logger.info(f"Serialized frame size: {len(serialized)} bytes")
    
    # Deserialize from binary
    new_frame = Frame()
    new_frame.ParseFromString(serialized)
    
    # Verify fields
    logger.info(f"Deserialized transcription - text: {new_frame.transcription.text}")
    logger.info(f"  user_id: {new_frame.transcription.user_id}")
    
    # Verify serialization matches
    assert new_frame.transcription.text == transcription.text
    assert new_frame.transcription.user_id == transcription.user_id
    logger.info("Transcription frame serialization test passed!")

if __name__ == "__main__":
    try:
        test_audio_frame()
        test_transcription_frame()
        logger.info("All protobuf serialization tests passed!")
    except Exception as e:
        logger.error(f"Test failed with error: {e}")
        sys.exit(1) 