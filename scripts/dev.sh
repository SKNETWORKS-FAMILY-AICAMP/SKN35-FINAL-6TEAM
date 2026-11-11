#!/usr/bin/env bash
# BUILDWISE 개발 환경 켜기 (macOS · Linux · Git Bash)
#   실행:          ./scripts/dev.sh      (권한 오류면: bash scripts/dev.sh)
#   스크립트 없이: docker compose up -d --build --wait
set -u
cd "$(dirname "$0")/.."

echo "[1/3] Docker 가 켜져 있는지 확인합니다"
if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  echo "Docker 가 꺼져 있습니다. Docker Desktop(또는 docker 서비스)을 켜고 다시 실행하세요." >&2
  exit 1
fi

echo "[2/3] 컨테이너를 만들고 켭니다 (처음에는 5~10분 걸릴 수 있습니다)"
if ! docker compose up -d --build --wait; then
  echo "실행에 실패했습니다. 아래 명령으로 원인을 확인하세요. (docs/TROUBLESHOOTING.md)" >&2
  echo "  docker compose ps" >&2
  echo "  docker compose logs backend --tail 50" >&2
  exit 1
fi

echo "[3/3] 준비 완료"
echo "  화면       http://localhost:${WEB_PORT:-5173}"
echo "  API 문서   http://localhost:${API_PORT:-8000}/docs"
echo "  전체 검사  ./scripts/check.sh"
echo "  끄기       ./scripts/stop.sh"
