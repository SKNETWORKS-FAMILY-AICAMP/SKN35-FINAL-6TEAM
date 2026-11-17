#!/usr/bin/env bash
# 로컬 DB 코드와 프론트 정적 검사. Docker 없이 실행합니다.
set -euo pipefail
cd "$(dirname "$0")/.."

uv run --directory backend --frozen ruff check .
uv run --directory backend --frozen ruff format --check .
uv run --directory backend --frozen pytest -q
npm --prefix frontend run lint
npm --prefix frontend run format:check
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
