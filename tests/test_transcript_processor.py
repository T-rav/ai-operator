import unittest
from unittest.mock import MagicMock, patch
import sys
import os
import asyncio

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

class MockTranscriptionFrame:
    """Mock TranscriptionFrame class"""
    def __init__(self, text="Test text", user_id="test_user", timestamp="2025-05-19T12:00:00Z"):
        self.text = text
        self.user_id = user_id
        self.timestamp = timestamp

class MockTextFrame:
    """Mock TextFrame class"""
    def __init__(self, text="Test text"):
        self.text = text

class MockFrame:
    """Mock Frame class"""
    def __init__(self):
        self.transcription = None
        self.text = None


class TestTranscriptProcessor(unittest.TestCase):
    """Test the TranscriptProcessor functionality"""

    def setUp(self):
        """Set up test fixtures"""
        self.transcript_processor = MagicMock()
        self.user_processor = MagicMock()
        self.assistant_processor = MagicMock()
        self.transcript_processor.user.return_value = self.user_processor
        self.transcript_processor.assistant.return_value = self.assistant_processor
        
        self.mock_stt = MagicMock()
        self.mock_transport_output = MagicMock()
        
        self.user_transcription = MockTranscriptionFrame(
            text="Hello, this is a test of the transcription system."
        )
        
        self.ai_text = MockTextFrame(
            text="I received your test message. The transcription system is working correctly!"
        )

    def test_user_transcript_processor(self):
        """Test that user transcript processor forwards transcription frames"""
        mock_frame = MockFrame()
        mock_frame.transcription = self.user_transcription
        
        async def mock_process(frame):
            return frame
        
        self.user_processor.process = mock_process
        
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            loop.run_until_complete(self.user_processor.process(mock_frame))
            
            self.assertEqual(
                mock_frame.transcription.text,
                "Hello, this is a test of the transcription system."
            )
        finally:
            loop.close()
    
    def test_assistant_transcript_processor(self):
        """Test that assistant transcript processor forwards text frames"""
        mock_frame = MockFrame()
        mock_frame.text = self.ai_text
        
        async def mock_process(frame):
            return frame
        
        self.assistant_processor.process = mock_process
        
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            loop.run_until_complete(self.assistant_processor.process(mock_frame))
            
            self.assertEqual(
                mock_frame.text.text,
                "I received your test message. The transcription system is working correctly!"
            )
        finally:
            loop.close()
    
    def test_pipeline_integration(self):
        """Test that TranscriptProcessor is correctly integrated in the pipeline"""
        mock_pipeline = MagicMock()
        mock_pipeline._processors = [
            self.mock_stt,
            self.user_processor,
            self.mock_transport_output,
            self.assistant_processor
        ]
        
        self.assertEqual(len(mock_pipeline._processors), 4)
        self.assertEqual(mock_pipeline._processors[1], self.user_processor)
        self.assertEqual(mock_pipeline._processors[3], self.assistant_processor)


if __name__ == '__main__':
    unittest.main()
