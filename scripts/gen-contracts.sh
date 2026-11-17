#!/usr/bin/env bash
# 저장된 OpenAPI 스냅샷에서 프론트 타입을 만듭니다.
set -euo pipefail
cd "$(dirname "$0")/.."
npm --prefix frontend run gen:api
git status --short -- frontend/src/api/schema.d.ts
