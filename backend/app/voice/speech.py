"""문장 하나를 음성(WAV)으로 만듭니다. 공급자는 환경변수로 고릅니다.

    BUILDWISE_TTS_PROVIDER  none(기본, 브라우저 읽기) | openai | http(직접 띄운 공개 모델 서버)

공급자 응답을 끝까지 받은 것만 성공입니다. 길이가 모자라거나 전송이 끊긴 것(검출할 수 있는 절단)은
실패로 돌려주고 캐시에 넣지 않습니다. 공급자가 정상 종료로 보낸 음성이 실제로 문장 끝까지인지는 알 수 없습니다.
"""

import hashlib
import http.client
import io
import json
import os
import threading
import time
import wave
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import Future
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from dotenv import dotenv_values

from app.core.config import REPO_ROOT
from app.voice.usage import UsageLedger

type ProviderName = Literal["none", "openai", "http"]

OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech"
OPENAI_SAMPLE_RATE = 24_000
SAMPLE_RATES = frozenset({16_000, 22_050, 24_000, 44_100, 48_000})
MAX_AUDIO_BYTES = 3_000_000
#: 공급자 요청 하나의 전체 시간 상한(초). 조금씩 계속 오는 응답이 합성 자리를 오래 잡지 못하게 합니다.
TOTAL_DEADLINE_S = 25.0
#: 답을 아직 못 받은 세션도 읽을 수 있는 즉시 반응. 프론트 useVoiceConsultation.ts 의 ACKS 와 같아야 합니다.
ACK_TEXTS = frozenset({"네, 잠시만요.", "네, 확인할게요.", "네, 알겠어요.", "좋아요, 잠시만요."})
DEFAULT_INSTRUCTIONS = "친절하고 차분한 매장 상담원 말투로, 또박또박 자연스러운 속도로 읽어 주세요."


