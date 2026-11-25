"""음성 읽기(TTS) 경로의 주고받는 모양."""

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_SPEECH_CHARS = 500


class ReadingEntry(BaseModel):
    """화면 글 `text` 를 읽을 때 `spoken` 으로 바꿉니다. prefix 면 바로 뒤 숫자를 한 자리씩 읽습니다."""

    text: str
    spoken: str
    prefix: bool = False


class SpeechStatusOut(BaseModel):
    enabled: bool = Field(
        description="서버 음성 합성을 쓸 수 있는지. 아니면 브라우저 음성으로 읽습니다."
    )
    dictionary: list[ReadingEntry] = Field(description="이 매장 상품 이름을 읽는 법")


class SpeechIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(
        min_length=1, max_length=MAX_SPEECH_CHARS, description="읽기용으로 바꾼 문장 하나"
    )

    @field_validator("text")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("읽을 글이 비어 있습니다.")
        return value
