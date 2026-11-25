# jjb_daily

날짜별 작업 내용을 누적합니다. 같은 날짜의 작업은 해당 항목에 추가합니다.

## 20261120 작업개요

- 프로젝트: BUILDWISE 최종 프로젝트
- 작업자: jjb 브랜치 담당
- 작업 범위: 단위 테스트 운영 구조 정리, 기본 규약·ALL 검증 요소 상세화, XML·Excel 리포트 자동 생성
- 상태: 기본 규약과 등록된 ALL 실행·리포트 검증 완료. 기존 API 계약 실패와 미분류 테스트 정리 필요
- **오늘 한 일**: 별도 테스트 공간에서 관리하던 도구를 `backend/tests/` 기준으로 정리했습니다. 공통 규칙은 `common/`, 단계별 운영은 `unit/`·`module/`·`system_acceptance/`, 결과는 `reports/`로 구분하고 대상 경로는 공통 `config.py`에서 관리하도록 했습니다.
- **오늘 한 일**: 기본 규약만 실행할 때 무관한 신규 테스트 파일의 미분류 오류에 막히지 않도록 개별 실행과 전체 분류 검사를 분리했습니다. 전체 실행에서는 기존 분류 검사를 유지합니다.
- **오늘 한 일**: 테스트 실행 뒤 XML과 같은 이름의 Excel을 자동 생성하도록 연결했습니다. 추가 패키지 없이 Python 표준 라이브러리를 사용하며, 실패 결과도 기록하고 실패 종료 코드는 유지합니다.
- **오늘 한 일**: 기본 규약 9건을 상위 그룹으로 두고 실제 비교한 내용을 하위 169개 요소로 나눴습니다. 열거형은 요소 수와 위치별 값, 이벤트 스키마는 JSON 경로별 키·값, API 계약은 불일치 경로별 내역을 표시합니다.
- **오늘 한 일**: 업무 테스트의 일반 assert·unittest·Mock·예상 예외 검증도 공통 수집기로 기록하도록 ALL에 연결했습니다. 검증 표현식을 재실행하지 않고 원래 실행 시점의 근거를 수집하며, BASE의 수동 상세 기록과 중복 집계하지 않습니다.
- **오늘 한 일**: API 실패에 대해 수집기의 prefix 상수 해석 한계와 저장 OpenAPI 경로 누락을 구분해 근거·확인 사항을 추가했습니다. 실제 API 연결이나 OpenAI 키 인증을 검사한 결과와 혼동하지 않도록 범위를 명시했습니다.
- **오늘 한 일**: 기존 Python 3.14.8 개발 환경에서 기본 규약과 등록된 ALL을 실행하고, XML·Excel 집계와 상세 항목 연결을 확인했습니다.
- **정한 것 (테스트와 리포트)**: 항목: 실행 환경 · 결정: Python 3.14. 기존 개발 환경을 사용하며 가상환경·패키지 자동 생성·설치 안 함
- **정한 것 (테스트와 리포트)**: 항목: 경로 설정 · 결정: `backend/tests/config.py`에서 프로젝트 루트 지정. 공유본은 안내값으로 유지
- **정한 것 (테스트와 리포트)**: 항목: 개별 실행 · 결정: `--test-id` 사용. 전체 파일 분류 검사는 생략하고 선택 ID·대상·필수 경로·의존성 검사는 유지
- **정한 것 (테스트와 리포트)**: 항목: 기본 전체 실행 · 결정: BASE와 등록된 ALL 각각 XML·Excel 한 쌍 생성. 전체 파일 분류 검사 유지
- **정한 것 (테스트와 리포트)**: 항목: 모듈 테스트 · 결정: 실제 MySQL·Qdrant·전체 LangGraph로 분류된 3개 파일은 ALL에서 제외
- **정한 것 (테스트와 리포트)**: 항목: 리포트 이름 · 결정: `YYMMDD_<브랜치명>_<단계>_<요구사항ID>_<검증대상>_<일련번호>` 뒤에 `.xml`·`.xlsx` 사용
- **정한 것 (테스트와 리포트)**: 항목: 일련번호·재실행 · 결정: 카탈로그 식별 번호 사용. 실행 회차로 자동 증가하지 않으며 같은 이름은 최신 결과로 교체
- **정한 것 (테스트와 리포트)**: 항목: 상세 구조 · 결정: `요약`·`테스트 상세`·`검증 요소 상세` 시트. 상위 ID와 하위 ID로 연결
- **정한 것 (테스트와 리포트)**: 항목: 집계 단위 · 결정: testcase·subtest·하위 비교 요소를 구분하고 서로 합산하지 않음
- **정한 것 (테스트와 리포트)**: 항목: 상세 정보 · 결정: 대상·기준·입력 조건·비교 방법·기대값·실제값·제외 범위·테스트 위치·오류 유형 기록
- **정한 것 (테스트와 리포트)**: 항목: 관측 한계 · 결정: 실행되지 않은 분기나 수집하지 못한 검증을 임의로 통과 처리하지 않음
- **정한 것 (테스트와 리포트)**: 항목: 결과 보관 · 결정: `backend/tests/reports/` 사용. 원본은 작업일지에 복사하지 않고 링크로 연결
- **결과와 한계**: 기본 규약은 **9건 중 8건 통과·1건 실패**, 하위 비교 요소는 **169개**입니다. 내역은 환경 계약 1개·API 불일치 경로 12개·이벤트 스키마 119개·열거형 35개·미정의 필드 1개·UTC 정규화 1개입니다.
- **결과와 한계**: 등록된 ALL은 BASE를 포함해 **122건 중 121건 통과·1건 실패**, **subtest 16건 통과**, 하위 비교 요소 **552개**입니다. ALL XML의 `tests=138`은 testcase 122개와 subtest 16개를 포함한 수치이며 하위 552개는 추가 실행 건수가 아닙니다.
- **결과와 한계**: ALL에는 직접 관측한 하위 검증이 없는 테스트 **2건**이 있습니다. 하나는 자식 프로세스 내부에서 검증하고, 다른 하나는 금지된 서비스 호출이 없으면 통과하는 방식입니다. 관측 수 0으로 구분해 상위 통과와 상세 수집 완전성을 혼동하지 않도록 했습니다.
- **결과와 한계**: API 실패는 기존 수집기가 `PREFIX = "/api/pc-consult"`를 `/PREFIX/...`로 기록하는 한계와, 상수를 해석한 실제 경로도 저장 `contracts/openapi.json`에서 찾을 수 없는 상태를 함께 보여줍니다. 수집기 본체·공통 계약을 수정하거나 기존 실패를 통과로 바꾸지는 않았습니다.
- **결과와 한계**: Excel 변환 회귀검사 6건, 실행 분류 회귀검사 5건, 하위 기록 확인 조건 4개를 검증했습니다. 자동 수집기 회귀 견본 8개는 정상 5개·의도적 실패 3개가 기대대로 기록됨을 확인했습니다. 변경 Python 파일 Ruff 검사, Excel 재열기, XML과 Excel의 상위 122개·하위 552개 정합성 확인도 통과했습니다.
- **결과와 한계**: 공유용 `config.py`는 아직 `Path("프로젝트 폴더 경로")` 안내값이며 신규 상담 테스트 8개도 미분류 상태입니다. 이번 ALL 검증은 설정·분류를 임의로 바꾸지 않고 검증용 호출에서 현재 프로젝트 경로와 등록 대상을 지정했습니다. 옵션 없는 전체 실행의 사전 검사가 통과했다는 뜻은 아닙니다.
- **결과와 한계**: 기본 규약 실행 명령은 `python -B tests/unit/run.py --test-id unit-base-common-contract-001`입니다. 일반 `pytest --junitxml=...` 직접 실행은 전용 실행기를 거치지 않으므로 Excel이 자동 생성되지 않습니다.
- **결과와 한계**: 상세 수집은 매개변수화 입력만 기록하고 fixture 전체·일반 지역변수·실제 환경변수는 수집하지 않습니다. 비밀값 관련 표현식과 비교값을 가리지만 기존 pytest 실패 traceback 전체를 제거하는 기능은 아니므로 결과 공유 전 확인이 필요합니다.
- **결과와 한계**: 이번 상세화에서 업무 테스트의 기대값·공통 계약·DB 스키마·의존성·잠금 파일은 변경하지 않았습니다. 모듈·시스템·인수 테스트는 실행하지 않았습니다.
- **산출물**: [단위 테스트 운영 안내](../../backend/tests/unit/README.md) · [실행기](../../backend/tests/unit/run.py) · [공통 경로 설정](../../backend/tests/config.py)
- **산출물**: [기본 규약 테스트](../../backend/tests/unit/contracts/test_base_contract.py) · [리포트 이름 규약](../../backend/tests/common/REPORT_NAMING.md)
- **산출물**: [하위 비교 요소와 API 진단](../../backend/tests/common/report_checks.py) · [업무 검증 자동 수집기](../../backend/tests/common/assertion_details.py) · [Excel 생성기](../../backend/tests/common/report_excel.py)
- **산출물**: 기본 규약 결과: [XML](../../backend/tests/reports/261120_jjb_unit_BASE_common-contract_001.xml) · [Excel](../../backend/tests/reports/261120_jjb_unit_BASE_common-contract_001.xlsx)
- **산출물**: 등록된 ALL 결과: [XML](../../backend/tests/reports/261120_jjb_unit_ALL_backend-suite_001.xml) · [Excel](../../backend/tests/reports/261120_jjb_unit_ALL_backend-suite_001.xlsx)
- **산출물**: 결과 파일은 Git 제외 대상이므로 다른 PC나 GitHub에는 없을 수 있습니다. 앞선 변경의 푸시는 사용자 완료 보고 기준이며 이후 ALL 자동 상세화와 작업일지는 추가 변경입니다. 이번 양식 정리에서는 커밋·푸시하지 않았습니다.
- **다음에 할 일**: 실행자의 `config.py`에 실제 저장소 루트 경로를 설정합니다.
- **다음에 할 일**: 신규 상담 테스트 8개를 담당자와 단위·모듈 단계로 분류하고 카탈로그를 정리합니다.
- **다음에 할 일**: API 수집기의 prefix 상수 해석과 저장 OpenAPI 갱신 필요 여부를 확인합니다. 계약 변경은 팀 규칙에 따라 별도 승인·PR로 진행합니다.
- **다음에 할 일**: 하위 검증 미관측 2건의 구체적인 증거 기록 방식을 검토합니다.
- **다음에 할 일**: 경로·분류 정리 후 정상 기본 명령으로 BASE + ALL을 재실행하고 후속 변경은 사용자가 검토합니다.
- **다음에 할 일**: [2주차 주간 작업일지](주차별/2주차/2주차.md) · [11월 18일 작업일지](주차별/2주차/11월18일/11월18일_작업일지.md)

