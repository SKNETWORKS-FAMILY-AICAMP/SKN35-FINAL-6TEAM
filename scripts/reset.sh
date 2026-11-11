#!/usr/bin/env bash
# BUILDWISE 초기화 — 내 PC 의 개발 DB 와 의존성 볼륨을 지웁니다. 코드와 git 기록은 그대로입니다.
#   실행: ./scripts/reset.sh   (묻지 않고: ./scripts/reset.sh --force)   스크립트 없이: docker compose down -v
set -u
cd "$(dirname "$0")/.."

if [ "${1:-}" != "--force" ]; then
  read -r -p "내 PC 의 개발 DB 데이터가 지워집니다. 계속할까요? (y/N) " answer
  if [ "$answer" != "y" ]; then
    echo "취소했습니다."
    exit 0
  fi
fi
docker compose down -v || exit 1
echo "초기화했습니다. ./scripts/dev.sh 로 다시 켜세요."
