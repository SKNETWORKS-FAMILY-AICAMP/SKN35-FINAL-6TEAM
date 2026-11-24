# 테스트 결과 XML 공통 제목 규약

단위·모듈·시스템·인수 테스트는 같은 파일명과 XML 내부 제목 규약을 사용합니다. 모든 결과 XML은 `backend/tests/reports/`에 함께 저장합니다.

## 파일명

```text
YYMMDD_<브랜치명>_<테스트단계>_<요구사항ID>_<검증대상>_<일련번호>.xml
```

테스트 단계는 다음 값만 사용합니다.

- `unit`
- `module`
- `system`
- `acceptance`

예시:

```text
261119_jjb_unit_BASE_common-contract_001.xml
261119_feat-quote_module_REQ-014_quote-database_001.xml
261119_release_system_REQ-030_order-flow_001.xml
261119_release_acceptance_REQ-030_order-approval_001.xml
```

## XML 내부 제목

```text
<브랜치명 대문자> | <테스트단계 대문자> | <요구사항ID> | <검증대상 대문자> | <일련번호>
```

## 운영 규칙

1. 날짜는 한국 시간 기준 실행일을 자동으로 사용합니다.
2. 실행 스크립트는 지정된 프로젝트의 `.git/HEAD`에서 현재 브랜치를 자동으로 읽습니다.
3. Git 명령은 실행하지 않으며 detached HEAD 상태면 결과 생성을 중단합니다.
4. 브랜치명에 `/` 또는 `_`가 있으면 파일명에서는 `-`로 바꿉니다.
5. 요구사항 ID가 없는 공통 기준은 `BASE`를 사용합니다.
6. 여러 요구사항을 포함하는 전체 테스트 묶음은 `ALL`을 사용합니다.
7. 검증 대상은 영문 소문자와 하이픈으로 작성합니다.
8. 일련번호는 요구사항 ID별로 `001`부터 부여합니다.
9. 새로운 테스트 항목에만 다음 번호를 부여하고 삭제된 번호는 재사용하지 않습니다.
10. 담당자와 PASS·FAIL 상태는 파일명에 넣지 않습니다.
