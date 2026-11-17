# BUILDWISE

현재 작업은 로컬 MySQL `dev_database`의 PC 부품·상담·견적 스키마와 데이터 수집에 집중합니다.

- [DB 설정과 적재 방법](docs/database/README.md)
- [스키마 SQL](backend/app/db/sql/parts_catalog.sql)
- [ERD](docs/database/erd/schema.svg)
- [수집 데이터](data/README.md)

기존 Mock 앱 소스와 API 계약 파일은 참고용으로 보관합니다. 백엔드 실행과 API 계약 재생성은 앱이 새 DB에 연결된 뒤 재개합니다.

DB 연결 확인과 테스트는 저장소 루트에서 실행합니다.

```powershell
uv sync --directory backend --frozen
uv run --directory backend --frozen python -X utf8 -m app.db.schema
uv run --directory backend --frozen pytest -q
```
