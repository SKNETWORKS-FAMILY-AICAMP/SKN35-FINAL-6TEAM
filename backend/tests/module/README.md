# 모듈 테스트

모듈이 호출되었는지만 아니라 **올바른 입력·호출 인수·반환값·다음 단계 상태**가 전달되는지 검사합니다. 운영 코드는 변경하지 않습니다.

## 실행

단위 테스트의 `unit/run_all.py`처럼 **`module/run_all.py` 하나만 실행**하면 됩니다.

프로젝트 루트에서:

```powershell
python -B backend/tests/module/run_all.py
```

`module` 폴더에서는 `python -B run_all.py`로 실행합니다. 일반 DB 검사도 자동 포함하며, 대량 재적재 검사는 제외합니다. 경로 입력이나 환경 활성화 없이 아래 공통 설정과 기존 실행기를 그대로 사용하고 XML·Excel 한 쌍을 생성합니다. 추가 옵션은 기존 실행기로 전달됩니다 (`--full-db`는 대량 검사 포함).

### 선택 실행 및 고급 옵션

공통 `../config.py`의 `PROJECT_PATH`, `PROJECT_PYTHON`을 사용합니다. 실행기는 설정된 Python 3.14로 전환하며 가상환경·패키지를 생성하거나 설치하지 않습니다.

```powershell
python C:\sk-encoa\SKN35-FINAL-6TEAM\jjb\backend\tests\module\run.py
# 현재 설정된 실제 DB 검사도 포함 (테스트 DML은 rollback)
python C:\sk-encoa\SKN35-FINAL-6TEAM\jjb\backend\tests\module\run.py --with-db
# 호환성 데이터 23,000건 이상을 두 차례 재반영하는 장시간 DB 검사까지 포함
python C:\sk-encoa\SKN35-FINAL-6TEAM\jjb\backend\tests\module\run.py --full-db
# 선택 실행
python C:\sk-encoa\SKN35-FINAL-6TEAM\jjb\backend\tests\module\run.py --test-id value-flow
```

## 범위

### 연결별 상세 기록 (2026-11-23)

`value-flow`와 `db-flow`는 **출발 모듈 → 도착 모듈 : 확인 필드** 단위로 결과를 남깁니다.
각 연결에는 입력/설정값, 기대값, 실행 직후 실제값, 일치/불일치, 실제 모듈/Mock/실제 DB 구분,
검증하지 않은 범위를 기록합니다. 비교 실패도 기록한 뒤 테스트를 실패시킵니다.

| 연결 예시 | 리포트에서 확인할 값 |
|---|---|
| 상담 정규화 → RAG 검색 서비스 | 질문 원문, 검색 필터, 호출 횟수, 고정 부품 PK·수량 |
| RAG 검색 응답 → 출처 인용 상태 | chunk/source ID, URL, 제목, 발행자 |
| 상담 조건 → 카탈로그 → 설계 선택 | 조회 분류·고정 PK, 반환 상품, 선택 PK·수량·선정 근거 |
| 설계 선택 → 조립 검증 | 선택 PK·수량, BIOS, 라디에이터, 기타 부하와 검사 응답 |
| 검증 결과 → 견적 계산 | 부품 PK, 수량, 단가, 소계, 총액, 검증 결과, 출처 |
| 잘못된 입력/검색 오류 → 그래프 중단 | 상태·사유, 후속 검색/카탈로그/검증 호출 0회 |
| 가상 사용자 입력 → users INSERT → PK 조회 | 실제 발급 user_id, 같은 PK로 조회한 테스트 표시 이름, 롤백 후 부재 |
| 사용자 PK → consultations → JOIN 조회 | consultation_id, user_id FK, 목적, 저장 설정 JSON, 롤백 후 부재 |
| 부품 PK → list_parts → DB 조회 | PK·분류·제조사·이름·가격·통화·specs 변환 |
| 없는 부품 PK → 조회 → 조립 검증 | 빈 조회 결과, 정확한 누락 ID ValueError (접속 실패와 구분) |

사용자 테스트는 **DB 드라이버와 기존 users/consultations 스키마 연결 검사**입니다.
없는 사용자 생성/로그인 API를 만들어 테스트한 것처럼 표시하지 않습니다.
자체 생성한 가상 표시 이름만 사용하고 기존 사용자 개인정보는 조회/리포트에 기록하지 않습니다.
가상 상품 PK `8`은 Mock 사례 전용이며 실제 DB 테스트는 DB에서 선택한 PK를 사용합니다.