class SpeechError(Exception):
    """status 502 는 공급자 실패·잘린 음성, 503 은 꺼짐·혼잡입니다."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class SpeechSettings:
    provider: ProviderName = "none"
    model: str = "gpt-4o-mini-tts"
    voice: str = "coral"
    instructions: str = DEFAULT_INSTRUCTIONS
    url: str = ""
    token: str = ""
    openai_key: str = ""
    daily_chars: int = 30_000
    total_chars: int = 250_000
    usage_db: Path = REPO_ROOT / "backend" / ".cache" / "voice-usage.sqlite3"

    @property
    def version(self) -> str:
        """캐시 키에 넣는 설정 판. 목소리나 말투를 바꾸면 예전 음성을 다시 쓰지 않습니다."""
        raw = "|".join((self.provider, self.model, self.voice, self.instructions, self.url))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def load_settings() -> SpeechSettings:
    raw = {**dotenv_values(REPO_ROOT / ".env", interpolate=False), **os.environ}
    defaults = SpeechSettings()

    def text(name: str, default: str) -> str:
        value = raw.get(name)
        return value.strip() if value and value.strip() else default

    def number(name: str, default: int) -> int:
        try:
            return max(0, int(text(name, str(default))))
        except ValueError:
            return default

    provider = text("BUILDWISE_TTS_PROVIDER", "none").lower()
    return SpeechSettings(
        provider=provider if provider in ("openai", "http") else "none",  # type: ignore[arg-type]
        model=text("BUILDWISE_TTS_MODEL", defaults.model),
        voice=text("BUILDWISE_TTS_VOICE", defaults.voice),
        instructions=text("BUILDWISE_TTS_INSTRUCTIONS", defaults.instructions),
        url=text("BUILDWISE_TTS_URL", ""),
        token=text("BUILDWISE_TTS_TOKEN", ""),
        openai_key=text("OPENAI_API_KEY", ""),
        daily_chars=number("BUILDWISE_TTS_DAILY_CHARS", defaults.daily_chars),
        total_chars=number("BUILDWISE_TTS_TOTAL_CHARS", defaults.total_chars),
        usage_db=Path(text("BUILDWISE_TTS_USAGE_DB", str(defaults.usage_db))),
    )


# --- WAV ---------------------------------------------------------------------------------------


def pcm_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(pcm)
    return buffer.getvalue()


def check_wav(data: bytes) -> bytes:
    """16비트 모노 PCM WAV 이고 헤더가 말한 길이만큼 소리가 다 왔는지 봅니다."""
    try:
        with wave.open(io.BytesIO(data), "rb") as audio:
            frames = audio.getnframes()
            if (
                audio.getnchannels() != 1
                or audio.getsampwidth() != 2
                or audio.getcomptype() != "NONE"
                or audio.getframerate() not in SAMPLE_RATES
                or frames <= 0
                or len(audio.readframes(frames)) != frames * 2
            ):
                raise ValueError
    except wave.Error, EOFError, ValueError:
        raise SpeechError(502, "음성 합성 서버가 올바른 음성을 보내지 않았습니다.") from None
    return data


# --- 공급자 ------------------------------------------------------------------------------------


class Provider(Protocol):
    def synthesize(self, text: str) -> bytes:
        """완성된 WAV 를 돌려주거나 SpeechError 를 냅니다."""
        ...


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # 리다이렉트를 따라가지 않습니다. 3xx 는 HTTPError 로 끝납니다.


_opener = build_opener(_NoRedirect)


def _fetch(request: Request, timeout: float) -> tuple[bytes, str]:
    """본문을 끝까지 읽습니다. 길이가 모자라거나 끊기거나 전체 시간 상한을 넘으면 SpeechError(502)."""
    started = time.monotonic()
    try:
        with _opener.open(request, timeout=timeout) as response:
            if response.status != 200:
                raise SpeechError(502, "음성 합성 요청이 실패했습니다.")
            declared = response.headers.get("Content-Length")
            chunks: list[bytes] = []
            size = 0
            while chunk := response.read1(65_536):
                if time.monotonic() - started > TOTAL_DEADLINE_S:
                    raise SpeechError(502, "음성 합성이 너무 오래 걸립니다.")
                size += len(chunk)
                if size > MAX_AUDIO_BYTES:
                    raise SpeechError(502, "음성이 너무 깁니다. 문장을 줄여 주세요.")
                chunks.append(chunk)
            if declared is not None and declared.isdigit() and int(declared) != size:
                raise SpeechError(502, "음성 합성이 중간에 끊겼습니다.")
            return b"".join(chunks), response.headers.get_content_type()
    except SpeechError:
        raise
    except HTTPError as exc:
        raise SpeechError(502, f"음성 합성 요청이 실패했습니다(HTTP {exc.code}).") from None
    except http.client.IncompleteRead:
        raise SpeechError(502, "음성 합성이 중간에 끊겼습니다.") from None
    except http.client.HTTPException, URLError, OSError, ValueError:
        raise SpeechError(502, "음성 합성 서버에 연결하지 못했습니다.") from None


class OpenAIProvider:
    def __init__(self, settings: SpeechSettings):
        if not settings.openai_key:
            raise SpeechError(503, "서버에 OPENAI_API_KEY 가 없어 음성 합성을 끕니다.")
        self.settings = settings

    def synthesize(self, text: str) -> bytes:
        payload = {
            "model": self.settings.model,
            "input": text,
            "voice": self.settings.voice,
            "instructions": self.settings.instructions,
            "response_format": "pcm",
        }
        request = Request(
            OPENAI_SPEECH_URL,
            method="POST",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        # 리다이렉트에 키가 실리지 않게 합니다.
        request.add_unredirected_header("Authorization", f"Bearer {self.settings.openai_key}")
        pcm, _ = _fetch(request, timeout=10)
        if not pcm or len(pcm) % 2:
            raise SpeechError(502, "음성 합성이 중간에 끊겼습니다.")
        return pcm_to_wav(pcm, OPENAI_SAMPLE_RATE)


def _allowed_url(url: str) -> bool:
    parts = urlsplit(url)
    if parts.scheme == "https" and parts.hostname:
        return True
    return parts.scheme == "http" and parts.hostname in {"localhost", "127.0.0.1", "::1"}


class HttpProvider:
    """직접 띄운 공개 모델 서버. POST {URL}/speech {text, voice} → audio/wav 전체 본문."""

    def __init__(self, settings: SpeechSettings):
        if not _allowed_url(settings.url):
            raise SpeechError(503, "BUILDWISE_TTS_URL 은 https 주소여야 합니다(로컬 시험만 http).")
        if not settings.token and urlsplit(settings.url).scheme == "https":
            raise SpeechError(503, "BUILDWISE_TTS_TOKEN 이 없어 음성 합성 서버를 쓰지 않습니다.")
        self.settings = settings

    def synthesize(self, text: str) -> bytes:
        request = Request(
            self.settings.url.rstrip("/") + "/speech",
            method="POST",
            data=json.dumps(
                {"text": text, "voice": self.settings.voice}, ensure_ascii=False
            ).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "audio/wav"},
        )
        if self.settings.token:
            request.add_unredirected_header("Authorization", f"Bearer {self.settings.token}")
        data, content_type = _fetch(request, timeout=10)
        if content_type not in {"audio/wav", "audio/x-wav", "audio/wave"}:
            raise SpeechError(502, "음성 합성 서버가 WAV 가 아닌 응답을 보냈습니다.")
        return check_wav(data)


def make_provider(settings: SpeechSettings) -> Provider | None:
    if settings.provider == "openai":
        return OpenAIProvider(settings)
    if settings.provider == "http":
        return HttpProvider(settings)
    return None


# --- 캐시와 합성 창구 ---------------------------------------------------------------------------


class SpeechCache:
    """완성된 음성만 담습니다. 같은 글을 동시에 요청하면 진행 중인 합성 하나를 같이 기다립니다."""

    def __init__(self, *, max_items: int = 32, max_bytes: int = 8_000_000):
        self.max_items = max_items
        self.max_bytes = max_bytes
        self._items: OrderedDict[str, bytes] = OrderedDict()
        self._size = 0
        self._pending: dict[str, Future[bytes]] = {}
        self._lock = threading.Lock()

    def peek(self, key: str) -> bytes | None:
        with self._lock:
            data = self._items.get(key)
            if data is not None:
                self._items.move_to_end(key)
            return data

    def get_or_create(self, key: str, create: Callable[[], bytes]) -> bytes:
        with self._lock:
            data = self._items.get(key)
            if data is not None:
                self._items.move_to_end(key)
                return data
            future = self._pending.get(key)
            owner = future is None
            if owner:
                future = self._pending[key] = Future()
        assert future is not None
        if not owner:
            return future.result()
        try:
            data = create()
        except BaseException as exc:
            future.set_exception(exc)
            raise
        else:
            future.set_result(data)
            self._store(key, data)
            return data
        finally:
            with self._lock:
                self._pending.pop(key, None)

    def _store(self, key: str, data: bytes) -> None:
        if len(data) > self.max_bytes:
            return
        with self._lock:
            self._items[key] = data
            self._size += len(data)
            while len(self._items) > self.max_items or self._size > self.max_bytes:
                _, old = self._items.popitem(last=False)
                self._size -= len(old)


class SpeechService:
    def __init__(
        self,
        settings: SpeechSettings,
        provider: Provider | None,
        ledger: UsageLedger | None,
        *,
        cache: SpeechCache | None = None,
        concurrency: int = 4,
        slot_wait: float = 2.0,
    ):
        self.settings = settings
        self.provider = provider
        self.ledger = ledger
        self.cache = cache or SpeechCache()
        self._slots = threading.BoundedSemaphore(concurrency)
        self._slot_wait = slot_wait

    @classmethod
    def from_settings(cls, settings: SpeechSettings) -> SpeechService:
        try:
            provider = make_provider(settings)
        except SpeechError:
            provider = None  # 설정이 모자라면 꺼 둡니다. 상담은 브라우저 읽기로 계속됩니다.
        ledger = (
            UsageLedger(
                settings.usage_db,
                daily_chars=settings.daily_chars,
                total_chars=settings.total_chars,
            )
            if provider is not None
            else None
        )
        return cls(settings, provider, ledger)

    @property
    def enabled(self) -> bool:
        return self.provider is not None

    def key(self, text: str) -> str:
        return self.settings.version + ":" + hashlib.sha256(text.encode("utf-8")).hexdigest()

    def cached(self, text: str) -> bytes | None:
        return self.cache.peek(self.key(text))

    def synthesize(self, text: str) -> bytes:
        """캐시에 없을 때만 합성 자리를 잡고, 원장에 글자를 예약한 뒤 공급자를 부릅니다.

        자리를 못 잡은 혼잡(503)은 예산을 쓰지 않습니다. 예약한 뒤의 실패는 환급하지 않습니다.
        """
        provider = self.provider
        if provider is None or self.ledger is None:
            raise SpeechError(503, "서버 음성 합성이 꺼져 있습니다.")
        ledger = self.ledger

        def create() -> bytes:
            if not self._slots.acquire(timeout=self._slot_wait):
                raise SpeechError(503, "음성 합성 요청이 몰렸습니다. 브라우저 음성으로 읽습니다.")
            try:
                ledger.reserve(len(text))
                return provider.synthesize(text)
            finally:
                self._slots.release()

        return self.cache.get_or_create(self.key(text), create)
