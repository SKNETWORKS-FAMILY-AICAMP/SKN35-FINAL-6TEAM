# 단위 테스트 운영 기준

이 폴더는 선택한 프로젝트의 기존 테스트를 이동하지 않고, 새 단위 테스트를 업무 영역별로 관리하기 위한 독립 공간입니다.

## 현재 적용 범위

| 영역 | 테스트 폴더 | 대상 코드 | 담당 | 상태 |
|---|---|---|---|---|
| 공통 계약 | `contracts/` | `backend/app/contracts/`, `contracts/` | PM | 기본 기준 설정 |
| 상담 · 음성 | `consultation/` | 상담 프론트와 상담 에이전트 | 미정 | 담당 확정 후 생성 |
| 오피스 화면 | `office/` | 오피스 프론트 | 미정 | 담당 확정 후 생성 |
| 설계 · 검증 | `agents_workflows/` | 에이전트와 워크플로 | 미정 | 담당 확정 후 생성 |
| 하드웨어 | `hardware_domain/` | 하드웨어 도메인과 견본 데이터 | 미정 | 담당 확정 후 생성 |
| 견적 · 주문 | `quotations_orders/` | 견적·주문 백엔드와 프론트 | 미정 | 담당 확정 후 생성 |

담당자 기준은 선택한 프로젝트의 `docs/TEAM_GUIDE.md` 담당표를 원본으로 삼습니다. 담당이 정해지면 해당 업무 폴더와 테스트를 만들고 이 표의 담당 및 상태를 함께 갱신합니다.

## 기본 규약 테스트 9건

1. 환경변수 계약에 Breaking 변경 없음
2. API 계약에 Breaking 변경 없음
3. 저장된 이벤트 JSON 스키마와 Python 계약 일치
4. `Team` 열거형 값 고정
5. `WorkStatus` 열거형 값 고정
6. `EventType` 열거형 값 고정
7. `ArtifactKind` 열거형 값 고정
8. 정의되지 않은 요구사항 필드 거부
9. 시간대 없는 날짜를 UTC로 변환

## 추가 규칙

1. 한 테스트 파일은 위 표의 한 업무 영역만 검증합니다.
2. 파일 이름은 `test_<검증대상>.py`, 테스트 이름은 `test_<조건>_<기대결과>` 형식을 사용합니다.
3. 외부 DB, 네트워크, Docker가 필요하면 단위 테스트가 아니라 모듈·시스템·인수 테스트로 분류합니다.
4. 공통 계약 테스트는 계약을 수정하지 않고 변경 여부만 감지합니다. 의도적인 계약 변경에는 별도의 계약 변경 PR이 필요합니다.
5. 담당 영역 테스트를 추가한 사람은 대상 코드 경로와 실행 결과를 PR에 기록합니다.
6. 모든 테스트 결과 XML과 같은 이름의 Excel(.xlsx)은 공통 `backend/tests/reports/`에 저장합니다.

### Excel 자동 생성

`python -B tests/unit/run.py` 실행 시 BASE와 ALL 각각 XML + Excel 한 쌍을 생성합니다.
`--test-id` 개별 실행도 동일합니다. 별도 설치나 가상환경 생성은 하지 않습니다.
일반 `pytest --junitxml=...` 직접 실행은 이 실행기를 거치지 않으므로 Excel을 만들지 않습니다.

Excel은 `요약`, `테스트 상세` 시트로 구성됩니다. 상세 시트에는 테스트 함수·결과·시간·오류와
검증 대상·검증 기준·기대값·실제값이 표시됩니다. 기본 규약 9건은 실제 비교값을 JUnit properties에
기록합니다. 다른 테스트는 properties를 기록하지 않았다면 해당 설명 칸이 비어 있습니다.
이는 검증하지 않은 내용을 추측해서 채우지 않기 위한 것입니다.
`검증 요소 상세` 시트는 실제 pytest 9건을 상위 그룹으로 두고 내부 비교 요소를 별도 행으로 표시합니다.
열거형은 요소 수와 위치별 값, 이벤트 스키마는 JSON 경로별 키·값, API Breaking은 경로별 내역으로 나눕니다.
상위 ID와 하위 ID(예: 4.001)로 연결하며 하위 행은 추가 실행된 단위테스트가 아닙니다.
API 불일치는 소스의 문자열 상수 prefix 근거와 저장 명세의 해당 경로 존재 여부를 함께 표시합니다.
진단 보조 코드는 단순한 상수만 해석하며 앱을 import하거나 외부 API에 접속하지 않습니다.
기본 규약 결과에는 입력/사전조건·비교 방법·검증 제외 범위·테스트 파일/행도 기록합니다.
Excel의 오류 유형은 JUnit의 failure/error/skipped type을 사용합니다.
기록되지 않은 추가 정보는 `미기록`으로 표시하며, 실제로 검사하지 않은 내용을 통과로 표시하지 않습니다.
열거형은 값·개수·순서를 비교하며, 환경/API 호환성은 인벤토리의 Breaking 판정 결과를 검사합니다.
실서버 접속이나 API 실호출 성공을 뜻하지 않습니다. 상세화해도 테스트 개수는 변하지 않습니다.

