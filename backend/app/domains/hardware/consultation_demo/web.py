"""Serve the local React consultation demo. Start with python -m app.domains.hardware.consultation_demo.web."""

import json
import secrets
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from time import monotonic
from urllib.parse import parse_qsl

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import REPO_ROOT

from . import flow
from .advisor import advise
from .parts_db import PartsCatalogError, load_catalog

_COOKIE = "bw_demo_session"
_TTL = 2 * 60 * 60
_CATALOG_TTL = 5 * 60
_MAX_SESSIONS = 64
_MAX_BODY = 24 * 1024
_NO_STORE = {"Cache-Control": "no-store", "X-Frame-Options": "DENY"}
_ESCAPES = str.maketrans(
    {
        "<": "\\u003c",
        ">": "\\u003e",
        "&": "\\u0026",
        "\u2028": "\\u2028",
        "\u2029": "\\u2029",
    }
)
_BUILD_HELP = """시연 화면 빌드가 필요합니다.
frontend 폴더에서 npm ci 및 npm run build를 실행한 뒤 시연 서버를 다시 시작하세요.
backend 폴더에서 python -m app.domains.hardware.consultation_demo.web 로 실행합니다."""


class _Unavailable(Exception):
    pass


class _Expired(Exception):
    pass


@dataclass
class _Visit:
    state: flow.Consultation = field(default_factory=flow.Consultation)
    planner: flow.Planner | None = None
    csrf: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    lock: Lock = field(default_factory=Lock)
    touched: float = field(default_factory=monotonic)
    users: int = 0


class _Sessions:
    def __init__(self):
        self.items: dict[str, _Visit] = {}
        self.lock = Lock()

    @contextmanager
    def visit(self, key, *, create):
        with self.lock:
            cutoff = monotonic() - _TTL
            for old in [k for k, v in self.items.items() if not v.users and v.touched < cutoff]:
                del self.items[old]
            visit = self.items.get(key)
            if visit is None:
                if not create:
                    raise _Expired
                if len(self.items) >= _MAX_SESSIONS:
                    raise _Unavailable
                key = secrets.token_urlsafe(32)
                self.items[key] = visit = _Visit()
            # A queued or active request must never lose its state to an expiration sweep.
            visit.users += 1
        try:
            with visit.lock:
                yield key, visit
        except PartsCatalogError:
            # A failed first visit has no cookie. Leave the slot available for retry.
            with self.lock:
                if visit.planner is None:
                    self.items.pop(key, None)
            raise
        finally:
            with self.lock:
                visit.users -= 1
                visit.touched = monotonic()


def _text(message, status):
    return PlainTextResponse(message, status_code=status, headers=_NO_STORE)


async def _form(request):
    if request.headers.get("content-type", "").partition(";")[0].strip().lower() != (
        "application/x-www-form-urlencoded"
    ):
        return _text("브라우저의 상담 폼으로 제출해 주세요.", 415)
    body = bytearray()
    async for block in request.stream():
        if len(body) + len(block) > _MAX_BODY:
            return _text("입력한 내용이 너무 깁니다.", 413)
        body.extend(block)
    try:
        fields = parse_qsl(
            body.decode("utf-8"),
            keep_blank_values=True,
            strict_parsing=True,
            errors="strict",
            max_num_fields=32,
        )
        values = dict(fields)
        if len(values) != len(fields):
            raise ValueError
    except ValueError:
        return _text("상담 양식을 다시 확인해 주세요.", 400)
    return values


def _database_planner():
    snapshot = load_catalog(company_id=1)
    if not snapshot.parts:
        raise PartsCatalogError("시연 기업에 연결된 부품이 없습니다.")
    try:
        return flow.Planner(snapshot.parts, snapshot.compatibility)
    except ValueError as exc:
        raise PartsCatalogError("부품 DB에서 상담에 필요한 구성을 만들 수 없습니다.") from exc


def create_app(*, advisor=advise, dist=None, planner_factory=_database_planner) -> FastAPI:
    bundle = Path(dist) if dist is not None else REPO_ROOT / "frontend" / "dist"
    index = bundle / "index.html"
    assets = bundle / "assets"
    template = index.read_text(encoding="utf-8") if index.is_file() and assets.is_dir() else ""
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
    if template:
        app.mount("/assets", StaticFiles(directory=assets), name="assets")
    sessions = _Sessions()
    catalog_lock = Lock()
    cached_planner = None
    refresh_at = 0.0

    def current_planner():
        nonlocal cached_planner, refresh_at
        with catalog_lock:
            if cached_planner is None or monotonic() >= refresh_at:
                cached_planner = planner_factory()
                refresh_at = monotonic() + _CATALOG_TTL
            return cached_planner

    def render(visit, *, error="", status=200):
        view = visit.planner.view(visit.state)
        view["csrf"] = visit.csrf
        if error:
            view["error"] = error
        payload = json.dumps(view, ensure_ascii=False, allow_nan=False).translate(_ESCAPES)
        tag = f'<script id="demo-state" type="application/json">{payload}</script>'
        return HTMLResponse(
            template.replace("</head>", tag + "</head>", 1), status, headers=_NO_STORE
        )

    @app.get("/", response_class=HTMLResponse)
    def home(request: Request):
        if "</head>" not in template:
            return _text(_BUILD_HELP, 503)
        try:
            with sessions.visit(request.cookies.get(_COOKIE), create=True) as (key, visit):
                if visit.planner is None:
                    visit.planner = current_planner()
                response = render(visit)
        except PartsCatalogError:
            return _text(
                "부품 DB에서 상담 카탈로그를 불러오지 못했습니다. "
                "DB 연결과 부품 적재 상태를 확인한 뒤 새로고침해 주세요.",
                503,
            )
        except _Unavailable:
            return _text("시연 상담이 가득 찼습니다. 잠시 뒤 다시 시도해 주세요.", 503)
        response.set_cookie(_COOKIE, key, max_age=_TTL, httponly=True, samesite="strict", path="/")
        return response

    def submit(key, fields):
        try:
            with sessions.visit(key, create=False) as (_, visit):
                if not secrets.compare_digest(fields.get("csrf", "").encode(), visit.csrf.encode()):
                    return _text("상담 양식을 다시 열어 주세요.", 403)
                if fields.get("revision") != str(visit.state.revision):
                    return render(
                        visit,
                        error="앞선 선택이 반영됐습니다. 최신 화면을 확인해 주세요.",
                        status=409,
                    )
                try:
                    updated = flow.perform(
                        visit.planner, deepcopy(visit.state), fields, advisor=advisor
                    )
                except flow.InputError as exc:
                    return render(visit, error=str(exc), status=422)
                updated.revision = visit.state.revision + 1
                visit.state = updated
        except _Expired:
            return _text("상담 세션이 만료됐습니다. 시연 첫 화면을 다시 열어 주세요.", 403)
        return RedirectResponse("/", status_code=303, headers=_NO_STORE)

    @app.post("/", response_class=HTMLResponse)
    async def post(request: Request):
        if "</head>" not in template:
            return _text(_BUILD_HELP, 503)
        fields = await _form(request)
        if not isinstance(fields, dict):
            return fields
        return await run_in_threadpool(submit, request.cookies.get(_COOKIE), fields)

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8017, reload=False)
