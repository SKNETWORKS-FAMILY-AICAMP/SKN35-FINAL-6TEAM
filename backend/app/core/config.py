"""환경변수 설정.

모든 값은 `BUILDWISE_` 로 시작하는 환경변수로 바꿀 수 있습니다. 기본값만으로 Docker Compose 에서 실행됩니다.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BUILDWISE_", extra="ignore")

    # mock: 외부 AI 없이 규칙 코드로 업무팀을 흉내 냅니다. 실제 AI 연결은 아직 없습니다.
    mode: Literal["mock"] = "mock"
    mock_delay_ms: int = 400

    run_workers: int = 4
    validation_workers: int = 4
    max_retries: int = 2

    sweep_on_startup: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
