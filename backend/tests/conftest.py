"""테스트 공통 준비.

- DB 테스트는 개발 DB 가 아니라 `buildwise_test` DB 를 씁니다(compose 가 처음 만들 때 생성).
- 테스트 세션 시작 때 테이블을 모두 지우고 Alembic 마이그레이션으로 다시 만듭니다 → 마이그레이션도 함께 검사됩니다.
- 테스트마다 테이블을 비우고 견본 데이터를 다시 넣습니다.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from app.core.config import Settings
from app.core.db import Database
from app.db.models import Base
from app.main import create_app
from app.seed import seed_database
from app.workflows.runner import WorkflowRunner

TEST_DATABASE_URL = os.environ.get(
    "BUILDWISE_TEST_DATABASE_URL",
    "mysql+pymysql://buildwise:buildwise@127.0.0.1:3307/buildwise_test?charset=utf8mb4",
)
BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def migrated_database_url() -> str:
    engine = create_engine(TEST_DATABASE_URL)
    try:
        with engine.begin() as conn:
            conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
            for (name,) in conn.execute(text("SHOW TABLES")).all():
                conn.execute(text(f"DROP TABLE `{name}`"))
            conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    except OperationalError as exc:
        pytest.exit(
            "테스트 DB 에 연결할 수 없습니다. `docker compose up -d db` 로 DB 를 켜고 다시 실행하세요.\n"
            f"주소: {TEST_DATABASE_URL}\n원인: {exc.orig}",
            returncode=2,
        )
    finally:
        engine.dispose()

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(config, "head")
    return TEST_DATABASE_URL


@pytest.fixture
def settings(migrated_database_url: str) -> Settings:
    return Settings(
        database_url=migrated_database_url,
        mock_delay_ms=0,
        sweep_on_startup=False,
        run_workers=4,
        validation_workers=4,
        max_retries=2,
    )


@pytest.fixture
def database(settings: Settings) -> Iterator[Database]:
    db = Database(settings.database_url)
    with db.engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for table in Base.metadata.sorted_tables:
            conn.execute(text(f"TRUNCATE TABLE `{table.name}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    seed_database(db, settings.fixtures_dir)
    yield db
    db.dispose()


@pytest.fixture
def app(settings: Settings, database: Database) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def runner(app: FastAPI) -> WorkflowRunner:
    return app.state.runner


@pytest.fixture
def companies(client: TestClient) -> dict[str, int]:
    return {c["slug"]: c["id"] for c in client.get("/api/companies").json()}
