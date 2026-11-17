# BUILDWISE 개발 환경 켜기 (Windows PowerShell 5.1 / PowerShell 7)
#   실행:        .\scripts\dev.ps1
#   막히면:      powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1
#   스크립트 없이: docker compose up -d --build --wait
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host '[1/3] Docker 가 켜져 있는지 확인합니다'
docker version --format '{{.Server.Version}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Docker Desktop 이 꺼져 있습니다. Docker Desktop 을 켜고 왼쪽 아래가 "Engine running" 이 될 때까지 기다린 뒤 다시 실행하세요.' -ForegroundColor Red
    exit 1
}

Write-Host '[2/3] 컨테이너를 만들고 켭니다 (처음에는 5~10분 걸릴 수 있습니다)'
docker compose up -d --build --wait
if ($LASTEXITCODE -ne 0) {
    Write-Host '실행에 실패했습니다. 아래 명령으로 원인을 확인하세요. (docs/TROUBLESHOOTING.md)' -ForegroundColor Red
    Write-Host '  docker compose ps'
    exit 1
}

Write-Host '[3/3] 준비 완료' -ForegroundColor Green
Write-Host '  화면       http://localhost:5173'
Write-Host '  전체 검사  .\scripts\check.ps1'
Write-Host '  끄기       .\scripts\stop.ps1'
