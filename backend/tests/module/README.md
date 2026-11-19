# 모듈 테스트

모듈 간 연결을 검증하는 테스트를 이 폴더에 추가합니다. 구현 시 `config.py`, `catalog.json`, `run.py`를 함께 두고 결과는 `../report/`에 저장합니다. Python 실행 기준은 `../common/runtime.py`의 3.14 규칙을 공통으로 사용합니다.

현재 분류된 통합 테스트 대상:

- `backend/tests/hardware_data/test_mysql.py`: 실제 MySQL 제약과 롤백
- `backend/tests/rag/test_qdrant.py`: 인메모리 Qdrant 저장소 연동
- `backend/tests/hardware_workflow/test_graph.py`: 전체 LangGraph 워크플로 호출
