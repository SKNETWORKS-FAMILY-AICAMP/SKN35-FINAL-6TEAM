# 저장된 OpenAPI 스냅샷에서 프론트 타입을 만듭니다.
Set-Location (Split-Path -Parent $PSScriptRoot)
npm --prefix frontend run gen:api
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git status --short -- frontend/src/api/schema.d.ts
