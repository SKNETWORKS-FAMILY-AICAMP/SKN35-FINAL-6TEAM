# BUILDWISE 초기화 — 프론트 개발용 Docker 볼륨을 지웁니다.
# 다시 시작하려면 .\scripts\dev.ps1 을 실행합니다.
#   실행:  .\scripts\reset.ps1        (묻지 않고: .\scripts\reset.ps1 -Force)
#   스크립트 없이: docker compose down -v
param([switch]$Force)
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not $Force) {
    $answer = Read-Host '프론트 개발용 Docker 볼륨을 지웁니다. 계속할까요? (y/N)'
    if ($answer -ne 'y') {
        Write-Host '취소했습니다.'
        exit 0
    }
}
docker compose down -v
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host '초기화했습니다. .\scripts\dev.ps1 로 다시 켜세요.' -ForegroundColor Green
