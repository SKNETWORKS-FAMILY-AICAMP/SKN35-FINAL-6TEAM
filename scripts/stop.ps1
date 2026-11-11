# BUILDWISE 끄기 — 컨테이너만 지우고 DB 데이터는 남깁니다.
#   실행:  .\scripts\stop.ps1      (스크립트 없이: docker compose down)
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)
docker compose down
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host '꺼졌습니다. 다시 켜려면 .\scripts\dev.ps1' -ForegroundColor Green
