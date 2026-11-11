#!/bin/sh
# 백엔드 컨테이너 시작 순서: 의존성 맞추기 → DB 마이그레이션 → 견본 데이터 → 서버
set -eu
cd /workspace/backend

echo "[backend] 의존성 확인 (uv sync --frozen)"
uv sync --frozen

echo "[backend] DB 마이그레이션 (alembic upgrade head)"
uv run --frozen alembic upgrade head

echo "[backend] 견본 데이터 넣기 (python -m app.seed)"
uv run --frozen python -m app.seed

echo "[backend] 서버 시작 — http://localhost:${API_PORT:-8000}/docs"
exec uv run --frozen uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
