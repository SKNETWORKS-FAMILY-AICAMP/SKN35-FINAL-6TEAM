# 코드를 쓴 뒤 확인할 것 (QA_GUIDE)

**완료 기준은 "코드를 썼다" 가 아니라 "검사가 통과했다" 입니다.** PR 을 올리기 전에 아래를 확인합니다.

## 1. 한 번에 전부 검사

컨테이너를 켠 상태(`scripts/dev.ps1` / `dev.sh`)에서:

| Windows PowerShell | macOS · Linux |
|---|---|
| `.\scripts\check.ps1` | `./scripts/check.sh` |

검사 12단계가 차례로 돌고 마지막에 PASS/FAIL 표가 나옵니다. 같은 검사를 GitHub Actions(CI)도 PR 마다 돌립니다.

| 단계 | 무엇을 보나 | 실패하면 |
|---|---|---|
| 백엔드 린트 (ruff check) | 쓰지 않는 import, 흔한 실수 | 메시지의 파일:줄로 가서 고칩니다. `ruff check . --fix` 로 자동 수정되는 것도 있습니다 |
| 백엔드 포맷 | 코드 모양 | `docker compose exec backend uv run --frozen ruff format .` 후 커밋 |
| 견본 데이터 형식 | `data/fixtures` 가 사양 스키마에 맞는지 | 메시지에 나온 파일 · 줄을 고칩니다 |
| alembic check | 모델과 마이그레이션이 같은지 | 마이그레이션을 빠뜨렸습니다 → [TEAM_GUIDE §13](TEAM_GUIDE.md#13-db-컬럼을-추가해야-할-때) |
| 백엔드 테스트 (pytest) | 동작 | 아래 3번 |
| 계약 파일 다시 만들기 · 비교 | API 를 바꾸고 계약 파일을 안 올렸는지 | 다시 만들어진 `contracts/*` · `schema.d.ts` 를 커밋 |
| 프론트 린트 (eslint) | React 규칙 · 흔한 실수 | 메시지대로 고칩니다(경고도 실패로 칩니다) |
| 프론트 포맷 (prettier) | 코드 모양 | `docker compose exec frontend npm run format` 후 커밋 |
| 타입 검사 (tsc) | 타입 오류 · API 필드 오타 | API 필드는 `schema.d.ts` 에 있는 이름만 씁니다 |
| 프론트 테스트 (vitest) | 화면 상태 로직 | 아래 3번 |
| 빌드 | 배포용으로 묶이는지 | 오류 메시지의 파일을 고칩니다 |

## 2. 하나씩 검사 (빠르게 돌리고 싶을 때)

```bash
docker compose exec -T backend uv run --frozen pytest -q                          # 백엔드 테스트 전부
docker compose exec -T backend uv run --frozen pytest -q tests/test_orders.py     # 파일 하나
docker compose exec -T backend uv run --frozen pytest -q -k stale                 # 이름에 stale 이 들어간 테스트
docker compose exec -T frontend npm test                                          # 프론트 테스트
docker compose exec -T frontend npm run lint
docker compose exec -T frontend npm run typecheck
```

## 3. 테스트가 실패했을 때

1. 실패 메시지의 **맨 아래 `assert` 줄**과 그 위의 값 비교를 읽습니다(무엇을 기대했고 실제로 무엇이 나왔는지).
2. 내가 바꾼 코드 때문인지 확인합니다: `git stash` → 테스트 → `git stash pop`. (stash 가 처음이면 팀원과 같이 하세요.)
3. 원인을 고칩니다. **하지 말 것:** 테스트 지우기, `skip` 붙이기, 기대값을 지금 결과에 맞춰 바꾸기.
   기대값이 정말 틀렸다면(요구사항이 바뀜) PR 설명에 이유를 적고 리뷰어가 확인하게 합니다.
4. 못 고치면 PR 에 "실패하는 테스트와 이유" 를 그대로 적고 도움을 요청합니다.

## 4. 테스트가 지키는 것

| 테스트 파일 | 확인하는 상황 |
|---|---|
| `backend/tests/test_api_flow.py` | 상담 → 설계 → 검증 → 견적 전체 흐름, 이벤트 순번에 빈 번호 없음, 재연결 시 이어 받기, 같은 요구사항 재실행 안 함, 잘못된 입력 거절 |
| `backend/tests/test_state_consistency.py` | 예산 변경 → 최신 결과, **늦게 도착한 옛 결과가 최신을 덮지 않음**, 전원 탈락 → 재검토 필요, 견적 실패 표시, 서버 재시작 정리 → 다시 시도, 일시 오류 재시도 |
| `backend/tests/test_orders.py` | 같은 키 재요청 · **동시 요청에도 주문 1건**, 옛 견적 주문 거절 |
| `backend/tests/test_tenancy_and_catalogs.py` | 같은 엔진 · 다른 기업 → 다른 후보 · 다른 견적, 취급 안 하는 유형, **다른 기업 데이터 접근 차단** |
| `backend/tests/test_catalog_and_domain.py` | 기업 CSV 적재(엑셀 BOM 허용 · CP949 거절 · 잘못된 줄 위치 안내), 하드웨어 규칙 |
| `frontend/src/features/office/officeState.test.ts` | 화면이 중복 · 옛 버전 이벤트를 무시하는지, 병렬 작업 표시 |
| `frontend/e2e/smoke.spec.ts` | 실제 브라우저로 상담 → 견적 → 주문 → 예산 변경 → 기업 전환 |

새 기능을 만들면 같은 위치에 테스트를 하나 이상 추가합니다.

## 5. 브라우저 테스트(Playwright)

CI 의 '통합(참고)' 잡이 자동으로 돌립니다. 내 PC 에서 돌리려면 컨테이너를 켠 상태에서:

```bash
docker run --rm --network host -v "$PWD/frontend:/work" -w /work mcr.microsoft.com/playwright:v1.65.0-noble bash -c "npm ci && npx playwright test"
```

`--network host` 는 Linux 에서만 그대로 동작합니다. Windows · macOS 에서 돌리는 방법은 아직 검증하지 않았습니다.

## 6. 화면을 바꿨다면

- 브라우저에서 직접 눌러 봅니다(http://localhost:5173).
- 백엔드 없이 화면만 볼 때는 http://localhost:5173/?mock=1 (가짜 이벤트 대본).
- PR 에 화면 캡처를 붙입니다.
