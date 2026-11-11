#!/usr/bin/env bash
# API 계약 파일 다시 만들기 — backend/app/contracts/schemas.py 나 API 경로를 바꾼 뒤 실행합니다.
#   만드는 파일: contracts/openapi.json · contracts/events.schema.json · frontend/src/api/schema.d.ts
set -u
cd "$(dirname "$0")/.."
docker compose exec -T backend uv run --frozen python -m app.export_contracts || exit 1
docker compose exec -T frontend npm run gen:api || exit 1
echo "계약 파일을 다시 만들었습니다. 바뀐 파일을 같은 PR 에 커밋하세요."
git status --short -- contracts frontend/src/api/schema.d.ts
