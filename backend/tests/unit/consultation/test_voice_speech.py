"""음성 읽기 경로: 세션 확인, 예산, 캐시, 원장, 공급자 응답 검증. 외부 네트워크 없이 로컬 가짜 서버만 씁니다."""

import io
import socket
import threading
import wave
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from app.contracts.pc_consult import MessageOut
from app.main import create_app
from app.voice.speech import (
    HttpProvider,
    OpenAIProvider,
    SpeechCache,
    SpeechError,
    SpeechService,
    SpeechSettings,
    check_wav,
    pcm_to_wav,
)
from app.voice.usage import KST, BudgetExceeded, SessionMeter, UsageLedger

ANSWER = "그래픽카드는 RTX 5070 Ti 를 추천해요. 예산 안에서 가장 빠릅니다."


def _wav(seconds: float = 0.1, rate: int = 24_000) -> bytes:
    return pcm_to_wav(b"\x01\x00" * int(rate * seconds), rate)


class FakeProvider:
    def __init__(self, gate: threading.Event | None = None, error: SpeechError | None = None):
        self.calls: list[str] = []
        self.gate = gate
        self.error = error

    def synthesize(self, text: str) -> bytes:
        self.calls.append(text)
        if self.gate is not None:
            self.gate.wait(5)
        if self.error is not None:
            raise self.error
        return _wav()


def _service(tmp_path, provider, *, daily=10_000, total=100_000) -> SpeechService:
    settings = SpeechSettings(provider="openai", usage_db=tmp_path / "usage.sqlite3")
    ledger = UsageLedger(settings.usage_db, daily_chars=daily, total_chars=total)
    return SpeechService(settings, provider, ledger)


def _client(service: SpeechService | None, *, answer: str | None = ANSWER):
    app = create_app()
    if service is not None:
        app.state.speech = service
    client = TestClient(app)
    session_id = client.post("/api/pc-consult/sessions").json()["session_id"]
    if answer is not None:
        session = app.state.pc_sessions._items[session_id]
        session.messages.append(
            MessageOut(id=1, role="assistant", content=answer, created_at=datetime.now(KST))
        )
    return client, f"/api/pc-consult/sessions/{session_id}/speech", app


# --- 경로 ---------------------------------------------------------------------------------------


def test_status_without_provider_reports_disabled_and_dictionary(tmp_path):
    client, url, _ = _client(SpeechService(SpeechSettings(), None, None))
    data = client.get(url).json()
    assert data["enabled"] is False
    assert {"text": "RTX", "spoken": "알티엑스", "prefix": True} in data["dictionary"]
    assert client.post(url, json={"text": "안녕하세요"}).status_code == 503


def test_unknown_session_or_missing_cookie_is_404(tmp_path):
    client, url, _ = _client(_service(tmp_path, FakeProvider()))
    other = TestClient(client.app)
    assert other.get(url).status_code == 404
    assert other.post(url, json={"text": "안녕하세요"}).status_code == 404
    assert client.get("/api/pc-consult/sessions/nope/speech").status_code == 404


def test_rejects_blank_and_too_long_text(tmp_path):
    client, url, _ = _client(_service(tmp_path, FakeProvider()))
    assert client.post(url, json={"text": "   "}).status_code == 422
    assert client.post(url, json={"text": "가" * 501}).status_code == 422
    assert client.post(url, json={"text": "가", "voice": "x"}).status_code == 422


def test_returns_complete_wav_and_reuses_cache_without_budget(tmp_path):
    provider = FakeProvider()
    service = _service(tmp_path, provider)
    client, url, _ = _client(service)
    first = client.post(url, json={"text": "네, 잠시만요."})
    assert first.status_code == 200
    assert first.headers["content-type"] == "audio/wav"
    assert first.headers["cache-control"] == "no-store"
    check_wav(first.content)
    again = client.post(url, json={"text": "네, 잠시만요."})
    assert again.content == first.content
    assert provider.calls == ["네, 잠시만요."]
    assert service.ledger is not None and service.ledger.used() == (len("네, 잠시만요."),) * 2


def test_session_budget_is_tied_to_answer_length(tmp_path):
    client, url, _ = _client(_service(tmp_path, FakeProvider()), answer="짧은 답")
    allowed = len("짧은 답") * 3 + 300
    assert client.post(url, json={"text": "가" * 300}).status_code == 200
    response = client.post(url, json={"text": "나" * (allowed - 300 + 1)})
    assert response.status_code == 429
    assert response.headers["retry-after"] == "30"


