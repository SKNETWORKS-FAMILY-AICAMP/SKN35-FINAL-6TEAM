# API 계약 파일 다시 만들기 — backend/app/contracts/schemas.py 나 API 경로를 바꾼 뒤 실행합니다.
#   만드는 파일: contracts/openapi.json · contracts/events.schema.json · frontend/src/api/schema.d.ts
#   실행:  .\scripts\gen-contracts.ps1   (먼저 .\scripts\dev.ps1 로 켜 두세요)
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

docker compose exec -T backend uv run --frozen python -m app.export_contracts
if ($LASTEXITCODE -ne 0) { exit 1 }
docker compose exec -T frontend npm run gen:api
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host '계약 파일을 다시 만들었습니다. 바뀐 파일을 같은 PR 에 커밋하세요.' -ForegroundColor Green
git status --short -- contracts frontend/src/api/schema.d.ts
