# 저장된 OpenAPI 스냅샷에서 프론트 타입을 만듭니다.
Set-Location (Split-Path -Parent $PSScriptRoot)
uv run --directory backend --frozen python -m app.export_contracts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm --prefix frontend run gen:api
exit $LASTEXITCODE
