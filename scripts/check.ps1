# 로컬 DB 코드와 프론트 정적 검사. Docker 없이 실행합니다.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

$steps = @(
    @{ Name = '백엔드 린트 (ruff check)'; Run = { uv run --directory backend --frozen ruff check . } },
    @{ Name = '백엔드 포맷 (ruff format --check)'; Run = { uv run --directory backend --frozen ruff format --check . } },
    @{ Name = '백엔드 테스트 (pytest)'; Run = { uv run --directory backend --frozen pytest -q } },
    @{ Name = '프론트 린트 (eslint)'; Run = { npm --prefix frontend run lint } },
    @{ Name = '프론트 포맷 (prettier)'; Run = { npm --prefix frontend run format:check } },
    @{ Name = '프론트 타입 검사 (tsc)'; Run = { npm --prefix frontend run typecheck } },
    @{ Name = '프론트 테스트 (vitest)'; Run = { npm --prefix frontend test } },
    @{ Name = '프론트 빌드 (vite build)'; Run = { npm --prefix frontend run build } }
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