```powershell
# 연결별 값 전달만 (실제 DB 접속 없음)
python -B backend/tests/module/run.py --test-id value-flow
# 사용자 PK·FK 및 상품 조회/없는 ID 검사만 (실제 개발 DB)
python -B backend/tests/module/run.py --test-id db-flow --with-db
```

`conftest.py`, `flow_report.py`, `test_db_flow.py`는 module 전용입니다.
공통 수집기·Excel 생성기·운영 코드·DB 스키마·다른 단계 설정을 수정하지 않습니다.
기존 graph/qdrant/mysql 파일은 그대로 참조하고 기존 자동 assertion 상세를 보존합니다.

| ID | 검증하는 연결과 값 |
|---|---|
| value-flow | 상담 → 검색 질문·필터, 검증기 선택 수량·BIOS·부하 인수, 검증 → 견적 가격·수량·근거, 불완전/미검증/장애 결과 차단 |
| db-flow | 실제 사용자 입력 → 발급 PK → 조회, 상담 FK/JSON 조회, 부품 PK 조회, 없는 ID 오류. `--with-db`에서만 실행 |
| graph | 기존 전체 LangGraph 테스트: 재설계, 고정 부품 수량, 최종 금액, 조건부 근거, 오류 시 중단 |
| qdrant | 기존 Qdrant 저장·재개방·필터·출처 검사. 로컬 모델이 없으면 모델 검사는 기존 규칙대로 skip |
| mysql | 기존 실제 DB 조회·제약·가격 갱신·견적 스냅샷 검사. `--with-db`에서 실행. 대량 재적재 멱등성 검사는 `--full-db`에서만 포함 |

실제 DB 검사는 현재 `.env`와 환경변수 연결 설정을 그대로 사용합니다. 기존 테스트는 autocommit=False 연결에서 실행 후 rollback합니다. DDL·commit은 실행하지 않지만, 검사 중 임시 INSERT/UPDATE와 잠금이 발생하고 AUTO_INCREMENT 번호는 소모될 수 있습니다. 동시 쓰기가 없는 개발 DB에서 실행하세요. 견본 부품/근거가 없거나 DB가 제약을 지원하지 않으면 실패로 보고하며 기대값을 완화하지 않습니다.

## 결과

콘솔은 `[연결] 출발 모듈 → 도착 모듈 : PASS/FAIL/ERROR/SKIP / 비교 수`를 표시합니다.
연결별 실제 필드 값은 XML 속성과 Excel `테스트 상세`·`검증 요소 상세`에서 확인합니다.
명시적 연결 기록은 이 폴더의 `conftest.py`·`flow_report.py`로만 처리합니다.
기존 graph/qdrant/mysql 테스트는 원래 자동 수집 방식을 유지하며 파일을 수정하지 않습니다.
신규 DB 사례는 `db_flow.py`를 카탈로그에서 명시적으로 실행합니다. 기존 단위 실행기의
`test_*.py` 미분류 탐지에 새 파일이 들어가지 않도록 한 구조이며, 단위 카탈로그는 수정하지 않습니다.
이 테스트는 프로젝트 모든 모듈을 자동 발견하는 도구가 아니라 `catalog.json`에 등록한 범위입니다.

공통 `../reports/`에 XML·Excel 한 쌍을 생성합니다.

`YYMMDD_브랜치명_module_ALL_value-flow-suite_001.xml` (+ `.xlsx`)

선택 실행도 동일한 이름을 갱신하므로 실행별 보관은 별도로 해야 합니다. 이번 실행 대상은 XML 테스트 경로와 Excel 상세에서 확인합니다. 순번 001은 실행 횟수가 아니라 등록된 테스트 묶음 번호입니다.

공통 assertion 상세 수집기로 실제 실행한 assert·Mock 호출 검증·unittest 검증 요소를 기록합니다. 테스트 건수와 세부 검증 요소 수는 구분합니다. skip은 성공으로 해석하지 않으며 수집하지 못한 요소는 확인된 것으로 표시하지 않습니다. 기존 외부 폴더 테스트는 이동하지 않고 `catalog.json`에서 참조합니다.

기본/`--with-db` 실행은 대량 재적재 1건을 deselect하며 콘솔에 범위 제외를 알립니다. JUnit은 deselect를 testcase로 남기지 않으므로 전체 DB 검사 완료로 해석하지 마세요. 제외한 기존 검사의 내용·기대값은 변경하지 않습니다.
