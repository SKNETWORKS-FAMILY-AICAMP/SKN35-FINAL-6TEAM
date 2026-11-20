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

| ID | 검증하는 연결과 값 |
|---|---|
| value-flow | 상담 → 검색 질문·필터, 검증기 선택 수량·BIOS·부하 인수, 검증 → 견적 가격·수량·근거, 불완전/미검증/장애 결과 차단 |
| graph | 기존 전체 LangGraph 테스트: 재설계, 고정 부품 수량, 최종 금액, 조건부 근거, 오류 시 중단 |
| qdrant | 기존 Qdrant 저장·재개방·필터·출처 검사. 로컬 모델이 없으면 모델 검사는 기존 규칙대로 skip |
| mysql | 기존 실제 DB 조회·제약·가격 갱신·견적 스냅샷 검사. `--with-db`에서 실행. 대량 재적재 멱등성 검사는 `--full-db`에서만 포함 |

실제 DB 검사는 현재 `.env`와 환경변수 연결 설정을 그대로 사용합니다. 기존 테스트는 autocommit=False 연결에서 실행 후 rollback합니다. DDL·commit은 실행하지 않지만, 검사 중 임시 INSERT/UPDATE와 잠금이 발생하고 AUTO_INCREMENT 번호는 소모될 수 있습니다. 동시 쓰기가 없는 개발 DB에서 실행하세요. 견본 부품/근거가 없거나 DB가 제약을 지원하지 않으면 실패로 보고하며 기대값을 완화하지 않습니다.

## 결과

공통 `../reports/`에 XML·Excel 한 쌍을 생성합니다.

`YYMMDD_브랜치명_module_ALL_value-flow-suite_001.xml` (+ `.xlsx`)

선택 실행도 동일한 이름을 갱신하므로 실행별 보관은 별도로 해야 합니다. 이번 실행 대상은 XML 테스트 경로와 Excel 상세에서 확인합니다. 순번 001은 실행 횟수가 아니라 등록된 테스트 묶음 번호입니다.

공통 assertion 상세 수집기로 실제 실행한 assert·Mock 호출 검증·unittest 검증 요소를 기록합니다. 테스트 건수와 세부 검증 요소 수는 구분합니다. skip은 성공으로 해석하지 않으며 수집하지 못한 요소는 확인된 것으로 표시하지 않습니다. 기존 외부 폴더 테스트는 이동하지 않고 `catalog.json`에서 참조합니다.

기본/`--with-db` 실행은 대량 재적재 1건을 deselect하며 콘솔에 범위 제외를 알립니다. JUnit은 deselect를 testcase로 남기지 않으므로 전체 DB 검사 완료로 해석하지 마세요. 제외한 기존 검사의 내용·기대값은 변경하지 않습니다.