## 20261123 작업개요

- 프로젝트: BUILDWISE 최종 프로젝트
- 작업자: jjb 브랜치 담당
- 작업 범위: 요구사항 상세 명세 정비, 3주차 산출물·ML 학습·RAG 저장소·어드민 선행 결정 사항 점검
- 상태: 요구사항 명세 162건 상세화와 변경 이력 기록 완료. 피드백 관련 문서·코드는 읽기 전용으로 확인했으며 학습·DB·인증 구현은 변경하지 않음
- **오늘 한 일**: `요구사항 명세서_1123`의 53개 요구사항·162개 명세를 검토하고, 같은 요구사항 안에서 반복되던 상세 동작·입력값·사전조건·처리 절차·출력값·예외 처리·검증 및 완료 기준을 명세별로 다시 작성했습니다.
- **오늘 한 일**: 상담 요청 접수, SSE 이벤트 수신, 응답 종료·실패 처리를 구분했습니다. 상담 이력·재접속·조건 변경 항목에는 이벤트 순번, 중복 적용 방지, 요구사항 버전 일치와 오래된 결과 차단 기준을 명시했습니다.
- **오늘 한 일**: 계산·검증 항목에 수치 예시와 경계 조건을 넣었습니다. 예산 초과, 가격 미확인, 소켓·규격 불일치, 전력 여유, 자료 누락을 서로 다른 결과로 구분하도록 했습니다. 예시는 검증 설계용이며 실제 실행 결과가 아닙니다.
- **오늘 한 일**: 권한·데이터 분리 항목은 타 사용자·기업의 상담과 견적을 직접 요청해도 노출·변경되지 않는 기준으로 구체화했습니다. 실제 인증이 없는 현재 흐름과 향후 로그인 필수 정책을 구분했습니다.
- **오늘 한 일**: 후행조건·업무 규칙·데이터 검증 규칙·안내 문구도 상세 동작에 맞춰 정리했습니다. 기존 `ERR-*`를 구현된 API 오류 코드로 오인하지 않도록 설계 안내와 오류 코드 미확정을 구분했습니다.
- **오늘 한 일**: 1123 시트의 기존 명세 ID, 우선순위, 구현 상태, 출처 메모와 서식을 보존하고 히스토리 시트에 변경 내용을 추가했습니다. 수정 대상 1,782개 셀의 기록 일치와 대상 밖 값의 보존을 읽기 조회로 확인했습니다.
- **오늘 한 일**: 전달받은 피드백을 WBS 사본, 산출물 제출 현황, 제출 DB 설계 문서, GitHub `dev` 코드와 대조했습니다. 이 점검에서는 해당 문서와 코드를 수정하지 않았습니다.
- **정리한 기준**: 항목: 상세 명세 · 적용·확인 기준: ID별 입력 → 처리 → 출력 → 예외 → 확인 가능한 완료 기준을 연결
- **정리한 기준**: 항목: 명세 개수 · 적용·확인 기준: 기존 53개 요구사항·162개 명세 ID 유지. 이번 작업에서 추가·삭제·재번호 부여 안 함
- **정리한 기준**: 항목: 구현 상태 · 적용·확인 기준: 문서 상세화를 구현 완료 또는 테스트 통과로 변경하지 않음
- **정리한 기준**: 항목: 미구현 영역 · 적용·확인 기준: 로그인·계정 연결·영구 이력·가상 주문 등은 목표 계약과 현행 상태를 구분
- **정리한 기준**: 항목: 비교 범위 · 적용·확인 기준: 기획 v1.2 기준 유지·업그레이드·신규 구매. 클라우드 비교는 MVP 제외 이력으로 보존
- **정리한 기준**: 항목: 결과물 · 적용·확인 기준: 브라우저 인쇄/PDF 저장과 서버 PDF 생성·영구 보관을 구분
- **정리한 기준**: 항목: 비밀값·개인정보 · 적용·확인 기준: 실제 키·암호를 기록하지 않으며 MVP 연락처 미수집 원칙 유지
- **정리한 기준**: 항목: 피드백 대응 · 적용·확인 기준: 이번에는 사실 확인만 진행. 팀 결정·DB 통합 설계·WBS 상태 수정은 후속 작업
- **결과와 한계**: #### 요구사항 상세화
- **결과와 한계**: 변경 범위는 `요구사항 명세서_1123`의 `G4:M165`, `P4:S165`와 히스토리 추가 행입니다. 162건의 입력값·처리 절차·완료 기준을 각 동작에 맞게 구분했습니다.
- **결과와 한계**: 읽기 재검증에서 수정 대상 값 불일치 0건, 대상 밖 값 변경 0건, 기존 셀 서식·유효성·출처 메모 변경 0건을 확인했습니다. 추가 이력 행은 긴 문장을 볼 수 있도록 높이를 조정했습니다.
- **결과와 한계**: Google Sheets 화면에서 상담 항목의 상세 동작·입력·출력·예외·완료 기준과 이력 표시를 확인했습니다. 이는 문서 정합성 확인이며 기능 실행 검증이 아닙니다.
- **결과와 한계**: #### 피드백 점검
- **결과와 한계**: 점검 항목: WBS 1.7 전처리 · 확인 내용: 본표 100%, 근거 시트는 정규화 자료 존재·정식 결과서 완료 미확인 · 남은 사항: 결과서 파일과 제출 근거 확인
- **결과와 한계**: 점검 항목: WBS 1.8 의도 분류·조건 추출 학습 · 확인 내용: 본표 100%, 근거 시트는 학습 모델·학습결과서 완료 근거 미확인 · 남은 사항: 담당자의 학습 실행·평가 기록·저장 모델 위치 확인
- **결과와 한계**: 점검 항목: 3주차 산출물 · 확인 내용: 제출 관리표 6팀 15~17행의 전처리 결과서·ML/DL 학습결과서·학습 모델 링크/날짜/상태 비어 있음 · 남은 사항: 11/26 마감 전 산출물 묶음과 제출 상태 확인
- **결과와 한계**: 점검 항목: RAG 저장소 · 확인 내용: 코드상 로컬 Qdrant, 기본 경로 `backend/.cache/qdrant`, 컬렉션 `buildwise_rag`, dense 384차원·lexical sparse · 남은 사항: 제출 DB 설계 문서에 저장 구조·경로·보관 정책 통합 필요
- **결과와 한계**: 점검 항목: 고객·직원 계정 · 확인 내용: 판매자 화면 초안에 관리자·상담원 역할 존재. 현재 `users`는 사용자 식별 중심 · 남은 사항: 기업·직원·역할·고객의 테이블 관계와 서버 권한 구조 확정 필요
- **결과와 한계**: 점검 항목: 로그인 · 확인 내용: 초안에 아이디·비밀번호와 기업 가입 인증번호 제안 존재. 현행 `App.tsx`는 account 로컬 상태 전환 · 남은 사항: 인증/세션 방식·계정 연결·팀 승인 기록 필요
- **결과와 한계**: 점검 항목: 어드민 앱 위치 · 확인 내용: 현행 동일 프론트 앱에서 `SellerWorkspace`로 분기 · 남은 사항: 현재 배치를 최종 구조로 채택했는지 팀 확정 필요
- **결과와 한계**: 피드백의 핵심은 타당하지만, 학습 진행이 “어디에도 기록되지 않음”보다는 **WBS 완료율과 완료 증거의 불일치**, 어드민은 “아무 초안도 없음”보다는 **초안과 팀 확정·DB 반영 사이의 공백**으로 구분했습니다.
- **결과와 한계**: 공개 사전학습 임베딩 모델의 사용을 팀이 학습한 의도 분류 ML/DL 모델의 완료 근거로 보지 않았습니다.
- **결과와 한계**: 코드 점검 기준 `dev`는 `59ad3886a828eadf5f465472f5b69b35c5c96e04`입니다. 다른 작업 브랜치의 파일 목록도 일부 확인했으나 팀원 PC의 미공유 학습 기록까지 없다고 단정하지 않습니다.
- **결과와 한계**: 로컬/운영 Qdrant의 실제 색인·건수·접속, 실제 DB 재조회, 학습 실행, pytest·모듈·E2E 테스트는 **안 돌림**입니다. 이번 작업은 문서 상세화 및 읽기 전용 근거 점검입니다.
- **결과와 한계**: 애플리케이션 코드, 공통 계약, DB 스키마, 의존성, 잠금 파일, 공유 설정은 변경하지 않았습니다. 커밋·푸시 및 GitHub 쓰기 작업도 진행하지 않았습니다.
- **산출물·확인 근거**: [요구사항 명세서 — 1123 상세화](https://docs.google.com/spreadsheets/d/1CckXtugCuEW0oPjT4k43ELGRguaB7J5PL5Uc0KMAMRk/edit#gid=261123002)
- **산출물·확인 근거**: [요구사항 변경 히스토리](https://docs.google.com/spreadsheets/d/1CckXtugCuEW0oPjT4k43ELGRguaB7J5PL5Uc0KMAMRk/edit#gid=261123003)
- **산출물·확인 근거**: [WBS 사본 — 진행현황 근거](https://docs.google.com/spreadsheets/d/11mTGJY05u3K50HTMq5AUEmcRXjo9uSfV4kG27iS8DSw/edit#gid=20261123) — 읽기 점검만 진행
- **산출물·확인 근거**: [산출물 관리표 — 6팀](https://docs.google.com/spreadsheets/d/1XycOasdw6ue1Dy3aVHL5EFyZ683UhPKoYTCrERFj6P0/edit#gid=1069498873) — 읽기 점검만 진행
- **산출물·확인 근거**: [제출 DB/저장소 설계 문서](https://docs.google.com/document/d/1EdEg8pX5mmsTFxVU7PxED2B1-Q1gul6JGshGQyN5oeM/edit) — 읽기 점검만 진행
- **산출물·확인 근거**: 코드 근거: [RAG 저장 경로](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN35-FINAL-6TEAM/blob/59ad3886a828eadf5f465472f5b69b35c5c96e04/backend/app/rag/__main__.py) · [Qdrant 컬렉션](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN35-FINAL-6TEAM/blob/59ad3886a828eadf5f465472f5b69b35c5c96e04/backend/app/rag/qdrant_store.py) · [임베딩 모델](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN35-FINAL-6TEAM/blob/59ad3886a828eadf5f465472f5b69b35c5c96e04/backend/app/rag/embeddings.py) · [개인/기업 화면 분기](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN35-FINAL-6TEAM/blob/59ad3886a828eadf5f465472f5b69b35c5c96e04/frontend/src/app/App.tsx)
- **산출물·확인 근거**: [판매자 관리 화면 초안](../설계/2026-11-18/판매자_관리화면_정리.md) — 확정 여부와 구현 상태는 별도
- **다음에 할 일**: 담당자와 WBS 1.7·1.8의 100% 근거를 확인합니다. 전처리 결과서, 학습 데이터 분할·라벨·실행 설정·평가 지표, 학습 모델과 재현 방법의 위치를 확인합니다.
- **다음에 할 일**: 11/26 제출 산출물 3종을 묶고, 산출물 관리표의 링크·수정일·상태를 실제 증거에 맞춰 갱신합니다. 아직 갱신하지 않았습니다.
- **다음에 할 일**: 고객/직원 계정 구조, 인증/세션 방식, 어드민 배치를 팀에서 확정하고 관련 요구사항 ID·권한·DB 관계를 연결합니다. 이번 점검에서 임의 결정하지 않았습니다.
- **다음에 할 일**: RDB와 Qdrant를 함께 설명하는 저장소 설계를 정리하고 기본 경로·컬렉션·임베딩 버전·기업별 검색 범위·운영 보관 정책을 반영합니다.
- **다음에 할 일**: 중간발표 자료 제출(11/24 17:00)과 발표(11/26)에서 문서 목표·현행 구현·실제 실행 검증을 구분해 설명합니다.
- **다음에 할 일**: [3주차 주간 작업일지](주차별/3주차/3주차.md)

## 20261124 작업개요

- 작업자: jjb 브랜치 담당
- 작업 범위: dev 반영, 테스트 리포트 양식, API 수집기, 테스트 단계 분류, 현재 DB·RAG 개수 기록, 작업일지 통일
- **진행 내용**: 원격 dev 내용을 로컬 jjb에 병합한 뒤 원격 jjb로 푸시했다. 푸시된 마지막 커밋은 `5e793d7`이며, 이후 테스트·문서 수정은 별도 미커밋 작업이다.
- **진행 내용**: Excel의 `검증 요소 상세`에서 하위 ID별 결과를 Pass / Fail / Blocked로 표시하고 `비교 결과`는 공백으로 변경했다. XML의 판정과 기존 실패 내용은 유지했다.
- **진행 내용**: API 정적 수집기가 문자열 상수 `PREFIX`의 실제 경로를 해석하도록 보정했다. 기존 `openapi.json`과 PC 상담용 `pc-consult.openapi.json`을 함께 비교하고, PC 상담 스키마 키는 별도 구분했다. 서비스 API와 계약 원본, 기준 인벤토리는 변경하지 않았다.
- **진행 내용**: 미분류 테스트 9개를 ALL 6개(장착 사양·냉각/장착/메모리/전력 문서·PC 상담 API), 모듈 3개(상담 AI·부품 DB 어댑터·상담 서비스)로 등록했다. 테스트 원본은 이동하지 않았다.
- **진행 내용**: `storage-counts` 모듈을 추가했다. 과거 개수와 비교하지 않고 현재 DB의 테이블·컬럼·행 수, 부품 분류·호환성 유형·이미지·전력값 건수와 RAG 배포본의 청크·출처 수를 기록한다. 기준 스냅샷은 생성하지 않는다.
- **진행 내용**: 현재값 기록이 공통 자동 수집에 덮어써지지 않도록 기존 모듈 상세 기록 경로를 사용하고, 관측용 검사 설명과 콘솔 표시를 지원했다.
- **진행 내용**: `jjb_daily.md`에 본인 작업을 날짜별 Markdown으로 통일했다. 기존 11월 20일·23일 일지는 과거 보관본으로 유지한다.
- **수정 파일**: [리포트 Excel 생성기](../../backend/tests/common/report_excel.py)
- **수정 파일**: [API·코드 수집기](../../backend/tests/unit/discover.py)
- **수정 파일**: [단위 실행 목록](../../backend/tests/unit/catalog.json) · [단위 README](../../backend/tests/unit/README.md)
- **수정 파일**: [현재 개수 기록 검사](../../backend/tests/module/test_storage_counts.py)
- **수정 파일**: [모듈 실행 목록](../../backend/tests/module/catalog.json) · [모듈 상세 기록](../../backend/tests/module/flow_report.py) · [모듈 README](../../backend/tests/module/README.md)
- **수정 파일**: 자동 갱신: `backend/tests/unit/inventory.json`, `backend/tests/reports/`의 XML·Excel·현재값 JSON
- **수정 파일**: 작업일지: 본 문서, 보관 규칙 README, 2·3주차 요약의 본인 일지 링크
- **실제 실행 결과**: 검사: 기본 규약 · 실행 명령: `python -B backend/tests/run_base.py` · 결과: 최종 9 passed, API Breaking 0
- **실제 실행 결과**: 검사: 등록된 ALL · 실행 명령: `python -B backend/tests/unit/run_all.py` · 결과: 최종 168 passed, 16 subtests passed; 미분류 경고 해소
- **실제 실행 결과**: 검사: 추가 모듈 3개 · 실행 명령: `python -B backend/tests/module/run.py --test-id consultation-advisor --test-id consultation-parts-db --test-id consultation-service` · 결과: 36 passed; 외부 AI·실제 DB 호출 대체
- **실제 실행 결과**: 검사: 기존 연결+현재 집계 · 실행 명령: `python -B backend/tests/module/run.py --test-id storage-counts --test-id value-flow --with-db` · 결과: 12 passed
- **실제 실행 결과**: 검사: 현재 집계 최종 확인 · 실행 명령: `python -B backend/tests/module/run.py --test-id storage-counts --with-db` · 결과: 2 passed; DB 33개·RAG 75개 집계 항목 기록
- **실제 실행 결과**: 검사: 정적 검사 · 실행 명령: 프로젝트 Python의 `ruff check --no-cache` 및 포맷 검사 · 결과: 수정 Python 파일 통과
- **실제 실행 결과**: 모듈 전체를 이번 작업에서 재실행한 것은 아니다. 위 모듈 결과는 선택한 검사 범위다. 기존 라이브러리의 LangSmith DeprecationWarning 17건이 있었다.
- **현재 조회값**: 항목: DB 기본 테이블 · 관측값: 8개
- **현재 조회값**: 항목: 부품 · 관측값: 9,917개
- **현재 조회값**: 항목: 호환성 전체 · 관측값: 23,102건
- **현재 조회값**: 항목: CPU 지원 · 관측값: 22,711건
- **현재 조회값**: 항목: RAM QVL · 관측값: 391건
- **현재 조회값**: 항목: 실제 이미지 URL · 관측값: 9,025개
- **현재 조회값**: 항목: 기본 이미지 URL · 관측값: 892개
- **현재 조회값**: 항목: 전력값 보유 / NULL · 관측값: 9,351개 / 566개
- **현재 조회값**: 항목: RAG 배포 청크 / 등록 출처 / 실제 인용 출처 · 관측값: 85개 / 102개 / 64개
- **현재 조회값**: 항목: RAG 팩트 / 크롤링 기록 / 청크 연결 · 관측값: 50개 / 166개 / 138개
- **현재 조회값**: 항목: 상담용 제조사 추가 문단 · 관측값: 10개
- **현재 조회값**: 항목: 합친 색인 입력 / 고유 ID · 관측값: 95개 / 95개
- **현재 조회값**: 위 RAG 숫자는 배포 자료·색인 입력 집계이며 저장된 Qdrant Point나 실제 생성된 벡터를 측정한 결과가 아니다. DB 집계는 여러 SELECT의 조회 시점 값이며 동시 변경에 대한 단일 시점 스냅샷을 보장하지 않는다. 이미지 URL은 저장값 기준으로 분류했으며 실제 URL 접근은 검사하지 않았다. 과거 일지의 숫자는 기대값으로 사용하지 않았다.
- **결과 파일·후속 사항**: [기본 규약 XML](../../backend/tests/reports/261124_jjb_unit_BASE_common-contract_001.xml) · [Excel](../../backend/tests/reports/261124_jjb_unit_BASE_common-contract_001.xlsx)
- **결과 파일·후속 사항**: [ALL XML](../../backend/tests/reports/261124_jjb_unit_ALL_backend-suite_001.xml) · [Excel](../../backend/tests/reports/261124_jjb_unit_ALL_backend-suite_001.xlsx)
- **결과 파일·후속 사항**: [모듈 XML](../../backend/tests/reports/261124_jjb_module_ALL_value-flow-suite_001.xml) · [Excel](../../backend/tests/reports/261124_jjb_module_ALL_value-flow-suite_001.xlsx)
- **결과 파일·후속 사항**: 현재 실행기는 날짜·유형·대상 이름이 같으면 XML·Excel을 갱신한다. 현재 모듈 리포트는 마지막 `storage-counts` 2건의 결과다. 과거 선택 실행 전체의 결과가 한 파일에 누적된 것은 아니다.
- **결과 파일·후속 사항**: `*_counts.json`은 조회 시각별로 별도 보관한다. 리포트는 Git 제외 대상이므로 다른 PC에는 없을 수 있다.
- **결과 파일·후속 사항**: 실제 DB는 SELECT·rollback만 사용했다. 서비스 코드·DB 스키마·계약 원본·`.env`는 변경하지 않았다.
- **결과 파일·후속 사항**: `5e793d7` 푸시 이후 변경 사항은 커밋·푸시하지 않았다.

- **17시 중간발표 QA 근거(사용자 공유 자료 기준)**: [jjb 모듈 테스트 결과](https://drive.google.com/file/d/1xaQSujhZJ8TNpC_RBUxGSVYmqLdcBID3/view)는 14/14 통과. 모의 데이터 흐름 10건과 설정된 DB 검증 4건이며 저장값 재조회·롤백을 포함한다. 브라우저 E2E 및 발표 빌드 검증 결과는 아니다. 이후 로컬 선택 실행으로 덮어써진 리포트와 구분해 이 공유 링크를 발표 근거로 사용한다.
- **별도 CI 상태(사용자 공유 시점)**: [GitHub Actions 실행 45295471882](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN35-FINAL-6TEAM/actions/runs/45295471882)는 실패 상태로 공유됐다. Windows는 API 계약 검사 1건에서 경로 12개를 누락으로 표시했으며, 공유 내용에 따르면 해당 경로는 PC 상담용 OpenAPI 명세에 존재한다. 실제 API 호출 확인 결과가 아니므로 엔드포인트 장애로 단정하지 않고 경로 접두사 해석과 비교 대상 명세 선택을 우선 확인한다. Linux는 별도 import 정렬 검사에서 중단됐다.
- **로컬 검증과 CI 구분**: 오늘 로컬 수집기 보정 후 기본 규약 9건과 등록된 ALL 168건이 통과한 사실은 위 CI 실행의 통과를 뜻하지 않는다. 수집기 보정 변경의 원격 반영·CI 재실행 및 Linux import 정렬 해결은 이 기록에서 완료로 표시하지 않는다. 이번 일지 추가에서는 외부 링크 재조회·CI 재실행·발표 자료 수정을 수행하지 않았다.

- **모듈 단계별 출력 개선**: `value-flow` 결과를 상담→검색 / 검색→설계 / 설계→검증 / 검증→견적으로, `consultation-advisor` 결과를 검색 근거→AI 요청 / AI 요청→답변·출처 처리로 구분해 콘솔·XML·Excel에 표시했다. 기존 예외·입력 검증은 유지한다.
- **실제 검증 범위**: 검색 노드 출력을 설계 입력 상태에 연결해 검색 결과·출처의 보존과 설계 선택값을 확인했다. 설계가 검색 근거를 직접 소비하는 검사는 아니다. 상담 AI의 요청 모델·근거 ID/본문·질문·구조화 출력·저장 설정과 반환 답변·응답 ID·출처·검색 방식을 기록했으며 실제 외부 AI는 Mock으로 대체했다. AI 단계별 명시적 기록은 기존 정상 경계 사례에 추가했고 나머지 상담 AI 테스트의 자동 검증은 유지했다.
- **실행 결과**: `python -B backend/tests/module/run.py --test-id value-flow --test-id consultation-advisor`에서 32 passed. 여섯 단계 모두 Pass이며 하위 비교 수는 차례로 26·17·6·13·6·5개다. 별도 회귀 견본으로 단계별 Pass/Fail/Blocked와 앞 단계 결과 보존을 확인했다. 수정 Python 파일 Ruff 검사도 통과했다.
- **수정 파일**: `backend/tests/module/test_value_flow.py`, `backend/tests/hardware_workflow/test_consultation_advisor.py`, `backend/tests/module/flow_report.py`, `backend/tests/module/catalog.json`, `backend/tests/module/README.md`, 본 일지. 서비스 코드·DB·공통 계약·.env·공통 리포트 생성기는 수정하지 않았다. 현재 모듈 XML·Excel은 위 두 묶음 32건으로 갱신됐으며 앞선 개수 기록 2건 리포트를 대체한다. 커밋·푸시는 하지 않았다.

- **전체 모듈 단계별 출력**: 나머지 db-flow·graph·qdrant·mysql·부품 DB 어댑터·상담 서비스·현재 개수 기록에도 단계 목록과 실제 비교값을 연결했다. 모든 9개 모듈을 콘솔·XML·Excel에서 단계별로 구분한다. 기존 오류·입력 검증은 유지하고, 임시/인메모리 Qdrant·가상 벡터·실제 DB 사용 범위를 구분했다.
- **Happy/Negative 구분**: 정상 흐름과 실패 조건 사례를 별도 표시했다. 실패 조건을 예상대로 거부하면 Negative case도 Pass이며 거부하지 못하면 Fail이다. 기존 Negative 테스트의 함수 단위 단계 분류와 원래 assertion 근거는 구분·보존한다. 현재 개수 기록은 관측으로 유지하며 미구성 사례를 실행한 것처럼 추가하지 않는다.
- **db-flow 보완**: 정상 3건과 Negative 2건으로 구성했다. 기존 없는 부품 PK 검사에 더해, 없는 사용자 FK의 상담 INSERT가 IntegrityError 1452로 거부되고 재조회·롤백 후 해당 상담이 남지 않는 사례를 추가했다. 접속 오류를 정상적인 FK 거부로 처리하지 않는다.
- **실행 결과(최종)**: `python -B backend/tests/module/run_all.py`에서 79 passed, 2 skipped, 1 deselected. 실제 DB 검사를 포함했고 모든 테스트 DML은 rollback했다. 모델 캐시가 없어 실제 토큰·임베딩 검색 2건은 Blocked이며 대량 재적재 1건은 기존 정책대로 제외했다. 외부 AI·모델 다운로드·운영 Qdrant 색인 변경은 수행하지 않았다. 라이브러리 경고는 17건이다.
- **출력 검증**: 동일 이름 연결의 하위 비교 중복 합산 방지, 미실행 단계의 XML·Excel Blocked 표시, JUnit testcase/실패 건수 보존, Negative 기대 동작 불충족 시 Fail 유지 회귀 검증을 통과했다. 실행한 81 testcase는 Pass 79·Blocked 2이며 제외한 1건은 testcase로 추가하지 않았다. 수정 Python 파일 Ruff 검사도 통과했다.
- **수정 파일**: `backend/tests/module/flow_report.py`, `run.py`, `catalog.json`, `db_flow.py`, `test_storage_counts.py`, `README.md`; `backend/tests/hardware_workflow/test_graph.py`, `test_consultation_parts_db.py`, `test_consultation_service.py`; `backend/tests/rag/test_qdrant.py`; `backend/tests/hardware_data/test_mysql.py`; 본 일지. 서비스 코드·공통 계약·DB 스키마·.env는 수정하지 않았다. 최신 모듈 XML·Excel은 모듈 전체 결과로 갱신했으며 커밋·푸시는 하지 않았다.

- **모듈 분류 체계 정리**: 모듈 9개를 대분류, 등록된 연결 단계 33개를 중분류로 정리했다. 하위는 Happy/Negative 사례 유형과 개별 검증 항목으로 구분하며, 결과 Pass/Fail/Blocked는 사례 유형과 별도다. 현재 개수 기록은 관측으로 유지했다. module README를 실행 목록과 대조해 갱신했으며 실행 코드·테스트 판정·기존 결과는 변경하지 않았다. 문서 수정이므로 테스트는 재실행하지 않았다.

- **DB 제외 테스트 분류 최신화**: 단위는 한 함수·공개 컴포넌트의 결과, 모듈은 구성요소 사이 전달·연결로 기준을 정리했다. Mock 유무만으로 분류하지 않는다. 명확한 비DB 연결 검사인 `test_fit_specs.py` 4건을 ALL에서 모듈 `hardware-fit-specs`로 등록 변경했으며 원본 파일·기대값은 유지했다. 중분류는 보강 사양→호환성 판정, 충돌 사양→보강 거부다. 현재 모듈 등록은 10개·35단계다.
- **보존 범위**: API는 기존 요청대로 ALL에 유지했다. db-flow·mysql·consultation-parts-db·storage-counts 등록 내용과 관련 테스트 파일은 변경하지 않았다. DB가 섞인 어댑터·매핑·견적 저장 파일의 세부 분리도 보류했다. 실제 DB 접속·DB 스키마·.env·서비스 코드·공통 계약 변경은 수행하지 않았다.
- **검증**: `python -B backend/tests/unit/run_all.py`에서 164 passed, 16 subtests passed. 모듈 선택 실행(value-flow·graph·qdrant·consultation-advisor·hardware-fit-specs)에서 57 passed, 모델 캐시 부재 2 skipped/Blocked. 등록 누락·중복이 없고 이동한 4건이 모듈에서 실행됐음을 XML로 확인했다. 이번 실제 DB 검사는 안 돌림이며 전체 모듈 재검증 결과로 표시하지 않는다.
- **수정 파일·결과**: `backend/tests/README.md` 추가, `unit/catalog.json`, `unit/README.md`, `module/catalog.json`, `module/README.md`, 본 일지 갱신. 자동 생성 inventory.json 및 ALL·모듈 XML/Excel도 갱신했다. 최신 모듈 리포트는 위 비DB 선택 실행 59건(57 Pass·2 Blocked)으로 이전 전체 모듈 결과를 대체했다. 커밋·푸시는 하지 않았다.

- **기본규약·ALL·모듈 전체 재실행 및 리포트 업로드**: 사용자 요청으로 `python -B backend/tests/run_base.py`, `python -B backend/tests/unit/run_all.py`, `python -B backend/tests/module/run_all.py`를 프로젝트 Python 3.14로 실행했다. 기본규약 9 passed, ALL 164 passed·16 subtests passed, 모듈 83 passed·2 skipped·1 deselected다. 모듈의 실제 DB 저장·조회·제약 검사는 기존 롤백 방식으로 실행했고, 실제 임베딩 모델 캐시 부재 2건은 Blocked, 대량 재적재 1건은 범위 밖이다. 각 실행에 LangSmith 라이브러리 경고 17건이 있었다.
- **리포트 3건 업로드 완료**: [기본규약 Excel](https://docs.google.com/spreadsheets/d/1KMg-W4UheHRoTpEvvQ-qj599jIJMPf6Q/edit?usp=drivesdk&ouid=114097713052321425690&rtpof=true&sd=true), [ALL Excel](https://docs.google.com/spreadsheets/d/102QiaySbfuRlE0Yz8fIyvq9C-JEs6STr/edit?usp=drivesdk&ouid=114097713052321425690&rtpof=true&sd=true), [모듈 Excel](https://docs.google.com/spreadsheets/d/1aTkuVzPJXHJ1Hjjsf75eSSotqMtKlsTh/edit?usp=drivesdk&ouid=114097713052321425690&rtpof=true&sd=true)을 지정한 [26.11.24 Drive 폴더](https://drive.google.com/drive/folders/1Ieoq5gAe4sfc9sAsD2xUVzhZuf_FIth7)에 업로드하고 메타데이터로 파일명·크기·부모 폴더를 재확인했다. XML 원본은 로컬 reports에 유지했다. 최신 모듈 리포트는 선택 실행이 아닌 등록된 10개 모듈 전체 결과다.
- **이번 실행의 변경 범위**: 자동 생성 inventory.json·reports 결과와 본 일지 갱신. 서비스·테스트 로직·공통 계약·DB 스키마·.env 변경, 커밋·푸시·원격 CI 실행은 하지 않았다.

- **최신 dev 반영**: 사용자 요청으로 원격을 fetch했다. dev 최신은 `97eae9b`이며, 원격 jjb에는 이미 해당 dev를 합친 `1455fcf`(PR #51)가 있었다. 두 원격의 파일 트리는 같아 로컬 jjb를 origin/jjb의 `1455fcf`로 fast-forward하여 최신 dev와 원격 jjb를 함께 반영했다. 새 병합 커밋 생성·푸시는 하지 않았다.
- **로컬 작업 보존**: 미커밋 추적·미추적 변경을 stash `89e30f77690da6b32eb6b379facd8494e9ee8627`에 보관한 뒤 복원했다. 복원 파일 25개의 내용·삭제 상태를 대조했고 겹친 2주차 일지는 자동 병합되어 새 내용과 jjb_daily 링크가 모두 유지됐다. 충돌은 없었다. .env 및 tests/config.py의 병합 전후 SHA-256이 동일했다. 복구용 stash는 남겨두었으며 이미 복원한 상태이므로 중복 적용하지 않는다.
- **병합 후 검사**: 기본규약 9 passed, 환경·API Breaking 0. `backend`에서 프로젝트 Python으로 `-B -m pytest tests/rag/test_routing.py tests/rag/test_qdrant.py -q -p no:cacheprovider`를 실행해 7 passed·2 skipped(모델 캐시 부재)를 확인했다. 이번 병합 후 ALL·모듈 전체·프론트·E2E·원격 CI는 안 돌림이다. 새 RAG 테스트 6개는 들어왔으나 실행 목록 재분류는 임의로 하지 않았다.
- **병합 후 결과 범위**: 최신 dev는 음성 UI·RAG 코드를 포함한다. 로컬 테스트·문서 수정은 복원된 미커밋 상태다. 기본규약 XML·Excel과 inventory는 병합 후 갱신됐지만 Drive의 기존 3건 리포트는 앞선 업로드 시점 자료이며 이번 병합 후 전체 결과로 해석하지 않는다.

- **jjb 커밋·푸시 준비(사용자 요청)**: 저장소 규칙의 한국어 한 줄 메시지에 맞춰 `단위·모듈 테스트 분류와 단계별 검증 리포트 개선`으로 변경사항을 커밋해 jjb로 푸시하는 절차를 진행했다. .env·로컬 config.py·reports·자동 생성 inventory.json은 커밋 대상에서 제외했다. 원격 jjb와 로컬 HEAD가 동일한 상태에서 변경을 준비했다.
- **커밋 전 필수 검사**: 기존 프로젝트 Python으로 백엔드 lint 통과, format 1개 지적을 테스트 수집기 assertion_details.py의 서식만 정리해 재검사 통과했다(AST 동일 확인). 전체 pytest는 260 passed·9 skipped·16 subtests passed로 DB 선택 검사와 모델 캐시 부재는 skip이다. 프론트 lint·Prettier·tsc·vitest·vite build가 모두 통과했고 vitest는 306 tests·33 files passed다. 빌드의 큰 번들 안내와 기존 LangSmith 경고는 남아 있다.
- **잔여 범위**: 최신 dev의 test_domain_finetune·test_dual_adapter_dpr·test_korquad·test_local_dpr·test_routing·test_training 6개는 ALL 카탈로그에 아직 미분류다. 이번 전체 pytest에는 포함됐지만 전용 ALL 실행기는 범위 미완료를 보고할 수 있다. 신규 6개 분류·모델 캐시 설치·대량 재적재·원격 CI 재실행은 이번 푸시 작업의 완료 항목으로 표시하지 않는다.


- **사용자·브랜치 간 검증 환경 통일**: 공유 인벤토리 기준의 projectRoot 절대 경로 일치 조건을 제거했다. 다른 PC/체크아웃에서도 동일한 승인 기준을 사용하며, 기준 파일이 없거나 contracts가 없는 구버전이면 자동 초기화·보정하지 않고 중단한다. 기준 승인값은 변경하지 않았다. 기본 규약을 pytest로 직접 실행할 때도 현재 코드의 인벤토리를 세션 시작 시 갱신한다.
- **공통 실행 조건**: 단위·모듈 모두 Python 3.14 및 pyproject의 직접 고정 의존성 버전을 사전 검사한다. 실행기 폴더와 PROJECT_PATH가 다르면 중단한다. 개인 PYTEST_ADDOPTS·PYTEST_PLUGINS·PYTHONPATH, 자동 pytest 플러그인 로딩과 외부 DB 실행 플래그로 검증 범위가 달라지지 않도록 설정한다. 모듈의 기존 --with-db/--full-db 선택과 run_all의 DB 포함 정책은 유지했다. 각자 명시적 경로 설정을 유지하는 config.example.py와 공통 안내를 추가했다.
- **환경 비교 증빙**: XML·Excel 요약과 같은 이름의 context.json에 검증 서명과 상세 조건을 기록한다. Python 전체 버전/OS/설치 패키지 전체/백엔드 코드·계약·테스트/카탈로그/기준/lock/공유 data 파일 45건 해시 및 실행 옵션을 비교한다. 설치 경로·실행 시각·리포트 파일명·텍스트 줄바꿈을 비교에서 제외했다. DB 실데이터·외부 API·로컬 모델 캐시의 동일성은 이 서명만으로 보장하지 않는다.
- **누락 실행 목록 등록**: 최신 dev의 RAG 6개 원본은 수정하지 않고 local_dpr·dual_adapter_dpr·korquad를 단위 ALL에, domain_finetune·routing·training을 모듈에 등록했다. 단위 실행 그룹 20개, 모듈 13개이며 새 RAG 연결 단계 8개를 표시한다. 검증 환경 회귀 검사 8건을 단위 ALL에 추가했다.
- **최종 실행 결과**: 프로젝트 Python으로 `python -B backend/tests/run_base.py`, `python -B backend/tests/unit/run_all.py`, `python -B backend/tests/module/run_all.py` 실행. 기본 규약 **9 passed**, 단위 ALL **185 passed·16 subtests passed**, 모듈 **94 passed·2 skipped·1 deselected**. 환경/API Breaking 0, 미분류로 인한 실패 없음. 모델 캐시 부재 2건은 Blocked이고 대량 DB 재적재 1건은 기존 정책으로 제외했다. 각 실행에 기존 LangSmith DeprecationWarning 17건이 남아 있다. `ruff check backend/tests --no-cache`, `ruff format backend/tests --check` 통과(58파일).
- **산출물 확인**: 로컬 reports의 기본규약·ALL·모듈 XML, Excel, context.json 3세트를 생성하고 XML property/Excel 요약/JSON의 서명 일치와 XLSX 내부 XML 구조를 확인했다. 세 실행의 코드·기준·데이터·의존성 해시는 같고 선택 테스트·DB 실행 옵션은 의도적으로 다르다. Drive에 기존 업로드된 리포트는 이번 최종 결과로 교체하지 않았다.
- **수정/추가 파일**: `backend/tests/common/runtime.py`, `common/verification_context.py`(신규), `common/report_excel.py`, `unit/run.py`, `unit/discover.py`, `unit/contracts/conftest.py`(신규), `unit/harness/test_environment_consistency.py`(신규), `unit/catalog.json`, `module/run.py`, `module/catalog.json`, `config.example.py`(신규), `README.md`, `unit/README.md`, `module/README.md` 및 본 `docs/작업일지/jjb_daily.md`. inventory.json·reports는 실행 산출물이다.
- **적용 범위와 잔여 사항**: 로컬 jjb에서 검증했다. 다른 PC·브랜치의 실제 실행은 안 돌림이며 동일한 테스트 도구 변경과 승인 기준·lock을 반영한 뒤 각자 config 경로를 지정해야 한다. 서비스 코드·공통 계약·DB 스키마·DB 테스트 본문·의존성/lock·.env·기존 로컬 config.py는 변경하지 않았다. 이번 작업의 커밋·푸시는 하지 않았다.

- **후속 jjb 공유 요청**: 사용자의 푸시 요청에 따라 원격 jjb와 로컬 기준이 동일함을 확인했다. `사용자·브랜치 간 테스트 검증 환경 통일` 메시지로 위 테스트 도구·안내·일지 15개 파일을 커밋·푸시 대상으로 확정했다. .env·개인 config.py·자동 inventory.json·reports는 제외한다. 서비스·계약·DB·의존성 변경은 없다.


### 검증 환경 통일 및 리포트 공유 최종 업데이트

- **오늘 작업 요약**: 단위·모듈 분류와 단계별 검증 리포트를 정리하고, 사용자·브랜치 간 동일한 검증 기준을 사용하도록 실행기를 통일했다. Python·직접 고정 의존성 검사, 실행기와 PROJECT_PATH 일치 검사, 개인 pytest 설정 배제, 공유 기준 파일 자동 초기화 방지, 직접 pytest 실행 시 현재 인벤토리 갱신을 적용했다.
- **실행 범위 보완**: dev에서 추가된 RAG 테스트 6개를 단위/모듈 실행 목록에 등록했고, 검증 환경 일관성 회귀 검사 8건을 추가했다. 원본 RAG 테스트·DB 테스트 본문은 수정하지 않았다. 단위 20개 그룹, 모듈 13개 그룹을 대상으로 한다.
- **최종 검증 결과**: 기본 규약 **9 Pass**, 단위 ALL **185 Pass + 하위 subtest 16 Pass**, 모듈 **94 Pass·2 Blocked·1 범위 제외**. 모듈 Blocked는 실제 임베딩 모델 캐시 부재 2건이며, 대량 DB 재적재 1건은 기존 기본 실행 범위에서 제외했다. 단위 ALL XML의 tests=201은 185건과 하위 subtest 16건을 포함한 집계이므로 서로 다른 테스트 수로 중복 합산하지 않는다. 모듈 XML은 tests=96 중 skipped=2이다. 환경/API Breaking 0이며 lint·format도 통과했다.
- **실행 명령**: 프로젝트 Python 3.14로 `python -B backend/tests/run_base.py`, `python -B backend/tests/unit/run_all.py`, `python -B backend/tests/module/run_all.py`. 실제 DB 검사는 기존 롤백 방식으로 진행했다. 이번 업로드 요청에서는 테스트를 다시 실행하지 않고 위 최종 실행 산출물을 재검증해 업로드했다.
- **검증 조건 증빙**: XML·Excel·context.json의 환경 서명이 일치하는지 확인했다. 기본규약·ALL·모듈 사이의 코드·기준·데이터·의존성 해시는 같으며 선택 테스트/DB 옵션은 의도적으로 다르다. 다른 PC·브랜치에서 동일하게 실행했는지는 아직 확인하지 않았다. 실제 DB 데이터·외부 API·모델 캐시는 별도로 준비해야 한다.
- **커밋·푸시 완료**: `74080d6` — 단위·모듈 테스트 분류와 단계별 검증 리포트 개선. `f874338f7c015b54cbba5c3598a37edf5b3a819f` — 사용자·브랜치 간 테스트 검증 환경 통일. 후속 커밋은 15개 파일이며 origin/jjb와 로컬 HEAD 일치를 확인했다. .env·개인 config.py·자동 inventory.json·reports는 커밋에서 제외했다. 앞선 '푸시 준비/미실행' 기록은 당시 상태이며 이 항목이 최종 완료 상태다.
- **Drive 최신 결과 반영 완료**: [26.11.24 검증 폴더](https://drive.google.com/drive/folders/1Ieoq5gAe4sfc9sAsD2xUVzhZuf_FIth7)의 기존 최신 Excel 3건을 아래 최종 결과로 교체해 기존 파일 ID와 링크를 유지했다. 폴더 내 더 이른 시점의 다른 파일은 삭제하지 않았다.
  - [기본 규약 Excel](https://docs.google.com/spreadsheets/d/1KMg-W4UheHRoTpEvvQ-qj599jIJMPf6Q/edit): `261124_jjb_unit_BASE_common-contract_001.xlsx`, 16,407 bytes.
  - [단위 ALL Excel](https://docs.google.com/spreadsheets/d/102QiaySbfuRlE0Yz8fIyvq9C-JEs6STr/edit): `261124_jjb_unit_ALL_backend-suite_001.xlsx`, 115,693 bytes.
  - [모듈 Excel](https://docs.google.com/spreadsheets/d/1aTkuVzPJXHJ1Hjjsf75eSSotqMtKlsTh/edit): `261124_jjb_module_ALL_value-flow-suite_001.xlsx`, 112,686 bytes.
  - [검증 원본 ZIP](https://drive.google.com/file/d/1HLjRhXs580EnZMjpqWCPItUHHyiZ4EwE/view?usp=drivesdk): `261124_jjb_검증원본_f874338.zip`, 156,837 bytes. 기본규약·ALL·모듈 각각 XML과 context.json을 포함한 총 6개 파일이다.
- **업로드 확인**: 로컬 XLSX 내부 XML·ZIP 무결성 및 환경 서명을 확인했고, 업로드 후 Drive 메타데이터로 위 4개 파일의 이름·크기·부모 폴더를 재확인했다. 앞선 'Drive 미교체' 기록은 이전 상태이며 이번 교체로 최종 결과를 공유했다. 파일 공유 권한은 변경하지 않았다.
- **이번 추가 변경 범위**: 본 작업일지의 오늘 항목과 로컬 reports 원본 ZIP 생성, Drive 리포트 갱신. 서비스·계약·DB·의존성 설정 변경은 없으며 이번 작업일지 추가분은 로컬 수정 상태다. 추가 커밋·푸시는 하지 않았다.


## 20261125 작업개요

- 프로젝트: BUILDWISE 최종 프로젝트
- 작업자: jjb 브랜치 담당
- 작업 범위: Playwright 기능 검증 및 리포트, 테스트케이스 표현·분류·서식 통일, 로컬 실행용 DB 환경 설정 정리, 어드민 전용 구조 추가 및 RAG 설계 논의
- 상태: 기능 테스트 추가 169건 실행·시트 반영 완료. 테스트케이스 문서 정리 완료. `.env` 단일 관리로 통합하고 기존 TiDB 연결 유지 확인. 어드민 파일 뼈대 추가 완료, RAG는 기획서 기반 설계 논의 단계이며 구현·적재·생성 모델 선정은 미완료.
- **Playwright 실행 범위**: `backend/tests/run_ui.py`에 `--scope functional`과 `--case-id` 선택 실행을 연결하고, `system_acceptance/playwright/functional.mjs`·`functional-cases.json`으로 추가 기능 169건을 검증했다. 기존 UI·상담 실행 범위는 유지했다. 화면별 캡처·버튼 선택/요청 로그와 실행 결과를 남기며 개별 실패 후에도 다음 케이스를 진행하도록 했다.
- **기능 검증 결과**: 추가 169건은 **Pass 160 / Fail 0 / Blocked 9**. 기존 실행 33건의 **Pass 32 / Blocked 1**을 별도 이력으로 보존해 문서 전체는 **202건: Pass 192 / Fail 0 / Blocked 10 / N/T 0**으로 반영했다. 전체 202건을 한 번에 새로 실행했다는 의미는 아니다.
- **Blocked 구분**: 추가 9건은 데스크톱에서 숨겨진 소개 접기/펼치기 제어 2건, 실제 FAIL 견적 선행조건 1건, 승인·조건 동의·인계 선행조건 4건, 대화가 첨부된 이슈 데이터 부재 1건, 브라우저/OS 인쇄창 수동 확인 1건이다. 기존 RAG 색인 부재 1건은 별도로 유지했다. 성공 응답이나 판정을 임의로 만들어 Pass로 바꾸지 않았다.
- **검증 한계**: 일부 기업 운영 항목은 기존 시연 상태를 대상으로 했으며 실제 기업 DB 변경 검증으로 해석하지 않는다. 실패 응답 주입은 장애 처리 확인용이다. 인쇄 버튼 동작과 실제 인쇄/PDF 대화상자 확인을 구분했다. 초기 중단 회차의 없는 trace는 보유 근거로 표시하지 않고 실제 남은 캡처·로그를 사용했다.
- **실행·산출물**: 실행 명령은 `python -B backend/tests/run_ui.py --scope functional --start-server --headed --slow-mo 300`. 최종 XML·Excel은 `backend/tests/reports/261125_jjb_system_ALL_playwright-functional-complete_001.xml`·`.xlsx`, 종합 HTML·JSON은 같은 reports의 `261125_jjb_system_ALL_playwright-functional-complete_001_123656/`에 저장했다. XML의 tests=169·failures=0·errors=0·skipped=9와 JSON의 Pass 160·Blocked 9를 다시 확인했다.
- **기본기능테스트 문서**: [BUILDWISE_기본기능테스트](https://docs.google.com/spreadsheets/d/1fs2Gyzrzc01EQ385VIQx7Pij4pdZQrwloEGmHruLmM4/edit)의 TC 결과와 실행 근거를 갱신했다. 4개 TC 시트의 근거·비고 및 화면설계서 열은 숨김으로 유지하고 데이터는 삭제하지 않았다. QA Report 집계와 202개 케이스 ID·상태를 재확인했다.
- **별도 단위 결과 구분**: 프론트 Vitest 306건·33파일 통과는 기능 테스트 202건과 다른 검증이다. 코드의 개별 검증식을 문서 행으로 나눈 수, 상위 테스트 함수 수, 반복 실행 횟수를 서로 합산하지 않는다.
- **테스트케이스 문서 표현 정리**: [BUILDWISE_테스트케이스_261125](https://docs.google.com/spreadsheets/d/1nPHFWQiYNXvU9qUbeANiJkAdmoqXy_445kydfH5CT7Q/edit)의 프론트 단위 1,218행·PC 상담 API 63행·음성 반복 E2E 32행을 정리했다. 총 1,313행은 후속 확인 항목을 포함한 문서 행 수이며 새 실행 건수가 아니다. 이 문서의 기존 N/T 상태를 유지했다.
- **분류·재현 스텝 기준**: 업무 분류는 짧은 대분류로, 확인 요소는 중분류로 변경했다. 준비 문구를 제외하고 각 행을 단일 재현 스텝과 그에 대응하는 기대 결과로 정리했다. 프론트 단위를 먼저 반영한 뒤 사용자 요청으로 PC 상담 API·음성 반복 E2E에도 적용했다. 원문 보존용으로 추가했던 셀 메모는 최종 요청에 따라 삭제했고, 기존 명세 ID·TC ID·결과·근거 링크는 유지했다.
- **조건부서식 기준**: 세 TC 시트의 B~E열은 전체 누적 중복 수 대신 바로 위 셀과 비교한다. 첫 데이터 행과 위 셀과 다른 값은 검정색, 위 셀과 같은 값은 회색으로 표시한다. 빈 셀은 판정에서 제외했다. Google Sheets의 실제 색상과 수식을 확인했다.
- **선 디자인 통일**: 프론트 단위를 참고해 PC 상담 API·음성 반복 E2E의 대분류 경계는 실선, 같은 분류의 행 사이는 점선, TC ID 오른쪽은 세로 실선으로 적용했다. 기존 병합과 셀 내용을 유지하고 표시 셀의 테두리·브라우저 화면을 확인했다.
- **DB 연결 현황 확인**: 실제 활성 `PARTS_MYSQL_*`는 PC의 MySQL이 아니라 TiDB Cloud를 사용하고 있었다. 로컬 MySQL 8.4 서비스 실행도 확인했으나 기존 로컬용 비밀번호로는 인증 실패(1045)여서 로컬 MySQL 연결 완료로 기록하지 않는다.
- **env 최종 운영 방식**: 사용자가 선택한 방향은 **PC에서 서비스 실행 → 기존 TiDB의 dev_database 연결**이다. `.env.local`을 별도로 만드는 중간 작업 후 최종적으로 루트 `.env` 하나로 통합하고, 내용이 동일함을 확인한 `.env.local`은 삭제했다. TiDB 설정은 활성화하고 로컬 MySQL(127.0.0.1:3306, root, dev_database) 설정은 비밀번호 입력 자리와 함께 주석으로 보관했다. 전환 시 한 설정 블록만 활성화한다.
- **DB 연결 검사**: 기존 프로젝트 Python으로 backend에서 `python -X utf8 -B -m app.db.schema`를 실행해 **연결 성공: dev_database / MySQL 8.0.11-TiDB-v8.5.3-serverless**를 확인했다. 이 명령은 DB명·버전 SELECT만 실행했으며 `--init`·마이그레이션·재적재·데이터 수정은 하지 않았다. env 통합 전후 활성 환경변수 값이 동일함을 확인했다. 비밀번호·API 키는 일지에 기록하지 않는다.
- **수정 파일·범위**: 기능 검증 관련 `backend/tests/run_ui.py`, `backend/tests/system_acceptance/playwright/functional.mjs`, `functional-cases.json`, `backend/tests/system_acceptance/README.md`와 실행 산출물, 루트 `.env`, 본 일지를 갱신했다. `.env.local`은 최종 삭제 상태다. 서비스 코드·공통 계약·DB 스키마·의존성·lock·공유 설정은 변경하지 않았고 커밋·푸시·GitHub 쓰기는 하지 않았다.
- **이번 일지 갱신 확인**: 최종 Playwright XML·JSON 결과와 로컬 산출물 존재를 읽기 전용으로 재확인했다. 이번 문서·환경 정리 단계에서 기본규약·단위 ALL·모듈 전체·브라우저 기능 테스트는 재실행하지 않았다. 11월 24일 결과를 11월 25일 새 실행으로 표시하지 않는다.

### 어드민 전용 구조 및 RAG 설계 논의

- **기획 기준 확인**: 사용자 제공 `admin_기획서.md`(기준일 2026-11-23)를 읽었다. 어드민은 기업 고객센터 운영 화면이며 고객·상담·메시지·견적은 기존 데이터를 재사용하고, 직원 권한·인계·티켓·기업 문서 등 운영 기능을 분리한다. 기획서는 설계 초안이므로 기재된 구현·자료 건수를 현재 jjb의 구현 완료나 실재 데이터 검증 결과로 취급하지 않는다.
- **어드민 파일 뼈대 추가**: `backend/app/admin/`에 `routes.py`, `server.py`, `service.py`, `security.py`, `pipeline.py`, `agents.py`, `abuse.py`, `policy_rag.py`, `events.py`, `seed.py`, `scenarios.py`, `__init__.py`, `sql/schema.sql`을 추가했다. 라우터는 비어 있고 업무·인증·RAG 모듈은 역할을 명시한 TODO 상태다. 실행 가능한 완성 어드민 기능으로 표시하지 않는다.
- **백엔드·프론트 구분**: `frontend/src/admin/`에 `pages/`, `components/`, `api/`, `events/`와 안내 문서를 마련했다. 데이터·검색 문단·수집/평가 스크립트·실행 안내는 각각 `backend/data/admin/`, `backend/data/rag/admin/`, `backend/scripts/collection/`, `backend/scripts/admin/`, `backend/docs/admin/`에 분리했다. `backend/.admin_data/.gitignore`로 향후 로컬 시연 데이터가 추적되지 않도록 했다. 원래 기획서의 루트 data/scripts/docs 배치와 달리 어드민 전용 자원은 backend 아래에 모은 구성이다.
- **테스트 범위 제외**: 사용자 요청에 따라 이번 어드민 뼈대 작업에서 `backend/tests/admin/` 테스트 파일은 추가하지 않았다. 일지 갱신 시 해당 경로는 존재하지만 내부 파일은 없으며, 이 기록에서 폴더 삭제나 테스트 구현은 하지 않았다.
- **뼈대 검증 결과**: 구조 추가 당시 프로젝트 Python의 `-B -c` 검사로 Python 12개 파일 AST 문법 검사, 메모리 SQLite에서 SQL 자리표시자의 테이블 미생성, 빈 어드민 라우터, 기존 고객 앱과 어드민 팩터리의 OpenAPI 일치를 확인했다. 초기 검사 명령의 인용 처리 오류와 FastAPI 내부 라우터의 path 접근 오류는 검사 방식 수정 후 최종 통과했다. 인증·RAG 기능 통과를 의미하지 않는다. 기존 두 진입점·루트 .gitignore·backend/pyproject.toml·frontend/package.json은 당시 전후 해시가 동일했다.
- **RAG 업무 범위 정리**: 기업 직원이 상담·티켓 처리에 필요한 정책 근거를 찾고 답변 초안·처리 제안을 받는 용도로 잡았다. 고객 사실·티켓 상태·견적·통계는 기존 DB 조회로, FAQ·AS·교환/반품 및 공개 정책 근거는 문서 검색으로 구분한다. 인계 요약·문의 분류·욕설 감지는 RAG와 연결될 수 있지만 별도 기능 및 평가 범위다.
- **데이터 구성 전제**: 전자상거래법·소비자기본법·삼성 SSD 보증 안내·기업 FAQ/AS/교환·반품 정책이 준비되어 들어온다고 가정하고 설계한다. 정책 검색 질문 16건은 검색 색인과 분리한 평가셋으로 둔다. 문의 분류 48건·욕설 자료·부품 스냅샷은 각각 분류/감지/조회용으로 구분한다. 기획서의 문단·문장·부품 수는 실제 파일 수집·적재·검증 완료 건수가 아니다.
- **설계할 흐름과 출력**: 직원 질문 및 선택한 상담/티켓 → 직원·기업·문서 권한 확인 → 필요한 상담 맥락 조회 → 허용된 정책 검색 → 근거 기반 초안 생성 → 직원 확인을 설계 방향으로 정리했다. 답변 초안·근거 문단·문서명/버전/적용일·추가 확인 사항을 구분하고, 근거 없음·정책 충돌·구버전·접근 불가를 처리해야 한다. 환불 승인·차단·티켓 변경을 자동 실행하는 기능은 포함하지 않는다. 세부 화면 호출 방식·스키마·API 계약은 아직 확정하지 않았다.
- **격리 원칙**: admin 폴더 구분만으로 사용자 영향이 차단된다고 보장하지 않는다. 향후 구현은 별도 실행 프로세스/포트·검색 저장소, 서버의 기업/역할 필터, 기존 DB의 필요한 읽기 범위, 호출량 제한을 기준으로 설계한다. 기존 고객 진입점·공통 API/이벤트·운영 DB 스키마 연결 변경은 별도 협의가 필요하다. 격리 환경 구축 또는 권한 테스트를 완료한 것은 아니다.
- **생성 모델 후보 논의**: Raon-1-mini, OpenAI GPT-5.4 mini, Gemini 3.8 Flash, 자체 호스팅 대안 Qwen3.5-9B를 비교 후보로 검토했다. 현재 사용자가 확보한 API는 OpenAI뿐이므로 OpenAI 기반 초기 검증을 우선 검토하고, 라온 등은 후속 비교 대상으로 둔다. OpenAI 내부의 nano/mini/상위 모델 비교도 논의했지만 최종 선정·계정 접근 확인·실제 호출·비용 측정·모델 성능 평가는 안 돌림이다. 답변 생성과 검색/임베딩을 분리해 교체 가능하도록 설계하며 임베딩·벡터 DB도 미선정이다.
- **모델 확인 출처**: [Raon 공식 모델 문서](https://raon-mini.krafton.ai/en/docs/models), [Raon API 안내](https://raon-mini.krafton.ai/en/docs), [Raon 모델 카드](https://huggingface.co/KRAFTON/Raon-1-mini), [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [Gemini 3.8 Flash](https://aistudio.google.com/docs/models/gemini-3.8-flash), [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B). 라온 한시적 무료 안내와 모델 제공 여부·요금은 구현 시 재확인한다. 공급사 문서 확인은 우리 정책 데이터의 성능 검증을 대신하지 않는다.
- **다음 작업**: 기획서 기준 문서/문단 메타데이터·버전/적용일·권한, 전처리·분할·색인 갱신, 검색·생성 입출력, 예외 처리, 평가 항목을 구체화한다. 생성 모델 비교는 동일 질문·동일 검색 근거로 조건/예외 누락·인용 일치·답변 보류·응답 시간·비용을 평가하도록 설계한다. 기업 간 정보 차단은 별도 접근 제어 검증으로 확인한다.
- **이번 최신화 범위**: 기존 20261125 기록을 보존하고 작업 범위·상태 및 이 하위 항목을 추가했다. 이번 일지 갱신에서 코드·데이터·환경변수·공통 계약·DB·의존성은 변경하지 않았고 테스트 재실행·API 호출·커밋·푸시도 하지 않았다. 앞선 기능 테스트 결과와 어드민 뼈대 검사를 이번 새 실행 결과로 재집계하지 않는다.