def test_session_without_answers_only_gets_ack_allowance(tmp_path):
    client, url, _ = _client(_service(tmp_path, FakeProvider()), answer=None)
    assert client.post(url, json={"text": "네, 확인할게요."}).status_code == 200
    assert client.post(url, json={"text": "가" * 400}).status_code == 429


def test_daily_limit_returns_retry_after_until_midnight(tmp_path):
    client, url, _ = _client(_service(tmp_path, FakeProvider(), daily=10))
    assert client.post(url, json={"text": "가" * 10}).status_code == 200
    response = client.post(url, json={"text": "나"})
    assert response.status_code == 429
    assert 0 < int(response.headers["retry-after"]) <= 24 * 3600


def test_provider_failures_map_to_502_and_503(tmp_path):
    for status in (502, 503):
        provider = FakeProvider(error=SpeechError(status, "실패"))
        client, url, _ = _client(_service(tmp_path / str(status), provider))
        assert client.post(url, json={"text": "안녕하세요"}).status_code == status


def test_rate_limit_per_session():
    clock = [0.0]
    meter = SessionMeter(per_minute=2, clock=lambda: clock[0])
    meter.hit("a")
    meter.hit("a")
    with pytest.raises(BudgetExceeded) as caught:
        meter.hit("a")
    assert caught.value.retry_after == 61
    meter.hit("b")
    clock[0] = 60.0
    meter.hit("a")


# --- 원장 ---------------------------------------------------------------------------------------


def test_ledger_survives_restart_and_checks_total(tmp_path):
    path = tmp_path / "usage.sqlite3"
    UsageLedger(path, daily_chars=100, total_chars=150).reserve(90)
    reopened = UsageLedger(path, daily_chars=100, total_chars=150)
    with pytest.raises(BudgetExceeded):
        reopened.reserve(11)
    day = [datetime(2026, 11, 25, 23, 59, tzinfo=KST)]
    later = UsageLedger(path, daily_chars=100, total_chars=150, now=lambda: day[0])
    day[0] += timedelta(days=1)
    later.reserve(60)
    with pytest.raises(BudgetExceeded) as caught:
        later.reserve(1)
    assert caught.value.retry_after == 24 * 3600


