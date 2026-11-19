# 데이터

- `hardware/`: docyx 원본과 연결할 제조사 검토 사양 및 호환성 근거.

- [수집 실행 기록](collection/runs/2026-11-17/)에는 후보, 오류·실행 로그, 인벤토리, 봇 설정 예시가 있습니다.
- [벤치마크 배포본](benchmarks/releases/2026-11-17/)에는 부품·벤치마크 미리보기 ZIP이 있습니다.
- [RAG 배포본](rag/releases/)에는 날짜별 ZIP, 확인용 Excel, 추가 자료의 정규화 JSONL이 있습니다.

수집·전처리 봇은 [실행 안내](../scripts/collection/README.md)를, 날짜별 파일 설명은 [수집 자료 색인](../docs/데이터_수집/README.md)을 참고하세요.

MySQL 부품 적재 코드는 `backend/app/domains/hardware/ingestion/`, DB 연결은
`backend/app/db/connection.py`, SQL은 `backend/app/db/sql/parts_catalog.sql`에 있습니다.
실행 방법과 데이터 정책은 [부품 데이터 안내](../docs/database/README.md)를 참고하세요.
