#!/usr/bin/env bash
# BUILDWISE 전체 검사 — PR 을 올리기 전에 실행합니다. (먼저 ./scripts/dev.sh 로 켜 두세요)
set -u
cd "$(dirname "$0")/.."

BACKEND="docker compose exec -T backend uv run --frozen"
FRONTEND="docker compose exec -T frontend npm run"

names=(
  "백엔드 린트 (ruff check)"
  "백엔드 포맷 (ruff format --check)"
  "견본 데이터 형식"
  "DB 모델과 마이그레이션 일치 (alembic check)"
  "백엔드 테스트 (pytest)"
  "계약 파일 다시 만들기"
  "계약 파일이 커밋본과 같은지"
  "프론트 린트 (eslint)"
  "프론트 포맷 (prettier)"
  "프론트 타입 검사 (tsc)"
  "프론트 테스트 (vitest)"
  "프론트 빌드 (vite build)"
)
commands=(
  "$BACKEND ruff check ."
  "$BACKEND ruff format --check ."
  "$BACKEND python -m app.seed --check"
  "$BACKEND alembic check"
  "$BACKEND pytest -q"
  "$BACKEND python -m app.export_contracts && $FRONTEND gen:api"
  "git diff --exit-code -- contracts frontend/src/api/schema.d.ts"
  "$FRONTEND lint"
  "$FRONTEND format:check"
  "$FRONTEND typecheck"
  "$FRONTEND test"
  "$FRONTEND build"
)

results=()
failed=0
total=${#names[@]}
for i in "${!names[@]}"; do
  echo ""
  echo "[$((i + 1))/$total] ${names[$i]}"
  if bash -c "${commands[$i]}"; then
    results+=("PASS  ${names[$i]}")
  else
    results+=("FAIL  ${names[$i]}")
    failed=$((failed + 1))
  fi
done

echo ""
echo "===== 결과 ====="
printf '%s\n' "${results[@]}"
if [ "$failed" -gt 0 ]; then
  echo "실패 ${failed}개. 위 출력에서 FAIL 단계의 오류를 확인하세요. (docs/QA_GUIDE.md)" >&2
  exit 1
fi
echo "모두 통과했습니다."