def test_ledger_reservations_do_not_overrun_under_contention(tmp_path):
    ledger = UsageLedger(tmp_path / "usage.sqlite3", daily_chars=50, total_chars=1_000)
    won: list[int] = []

    def worker():
        try:
            ledger.reserve(10)
            won.append(1)
        except BudgetExceeded:
            pass

    threads = [threading.Thread(target=worker) for _ in range(12)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(won) == 5
    assert ledger.used() == (50, 50)


# --- 캐시 ---------------------------------------------------------------------------------------


def test_cache_shares_one_synthesis_between_concurrent_requests(tmp_path):
    gate = threading.Event()
    provider = FakeProvider(gate=gate)
    service = _service(tmp_path, provider)
    charges: list[int] = []
    results: list[bytes] = []

    def request():
        results.append(service.synthesize("같은 문장", charge=lambda: charges.append(1)))

    threads = [threading.Thread(target=request) for _ in range(3)]
    for thread in threads:
        thread.start()
    gate.set()
    for thread in threads:
        thread.join()
    assert provider.calls == ["같은 문장"]
    assert len(charges) == 1
    assert len(set(results)) == 1


def test_failed_synthesis_is_not_cached(tmp_path):
    provider = FakeProvider(error=SpeechError(502, "끊김"))
    service = _service(tmp_path, provider)
    for _ in range(2):
        with pytest.raises(SpeechError):
            service.synthesize("문장", charge=lambda: None)
    assert provider.calls == ["문장", "문장"]
    assert service.cached("문장") is None


def test_cache_evicts_by_count_and_size():
    cache = SpeechCache(max_items=2, max_bytes=10)
    for key in ("a", "b", "c"):
        cache.get_or_create(key, lambda: b"12")
    assert cache.peek("a") is None and cache.peek("c") == b"12"
    cache.get_or_create("big", lambda: b"x" * 11)
    assert cache.peek("big") is None


# --- 공급자: 로컬 가짜 서버 -----------------------------------------------------------------------


class _Upstream:
    """한 응답 방식을 흉내 내는 로컬 HTTP 서버."""

    def __init__(self, behaviour: str, body: bytes = b"", content_type: str = "audio/wav"):
        self.requests: list[dict] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                outer.requests.append(
                    {
                        "path": self.path,
                        "auth": self.headers.get("Authorization"),
                        "body": self.rfile.read(length),
                    }
                )
                if behaviour == "redirect":
                    self.send_response(307)
                    self.send_header("Location", "http://127.0.0.1:9/elsewhere")
                    self.end_headers()
                    return
                if behaviour == "error":
                    self.send_response(500)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                if behaviour == "chunked-cut":
                    self.send_header("Transfer-Encoding", "chunked")
                    self.end_headers()
                    self.wfile.write(b"%x\r\n" % len(body) + body[: len(body) // 2])
                    self.wfile.flush()
                    self.connection.shutdown(socket.SHUT_RDWR)
                    return
                declared = len(body) * 2 if behaviour == "length-cut" else len(body)
                self.send_header("Content-Length", str(declared))
                self.end_headers()
                self.wfile.write(body)
                self.wfile.flush()
                if behaviour == "length-cut":
                    self.connection.shutdown(socket.SHUT_RDWR)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def upstream():
    servers: list[_Upstream] = []

    def start(*args, **kwargs) -> _Upstream:
        server = _Upstream(*args, **kwargs)
        servers.append(server)
        return server

    yield start
    for server in servers:
        server.close()


def _http(url: str) -> HttpProvider:
    return HttpProvider(SpeechSettings(provider="http", url=url, token="pod-token"))


def test_http_provider_returns_checked_wav_with_token(upstream):
    server = upstream("ok", _wav())
    audio = _http(server.url).synthesize("문장")
    assert audio == _wav()
    assert server.requests[0]["path"] == "/speech"
    assert server.requests[0]["auth"] == "Bearer pod-token"


@pytest.mark.parametrize("behaviour", ["length-cut", "chunked-cut", "error", "redirect"])
def test_http_provider_rejects_cut_failed_or_redirected_responses(upstream, behaviour):
    server = upstream(behaviour, _wav(0.5))
    with pytest.raises(SpeechError) as caught:
        _http(server.url).synthesize("문장")
    assert caught.value.status == 502
    assert len(server.requests) == 1


def test_http_provider_rejects_bad_wav_and_wrong_type(upstream):
    bad_rate = io.BytesIO()
    with wave.open(bad_rate, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8_000)
        out.writeframes(b"\x00\x00" * 100)
    stereo = io.BytesIO()
    with wave.open(stereo, "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(24_000)
        out.writeframes(b"\x00\x00" * 200)
    truncated = _wav(0.2)[:-100]
    for body, content_type in (
        (bad_rate.getvalue(), "audio/wav"),
        (stereo.getvalue(), "audio/wav"),
        (truncated, "audio/wav"),
        (b"", "audio/wav"),
        (_wav(), "application/json"),
    ):
        server = upstream("ok", body, content_type)
        with pytest.raises(SpeechError):
            _http(server.url).synthesize("문장")


def test_http_provider_requires_https_or_local_and_token():
    with pytest.raises(SpeechError):
        HttpProvider(SpeechSettings(provider="http", url="http://pod.example.com", token="t"))
    with pytest.raises(SpeechError):
        HttpProvider(SpeechSettings(provider="http", url="https://pod.example.com"))
    HttpProvider(SpeechSettings(provider="http", url="https://pod.example.com", token="t"))


def test_openai_provider_wraps_pcm_and_rejects_partial(monkeypatch, upstream):
    import app.voice.speech as speech

    pcm = b"\x01\x00" * 2400
    server = upstream("ok", pcm, "audio/pcm")
    monkeypatch.setattr(speech, "OPENAI_SPEECH_URL", server.url + "/v1/audio/speech")
    provider = OpenAIProvider(SpeechSettings(provider="openai", openai_key="sk-test"))
    audio = provider.synthesize("문장")
    with wave.open(io.BytesIO(audio)) as out:
        assert (out.getframerate(), out.getnframes()) == (24_000, 2400)
    assert server.requests[0]["auth"] == "Bearer sk-test"
    assert b'"response_format": "pcm"' in server.requests[0]["body"]

    for body, behaviour in ((b"", "ok"), (b"\x01\x00\x02", "ok"), (pcm, "chunked-cut")):
        cut = upstream(behaviour, body, "audio/pcm")
        monkeypatch.setattr(speech, "OPENAI_SPEECH_URL", cut.url + "/v1/audio/speech")
        with pytest.raises(SpeechError):
            provider.synthesize("문장")


def test_missing_openai_key_turns_speech_off(tmp_path):
    service = SpeechService.from_settings(
        SpeechSettings(provider="openai", usage_db=tmp_path / "u.db")
    )
    assert service.enabled is False
