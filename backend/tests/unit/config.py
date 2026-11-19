"""단위 테스트 대상 프로젝트 경로."""

from pathlib import Path

# backend/tests/unit/config.py를 기준으로 저장소 루트를 자동 계산합니다.
PROJECT_PATH = Path(__file__).resolve().parents[3]
