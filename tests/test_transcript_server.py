import unittest
from unittest.mock import MagicMock, patch
import sys
import os
import asyncio

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from pipecat.frames.frames import TranscriptionFrame, Frame, TextFrame
from pipecat.processors.transcript_processor import TranscriptProcessor
from pipecat.pipeline.pipeline import Pipeline


class TestTranscriptProcessor(unittest.TestCase):
    """Test the TranscriptProcessor functionality"""

    def setUp(self):
        """Set up test fixtures"""
        self.transcript_processor = TranscriptProcessor()
        
        self.mock_stt = MagicMock()
        self.mock_transport_output = MagicMock()
        
        self.user_transcription = TranscriptionFrame(
            text="Hello, this is a test of the transcription system.",
            user_id="test_user",
            timestamp="2025-05-19T20:00:00Z"
        )
        
        self.ai_text = TextFrame(
            text="I received your test message. The transcription system is working correctly!"
        )

    @patch('pipecat.pipeline.pipeline.Pipeline')
    def test_user_transcript_processor(self, mock_pipeline):
        """Test that user transcript processor forwards transcription frames"""
        user_processor = self.transcript_processor.user()
        
        mock_frame = Frame(transcription=self.user_transcription)
        
        asyncio.run(user_processor.process(mock_frame))
        
        self.mock_transport_output.process.assert_called_once()
        
        forwarded_frame = self.mock_transport_output.process.call_args[0][0]
        
        self.assertEqual(
            forwarded_frame.transcription.text,
            "Hello, this is a test of the transcription system."
        )

    @patch('pipecat.pipeline.pipeline.Pipeline')
    def test_assistant_transcript_processor(self, mock_pipeline):
        """Test that assistant transcript processor forwards text frames"""
        assistant_processor = self.transcript_processor.assistant()
        
        mock_frame = Frame(text=self.ai_text)
        
        asyncio.run(assistant_processor.process(mock_frame))
        
        self.mock_transport_output.process.assert_called_once()
        
        forwarded_frame = self.mock_transport_output.process.call_args[0][0]
        
        self.assertEqual(
            forwarded_frame.text.text,
            "I received your test message. The transcription system is working correctly!"
        )

    def test_pipeline_integration(self):
        """Test that TranscriptProcessor is correctly integrated in the pipeline"""
        pipeline = Pipeline([
            self.mock_stt,
            self.transcript_processor.user(),
            self.mock_transport_output,
            self.transcript_processor.assistant()
        ])
        
        self.assertEqual(len(pipeline.processors), 4)
        self.assertIsInstance(pipeline.processors[1], type(self.transcript_processor.user()))
        self.assertIsInstance(pipeline.processors[3], type(self.transcript_processor.assistant()))


if __name__ == '__main__':
    unittest.main()
