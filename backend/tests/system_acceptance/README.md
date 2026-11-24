# 시스템·인수 테스트

전체 시스템 흐름과 사용자 인수 기준을 검증하는 테스트를 이 폴더에 추가합니다. 구현 시 Python 실행기와 목록을 두고, 테스트 종류는 각각 `system`, `acceptance`를 사용합니다. 프로젝트 경로는 공통 `../config.py`의 `PROJECT_PATH`를 사용하며 사용자별 경로 설정을 이 폴더에 별도로 만들지 않습니다. Python 도구는 `../common/runtime.py`의 3.14 규칙을 공통으로 사용하고 결과는 `../reports/`에 저장합니다.

현재 분류된 E2E 대상:

- `frontend/e2e/smoke.spec.ts`: Playwright 브라우저 기반 스모크 테스트