실패한 테스트도 XML이 생성되었다면 Excel로 내보내고 실패 종료 코드를 유지합니다.
Excel 생성이 실패하거나 XML이 갱신되지 않으면 오류를 표시하고 비정상 종료합니다.
XML 원본은 수정하지 않습니다. 긴 기대값/실제값은 Excel 셀에서 펼쳐 볼 수 있으며,
Excel 셀 제한(32,767자)을 넘는 값은 잘립니다. 전체 원본은 XML을 확인하세요.
7. 파일명과 XML 내부 제목은 `../common/REPORT_NAMING.md`의 공통 규약을 사용합니다.
8. 새 단위 테스트는 구현 후 `catalog.json`에 등록해야 실행 목록에 나타납니다.

## 코드 후보 수집

`discover.py`는 공통 `../config.py`에 설정된 프로젝트에서 단위 테스트 가능한 코드를 최대한 수집해 `inventory.json`으로 만듭니다.

```powershell
python "C:\sk-encoa\SKN35-FINAL-6TEAM\jjb\backend\tests\unit\discover.py"
```

- Python 함수·클래스·메서드는 AST로 수집합니다.
- TypeScript 함수·Hook·React 컴포넌트는 정적 휴리스틱으로 수집합니다.
- 기존 테스트에서 심볼이 참조되는지 함께 기록합니다.
- 프론트 후보는 브라우저 없이 `Vitest` 직접 실행 또는 `react-dom/server` 경량 렌더링을 우선합니다.
- 실제 브라우저 상호작용은 `system_acceptance` 대상으로 분류합니다.
- 수집 결과는 후보 목록이며, 요구사항 ID·담당자·기대 결과를 검토한 뒤 `catalog.json`에 등록합니다.

### 코드 변경 비교

최초 실행은 현재 코드 상태를 `inventory_baseline.json`에 기준으로 저장합니다. 이후 실행은 기준을 자동으로 덮어쓰지 않고 `inventory.json`의 `comparison`에 다음 결과를 포함합니다.

- `added`: 새로 생긴 함수·클래스·컴포넌트
- `removed`: 기준 이후 삭제된 심볼
- `changed`: 인자·반환 타입·필드·열거형 값 등 구조가 바뀐 심볼
- `uncoveredAddedCandidates`: 새 후보 중 기존 단위 테스트 참조가 없는 항목

변경 사항을 검토하고 현재 상태를 새 기준으로 승인할 때만 다음 명령을 사용합니다.

```powershell
python "C:\sk-encoa\SKN35-FINAL-6TEAM\jjb\backend\tests\unit\discover.py" --accept-baseline
```

일반적인 `run.py` 실행은 비교 결과만 갱신하며 기준 파일은 변경하지 않습니다.
코드 비교 결과는 상태 정보로만 저장하며 기본 규약 pytest의 PASS·FAIL과 테스트 건수에는 포함하지 않습니다.

### 환경변수·API 계약

`inventory.json`의 `contracts`와 `contractComparison`에 다음 계약 상태를 저장합니다.

- 환경변수: `.env.example`, Pydantic `BaseSettings`, Python·프론트 환경변수 참조에서 이름·필수 여부·타입만 수집
- API: FastAPI 라우터의 경로·메서드·입력·응답·상태 코드와 `contracts/openapi.json`의 요청·응답 스키마 수집
- 실제 `.env` 파일과 환경변수 값은 읽거나 저장하지 않음

새 환경변수와 새 API 추가는 상태로만 기록합니다. 기존 환경변수 삭제·구조 변경, API 삭제·경로·메서드·입력·응답 계약 변경, 소스와 OpenAPI 불일치는 Breaking으로 처리해 기본 규약을 실패시킵니다.

## 실행

프로젝트 경로는 모든 테스트 단계가 공유하는 `backend/tests/config.py`에서 관리합니다. 각 사용자는 실행 전에 `PROJECT_PATH`에 자신의 프로젝트 루트 절대 경로를 직접 지정합니다. `__file__`을 이용한 자동 계산은 사용하지 않습니다. 경로는 `backend`나 `tests`가 아닌 저장소 루트를 지정합니다.

```python
PROJECT_PATH = Path(r"C:\sk-encoa\SKN35-FINAL-6TEAM\jjb")
```

공통 Python 기준은 `../common/runtime.py`의 `REQUIRED_PYTHON = (3, 14)`를 사용합니다. 이 규칙은 단위·모듈·시스템·인수 테스트에서 함께 사용합니다.

그다음 터미널에서 Python 3.14 실행기를 호출합니다. 실행할 때 프로젝트 경로를 다시 묻지 않습니다. Python 3.12 등 다른 버전에서는 인벤토리와 XML을 갱신하기 전에 오류로 종료합니다.

```powershell
python "C:\sk-encoa\SKN35-FINAL-6TEAM\jjb\backend\tests\unit\run.py"
```

