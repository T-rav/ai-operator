import asyncio
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from bot import Bot, SessionTimeoutHandler

# Fixtures for common test objects
@pytest.fixture
def bot():
    """Create a Bot instance for testing."""
    return Bot()

@pytest.fixture
def mock_transport():
    """Create a mocked transport."""
    transport = MagicMock()
    transport.input = MagicMock(return_value="input")
    transport.output = MagicMock(return_value="output")
    transport.event_handler = MagicMock()
    return transport

@pytest.fixture
def mock_services():
    """Create mocked services."""
    llm = MagicMock()
    llm.create_context_aggregator = MagicMock()
    
    stt = MagicMock()
    tts = MagicMock()
    
    return {
        "llm": llm,
        "stt": stt,
        "tts": tts
    }

# Tests for Bot class
class TestBot:
    
    def test_init(self, bot):
        """Test Bot initialization."""
        assert bot is not None
        assert bot.transport is None
        assert bot.llm is None
        assert bot.stt is None
        assert bot.tts is None
        assert bot.context is None
        assert bot.context_aggregator is None
        assert bot.pipeline is None
        assert bot.task is None
        assert bot.runner is None
        assert isinstance(bot.messages, list)
        assert len(bot.messages) == 1
        assert bot.messages[0]["role"] == "system"
    
    @patch("bot.WebsocketServerTransport")
    def test_setup_transport(self, mock_transport_class, bot):
        """Test transport setup."""
        mock_transport = MagicMock()
        mock_transport_class.return_value = mock_transport
        
        result = bot.setup_transport()
        
        assert mock_transport_class.called
        assert bot.transport == mock_transport
        assert result == mock_transport
    
    @patch("bot.OpenAILLMService")
    @patch("bot.DeepgramSTTService")
    @patch("bot.CartesiaTTSService")
    @patch.dict(os.environ, {
        "OPENAI_API_KEY": "test-openai-key",
        "DEEPGRAM_API_KEY": "test-deepgram-key",
        "CARTESIA_API_KEY": "test-cartesia-key"
    })
    def test_setup_services(self, mock_tts_class, mock_stt_class, mock_llm_class, bot):
        """Test services setup."""
        mock_llm = MagicMock()
        mock_stt = MagicMock()
        mock_tts = MagicMock()
        
        mock_llm_class.return_value = mock_llm
        mock_stt_class.return_value = mock_stt
        mock_tts_class.return_value = mock_tts
        
        bot.setup_services()
        
        assert mock_llm_class.called
        assert mock_stt_class.called
        assert mock_tts_class.called
        
        assert bot.llm == mock_llm
        assert bot.stt == mock_stt
        assert bot.tts == mock_tts
    
    def test_setup_context(self, bot):
        """Test context setup."""
        # Setup
        bot.llm = MagicMock()
        mock_context = MagicMock()
        mock_aggregator = MagicMock()
        
        with patch("bot.OpenAILLMContext", return_value=mock_context) as mock_context_class:
            bot.llm.create_context_aggregator.return_value = mock_aggregator
            
            # Execute
            bot.setup_context()
            
            # Assert
            mock_context_class.assert_called_once_with(bot.messages)
            bot.llm.create_context_aggregator.assert_called_once_with(mock_context)
            assert bot.context == mock_context
            assert bot.context_aggregator == mock_aggregator
    
    def test_setup_pipeline(self, bot, mock_transport, mock_services):
        """Test pipeline setup."""
        # Setup
        bot.transport = mock_transport
        bot.llm = mock_services["llm"]
        bot.stt = mock_services["stt"]
        bot.tts = mock_services["tts"]
        
        mock_context_aggregator = MagicMock()
        mock_context_aggregator.user = MagicMock(return_value="user_aggregator")
        mock_context_aggregator.assistant = MagicMock(return_value="assistant_aggregator")
        bot.context_aggregator = mock_context_aggregator
        
        with patch("bot.Pipeline") as mock_pipeline_class, \
             patch("bot.PipelineTask") as mock_task_class:
            
            mock_pipeline = MagicMock()
            mock_task = MagicMock()
            
            mock_pipeline_class.return_value = mock_pipeline
            mock_task_class.return_value = mock_task
            
            # Execute
            bot.setup_pipeline()
            
            # Assert
            mock_pipeline_class.assert_called_once()
            mock_task_class.assert_called_once()
            
            assert bot.pipeline == mock_pipeline
            assert bot.task == mock_task
    
    @pytest.mark.asyncio
    async def test_run(self, bot):
        """Test bot run."""
        # Setup
        bot.runner = AsyncMock()
        bot.task = MagicMock()
        
        # Execute
        await bot.run()
        
        # Assert
        bot.runner.run.assert_called_once_with(bot.task)

# Tests for SessionTimeoutHandler class
class TestSessionTimeoutHandler:
    
    @pytest.fixture
    def handler(self):
        task = AsyncMock()
        tts = AsyncMock()
        return SessionTimeoutHandler(task, tts)
    
    @pytest.mark.asyncio
    async def test_handle_timeout(self, handler):
        """Test timeout handling."""
        # Setup
        client_address = "127.0.0.1:8080"
        
        # Execute
        with patch.object(handler, "_end_call", new_callable=AsyncMock) as mock_end_call:
            await handler.handle_timeout(client_address)
            
            # Assert
            handler.task.queue_frames.assert_called_once()
            handler.tts.say.assert_called_once()
            assert len(handler.background_tasks) == 1  # Task was added
    
    @pytest.mark.asyncio
    async def test_end_call(self, handler):
        """Test end call procedure."""
        # Execute
        with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            await handler._end_call()
            
            # Assert
            mock_sleep.assert_called_once_with(15)
            handler.task.queue_frames.assert_called_once() 