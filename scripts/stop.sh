#!/usr/bin/env bash
# BUILDWISE 끄기 — 컨테이너만 지우고 DB 데이터는 남깁니다.  (스크립트 없이: docker compose down)
set -u
cd "$(dirname "$0")/.."
docker compose down || exit 1
echo "꺼졌습니다. 다시 켜려면 ./scripts/dev.sh"
