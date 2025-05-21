from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Frame(_message.Message):
    __slots__ = ("audio", "text", "transcription", "message", "start_interruption")
    AUDIO_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    TRANSCRIPTION_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    START_INTERRUPTION_FIELD_NUMBER: _ClassVar[int]
    audio: AudioFrame
    text: TextFrame
    transcription: TranscriptionFrame
    message: MessageFrame
    start_interruption: StartInterruptionFrame
    def __init__(self, audio: _Optional[_Union[AudioFrame, _Mapping]] = ..., text: _Optional[_Union[TextFrame, _Mapping]] = ..., transcription: _Optional[_Union[TranscriptionFrame, _Mapping]] = ..., message: _Optional[_Union[MessageFrame, _Mapping]] = ..., start_interruption: _Optional[_Union[StartInterruptionFrame, _Mapping]] = ...) -> None: ...

class AudioFrame(_message.Message):
    __slots__ = ("id", "name", "audio", "sample_rate", "num_channels", "text", "pts")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    AUDIO_FIELD_NUMBER: _ClassVar[int]
    SAMPLE_RATE_FIELD_NUMBER: _ClassVar[int]
    NUM_CHANNELS_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    PTS_FIELD_NUMBER: _ClassVar[int]
    id: int
    name: str
    audio: bytes
    sample_rate: int
    num_channels: int
    text: str
    pts: int
    def __init__(self, id: _Optional[int] = ..., name: _Optional[str] = ..., audio: _Optional[bytes] = ..., sample_rate: _Optional[int] = ..., num_channels: _Optional[int] = ..., text: _Optional[str] = ..., pts: _Optional[int] = ...) -> None: ...

class TextFrame(_message.Message):
    __slots__ = ("text", "user_id", "timestamp")
    TEXT_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    text: str
    user_id: str
    timestamp: str
    def __init__(self, text: _Optional[str] = ..., user_id: _Optional[str] = ..., timestamp: _Optional[str] = ...) -> None: ...

class TranscriptionFrame(_message.Message):
    __slots__ = ("text", "user_id", "timestamp")
    TEXT_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    text: str
    user_id: str
    timestamp: str
    def __init__(self, text: _Optional[str] = ..., user_id: _Optional[str] = ..., timestamp: _Optional[str] = ...) -> None: ...

class MessageFrame(_message.Message):
    __slots__ = ("type", "content", "timestamp")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    type: str
    content: str
    timestamp: str
    def __init__(self, type: _Optional[str] = ..., content: _Optional[str] = ..., timestamp: _Optional[str] = ...) -> None: ...

class StartInterruptionFrame(_message.Message):
    __slots__ = ("user_id", "timestamp")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    timestamp: str
    def __init__(self, user_id: _Optional[str] = ..., timestamp: _Optional[str] = ...) -> None: ...

class Audio(_message.Message):
    __slots__ = ("audio", "sample_rate", "num_channels")
    AUDIO_FIELD_NUMBER: _ClassVar[int]
    SAMPLE_RATE_FIELD_NUMBER: _ClassVar[int]
    NUM_CHANNELS_FIELD_NUMBER: _ClassVar[int]
    audio: _containers.RepeatedScalarFieldContainer[int]
    sample_rate: int
    num_channels: int
    def __init__(self, audio: _Optional[_Iterable[int]] = ..., sample_rate: _Optional[int] = ..., num_channels: _Optional[int] = ...) -> None: ...

class Transcription(_message.Message):
    __slots__ = ("text", "speaker", "is_final")
    TEXT_FIELD_NUMBER: _ClassVar[int]
    SPEAKER_FIELD_NUMBER: _ClassVar[int]
    IS_FINAL_FIELD_NUMBER: _ClassVar[int]
    text: str
    speaker: str
    is_final: bool
    def __init__(self, text: _Optional[str] = ..., speaker: _Optional[str] = ..., is_final: bool = ...) -> None: ...

class AISpeech(_message.Message):
    __slots__ = ("text", "is_final")
    TEXT_FIELD_NUMBER: _ClassVar[int]
    IS_FINAL_FIELD_NUMBER: _ClassVar[int]
    text: str
    is_final: bool
    def __init__(self, text: _Optional[str] = ..., is_final: bool = ...) -> None: ...
