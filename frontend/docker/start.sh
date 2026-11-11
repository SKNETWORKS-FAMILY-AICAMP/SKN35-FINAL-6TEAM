#!/bin/sh
# 프론트 컨테이너 시작: package-lock.json 이 바뀌었으면 의존성을 다시 설치한 뒤 개발 서버를 켭니다.
set -eu
cd /workspace/frontend

HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ ! -f node_modules/.lock-hash ] || [ "$(cat node_modules/.lock-hash)" != "$HASH" ]; then
  echo "[frontend] package-lock.json 이 바뀌어 의존성을 다시 설치합니다"
  # node_modules 는 볼륨이라 폴더 자체는 지울 수 없어서 안의 내용만 비웁니다.
  find node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  npm install --no-audit --no-fund
  echo "$HASH" > node_modules/.lock-hash
fi

echo "[frontend] 개발 서버 시작 — http://localhost:${WEB_PORT:-5173}"
exec npm run dev -- --host 0.0.0.0 --port 5173
