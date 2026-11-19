# Start the local BUILDWISE consultation demo. Run from any working directory.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $repoRoot 'frontend')
try {
    if (-not (Test-Path -LiteralPath 'node_modules/.bin/vite.cmd')) {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
Push-Location (Join-Path $repoRoot 'backend')
try {
    if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
        & uv sync --frozen
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    Write-Host 'BUILDWISE demo: http://127.0.0.1:8017/ (Ctrl+C to stop)'
    & .\.venv\Scripts\python.exe -X utf8 -m app.domains.hardware.consultation_demo.web
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
