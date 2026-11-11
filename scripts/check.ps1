# BUILDWISE 전체 검사 — PR 을 올리기 전에 실행합니다. (먼저 .\scripts\dev.ps1 로 켜 두세요)
#   실행:    .\scripts\check.ps1
#   막히면:  powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

$steps = @(
    @{ Name = '백엔드 린트 (ruff check)'; Run = { docker compose exec -T backend uv run --frozen ruff check . } },
    @{ Name = '백엔드 포맷 (ruff format --check)'; Run = { docker compose exec -T backend uv run --frozen ruff format --check . } },
    @{ Name = '견본 데이터 형식'; Run = { docker compose exec -T backend uv run --frozen python -m app.seed --check } },
    @{ Name = 'DB 모델과 마이그레이션 일치 (alembic check)'; Run = { docker compose exec -T backend uv run --frozen alembic check } },
    @{ Name = '백엔드 테스트 (pytest)'; Run = { docker compose exec -T backend uv run --frozen pytest -q } },
    @{ Name = '계약 파일 다시 만들기'; Run = { docker compose exec -T backend uv run --frozen python -m app.export_contracts; if ($LASTEXITCODE -eq 0) { docker compose exec -T frontend npm run gen:api } } },
    @{ Name = '계약 파일이 커밋본과 같은지'; Run = { git diff --exit-code -- contracts frontend/src/api/schema.d.ts } },
    @{ Name = '프론트 린트 (eslint)'; Run = { docker compose exec -T frontend npm run lint } },
    @{ Name = '프론트 포맷 (prettier)'; Run = { docker compose exec -T frontend npm run format:check } },
    @{ Name = '프론트 타입 검사 (tsc)'; Run = { docker compose exec -T frontend npm run typecheck } },
    @{ Name = '프론트 테스트 (vitest)'; Run = { docker compose exec -T frontend npm test } },
    @{ Name = '프론트 빌드 (vite build)'; Run = { docker compose exec -T frontend npm run build } }
)

$results = @()
$index = 0
foreach ($step in $steps) {
    $index++
    Write-Host ''
    Write-Host ("[{0}/{1}] {2}" -f $index, $steps.Count, $step.Name) -ForegroundColor Cyan
    & $step.Run
    $ok = ($LASTEXITCODE -eq 0)
    $results += [pscustomobject]@{ Step = $step.Name; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }) }
}

Write-Host ''
Write-Host '===== 결과 =====' -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String | Write-Host
$failed = @($results | Where-Object { $_.Result -eq 'FAIL' })
if ($failed.Count -gt 0) {
    Write-Host ("실패 {0}개. 위 출력에서 FAIL 단계의 오류를 확인하세요. (docs/QA_GUIDE.md)" -f $failed.Count) -ForegroundColor Red
    exit 1
}
Write-Host '모두 통과했습니다.' -ForegroundColor Green
