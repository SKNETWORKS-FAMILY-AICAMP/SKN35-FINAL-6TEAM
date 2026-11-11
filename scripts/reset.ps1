# BUILDWISE 초기화 — 내 PC 의 개발 DB 와 의존성 볼륨을 지우고 처음 상태로 돌립니다.
# 코드와 git 기록은 건드리지 않습니다. 지운 뒤 .\scripts\dev.ps1 로 다시 켜면 견본 데이터가 다시 들어갑니다.
#   실행:  .\scripts\reset.ps1        (묻지 않고: .\scripts\reset.ps1 -Force)
#   스크립트 없이: docker compose down -v
param([switch]$Force)
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not $Force) {
    $answer = Read-Host '내 PC 의 개발 DB 데이터가 지워집니다. 계속할까요? (y/N)'
    if ($answer -ne 'y') {
        Write-Host '취소했습니다.'
        exit 0
    }
}
docker compose down -v
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host '초기화했습니다. .\scripts\dev.ps1 로 다시 켜세요.' -ForegroundColor Green
