"""FastAPI 앱 진입점.

    uv run uvicorn app.main:app --reload       # 로컬 실행(Docker 없이)
    docker compose up                          # 권장 실행

서버 프로세스는 1개로 실행합니다(--workers 를 늘리지 않음). 이유는 app/workflows/runner.py 맨 위에 있습니다.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.core.config import Settings, get_settings
from app.core.db import Database
from app.core.errors import ConflictError, InvalidInputError, NotFoundError
from app.workflows.recovery import sweep_interrupted_runs
from app.workflows.runner import WorkflowRunner

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("buildwise")

DESCRIPTION = """
BUILDWISE — 판매 기업의 상품 데이터와 정책을 연결해 AI 상담 직원을 만드는 플랫폼의 API 입니다.

- 지금은 **Mock 모드**입니다. 업무팀은 규칙 코드로 동작하고 외부 AI 를 부르지 않습니다.
- 상품 데이터는 모두 **테스트 데이터(가상 브랜드 · 가상 모델)** 입니다.
- `X-Company-Id` 헤더는 시연용 기업 전환이며 **인증이 아닙니다**.
"""


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    database = Database(settings.database_url, pool_size=settings.db_pool_size)
    runner = WorkflowRunner(database, settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if settings.sweep_on_startup:
            try:
                swept = await run_in_threadpool(sweep_interrupted_runs, database)
                if swept:
                    logger.info(
                        "서버 재시작으로 멈춘 실행 %d개를 '실패(재시도 가능)'로 정리했습니다", swept
                    )
            except Exception:
                logger.exception("시작 정리 실패 — DB 연결을 확인하세요")
        yield
        runner.shutdown()
        database.dispose()

    app = FastAPI(
        title="BUILDWISE API",
        version="0.1.0",
        description=DESCRIPTION,
        lifespan=lifespan,
        separate_input_output_schemas=False,
    )
    app.state.settings = settings
    app.state.database = database
    app.state.runner = runner
    app.include_router(router)

    @app.exception_handler(NotFoundError)
    def _not_found(_: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(ConflictError)
    def _conflict(_: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(InvalidInputError)
    def _invalid(_: Request, exc: InvalidInputError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    return app


app = create_app()