현재 Windows 공용 환경을 활성화하지 않고 바로 실행하려면 다음 한 줄을 사용합니다.

```powershell
& "C:\sk-encoa\.environment-center\envs\SKN35-FINAL-6TEAM-jjb-backend\Scripts\python.exe" "C:\sk-encoa\SKN35-FINAL-6TEAM\jjb\backend\tests\unit\run.py"
```

이 공용 환경은 `jjb/backend/uv.lock`을 기준으로 설치되며 저장소 내부에 `.venv`를 만들지 않습니다.

실행하면 현재 코드 인벤토리를 먼저 갱신하고, `catalog.json`에 등록된 단위 테스트를 자동으로 실행합니다. 별도의 선택이나 경로 입력은 없습니다. 기본 실행은 기본 규약 XML 1개와 전체 단위 테스트 집계 XML 1개만 생성합니다.

실행기는 가상환경을 생성하거나 패키지를 설치하지 않습니다. 현재 Python 3.14에 `backend/pyproject.toml`의 정확한 버전이 모두 설치되어 있을 때만 `python -B -m pytest`로 실행하며, Python 버전·패키지 누락 또는 버전 불일치가 있으면 프로젝트 파일을 건드리지 않고 종료합니다. pytest 캐시와 Python 바이트코드 생성도 비활성화합니다. 갱신되는 파일은 코드 비교용 `inventory.json`과 결과 XML뿐입니다.

현재 기본 실행은 다음 XML 2개를 생성합니다.

- 기본 규약 9건: `YYMMDD_<브랜치>_unit_BASE_common-contract_001.xml`
- 전체 단위 테스트: `YYMMDD_<브랜치>_unit_ALL_backend-suite_001.xml`

`ALL` XML 내부에서는 pytest의 `classname`과 테스트 이름으로 카탈로그·도메인, 하드웨어, 워크플로, RAG, 기본 규약을 구분합니다. `catalog.json`의 `tests`에 등록된 대상만 포함하며 `classifiedElsewhere`의 모듈 테스트는 포함하지 않습니다.

실제 MySQL 연결, 인메모리 Qdrant 저장소, 전체 LangGraph 흐름을 검증하는 다음 파일은 단위 테스트에서 제외하고 `module` 통합 테스트 대상으로 관리합니다.

- `backend/tests/hardware_data/test_mysql.py`
- `backend/tests/rag/test_qdrant.py`
- `backend/tests/hardware_workflow/test_graph.py`

Playwright의 `frontend/e2e/smoke.spec.ts`는 `system_acceptance` 대상으로 관리합니다. 프론트 단위 테스트인 `frontend/src/features/office/officeState.test.ts`는 Docker 프론트 환경 또는 별도 Node 의존성 환경이 준비된 뒤 Vitest 카탈로그로 연결합니다.

특정 테스트만 필요할 때 테스트 ID를 인자로 전달합니다.

```powershell
python .\backend\tests\unit\run.py --test-id unit-base-common-contract-001
```

공통 계약 결과는 다음 형식으로 생성됩니다.

```text
C:\sk-encoa\SKN35-FINAL-6TEAM\jjb\backend\tests\reports\YYMMDD_jjb_unit_BASE_common-contract_001.xml
```

`catalog.json`에 새 테스트를 추가하면 다음 실행부터 `ALL` XML에 자동으로 포함됩니다. 같은 날짜에 다시 실행하면 BASE와 ALL XML을 최신 결과로 덮어씁니다. `--test-id`를 지정한 경우에만 선택한 항목을 기존 제목 규약의 개별 XML로 생성합니다.

## 백엔드 테스트 폴더 연동

실제 업무 테스트와 테스트 도구의 기준 위치는 선택한 프로젝트의 `backend/tests/`입니다. 기존 업무 테스트 파일은 그대로 두고 실행 규칙·인벤토리·분류·XML 리포트는 각각 `common/`, `unit/`, `module/`, `system_acceptance/`, `reports/`에서 관리합니다. 기본 규약처럼 테스트 도구 자체를 검증하는 파일은 `unit/contracts/`에 둡니다.

`run.py`는 실행 전에 `backend/tests/`의 모든 `test_*.py`와 `*_test.py`를 검사합니다.

- 순수 단위 테스트는 `catalog.json`의 `tests`에 등록합니다.
- DB·저장소·전체 워크플로처럼 통합 성격인 테스트는 `classifiedElsewhere`에 단계와 이유를 기록합니다.
- 전체 실행(옵션 없이 BASE + ALL 실행)에서는 새 파일이 어느 쪽에도 없으면 미분류 오류를 내고 실행을 중단합니다.
- `--test-id` 개별 실행에서는 전체 파일 분류 검사를 생략합니다. 선택한 ID·대상 파일·필수 경로·Python·의존성 검사는 유지하므로, 무관한 신규 테스트 파일이 기본 규약 실행을 막지 않습니다.

따라서 앞으로 업무별 단위 테스트를 추가할 때는 `backend/tests/<업무영역>/test_<대상>.py`에 작성하고 `catalog.json`에 독립 XML 정보와 함께 등록합니다.
