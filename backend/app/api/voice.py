"""상담 답을 서버 음성으로 읽는 경로. 상담 세션 쿠키로 확인하고, 합성량을 그 세션의 답 글자에 묶습니다.

답을 아직 못 받은 세션은 즉시 반응(ACK_TEXTS)만 읽을 수 있습니다. 즉시 반응은 서버 캐시에서 다시 씁니다.
서버 음성이 꺼져 있거나(기본) 실패하면 프론트는 브라우저 음성으로 읽습니다.
"""

from threading import Lock

from fastapi import APIRouter, HTTPException, Request, Response

from app.api.pc_sessions import COOKIE, GuestSession, GuestSessions
from app.contracts.voice import SpeechIn, SpeechStatusOut
from app.voice.speech import ACK_TEXTS, SpeechError, SpeechService, load_settings
from app.voice.usage import BudgetExceeded, SessionMeter

router = APIRouter(prefix="/api/pc-consult/sessions/{session_id}/speech", tags=["음성 읽기"])

_setup = Lock()

_ERRORS = {
    404: {"description": "상담 세션이 없거나 만료됨"},
    429: {"description": "세션·하루·누적 합성 한도. Retry-After 초 뒤 다시"},
    502: {"description": "음성 합성 실패 또는 잘린 음성"},
    503: {"description": "서버 음성 합성 꺼짐 또는 혼잡"},
}


def speech_service(request: Request) -> SpeechService:
    state = request.app.state
    with _setup:
        if getattr(state, "speech", None) is None:
            state.speech = SpeechService.from_settings(load_settings())
        if getattr(state, "speech_meter", None) is None:
            state.speech_meter = SessionMeter()
    return state.speech


def _session(request: Request, session_id: str) -> GuestSession:
    sessions: GuestSessions = request.app.state.pc_sessions
    return sessions.read(session_id, request.cookies.get(COOKIE))


def _answer_chars(session: GuestSession) -> int:
    return sum(len(m.content) for m in list(session.messages) if m.role == "assistant")


def _too_many(exc: BudgetExceeded) -> HTTPException:
    return HTTPException(429, str(exc), headers={"Retry-After": str(exc.retry_after)})


@router.get("", response_model=SpeechStatusOut, responses={404: _ERRORS[404]})
def speech_status(request: Request, session_id: str) -> SpeechStatusOut:
    from app.domains.hardware.pc_consultation.reading import reading_dictionary

    _session(request, session_id)
    service = speech_service(request)
    return SpeechStatusOut(enabled=service.enabled, dictionary=reading_dictionary())


@router.post(
    "",
    response_class=Response,
    responses={
        200: {"content": {"audio/wav": {}}, "description": "문장 하나의 음성(WAV)"},
        **_ERRORS,
    },
)
def synthesize_speech(request: Request, session_id: str, body: SpeechIn) -> Response:
    session = _session(request, session_id)
    service = speech_service(request)
    meter: SessionMeter = request.app.state.speech_meter
    if not service.enabled:
        raise HTTPException(503, "서버 음성 합성이 꺼져 있습니다.")
    text = body.text
    try:
        meter.hit(session_id)
        audio = service.cached(text)
        if audio is None:
            # 세션 한도는 공유 합성 밖에서 셉니다. 한 세션의 한도 초과가 같은 문장을 기다리는 다른 세션에 번지지 않게.
            if text not in ACK_TEXTS:
                meter.charge(session_id, _answer_chars(session), len(text))
            audio = service.synthesize(text)
    except BudgetExceeded as exc:
        raise _too_many(exc) from None
    except SpeechError as exc:
        raise HTTPException(exc.status, str(exc)) from None
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})
