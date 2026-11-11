# AGENTS.md — BUILDWISE AI 코딩 도구 공통 규칙

Claude Code · Codex 등 AI 코딩 도구가 **작업 전에 반드시 읽는 규칙**입니다. 도구가 달라도 이 파일 하나를 따릅니다.
(`CLAUDE.md` 는 이 파일을 불러오기만 합니다. 사람용 설명은 [docs/DEVELOPMENT_RULES.md](docs/DEVELOPMENT_RULES.md) — 번호가 같습니다.)

## 프로젝트

BUILDWISE 는 판매 기업이 자사 상품 데이터와 판매 정책을 연결해 AI 상담 직원을 두는 B2B2C 플랫폼입니다.
첫 시연 도메인은 하드웨어 전체(노트북 · 데스크톱 · 그래픽카드 · 서버 · 모니터 …)입니다.
지금은 **Mock 모드**(외부 AI 없음)이고 상품 데이터는 **가상 브랜드 테스트 데이터**입니다.

## 코드 지도

| 위치 | 하는 일 |
|---|---|
| `backend/app/contracts/schemas.py` | **공통 계약** — API · 이벤트 · 상태값. 프론트 타입의 원본 |
| `backend/app/agents/` | 업무팀 4개(상담 · 설계 · 검증 · 견적) — 도메인을 모르는 공통 엔진 |
| `backend/app/workflows/runner.py` | 업무팀 실행 순서 · 오래된 결과 차단 · 재시도 |
| `backend/app/domains/hardware/` | 하드웨어 전용 지식(사양 스키마 · 조건 규칙) |
| `backend/app/catalog/` | 공통 상품 형식 · 기업 데이터 적재 어댑터 |
| `backend/app/events/service.py` | 이벤트 기록(순번 보장) · 조회 · SSE |
| `backend/app/db/models.py` · `backend/migrations/` | DB 테이블 · 마이그레이션 |
| `frontend/src/features/` | 화면 기능별 폴더(office · consultation · recommendations · quotations · orders) |
| `frontend/src/events/` | 이벤트 스트림(실제 SSE · 가짜 대본이 같은 인터페이스) |
| `frontend/src/api/schema.d.ts` | **자동 생성** 타입 — 직접 고치지 않음 |
| `data/fixtures/` | 견본 데이터(가상) |

자세한 구조: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 규칙

1. **먼저 읽고 바꾼다.** 수정할 파일과 그 테스트, 관련 문서를 먼저 읽는다. 추측으로 코드를 쓰지 않는다.
2. **변경 범위를 먼저 말한다.** 어떤 파일을 왜 바꿀지 사용자에게 보이고 시작한다. 요청 밖 파일은 고치지 않는다.
3. **다른 팀원 담당 모듈은 건드리지 않는다.** 필요하면 멈추고 사용자에게 알린다(담당표: [docs/TEAM_GUIDE.md](docs/TEAM_GUIDE.md)).
4. **공통 계약을 임의로 바꾸지 않는다.** `backend/app/contracts/`, API 경로, 이벤트 타입 · 상태값, `contracts/`, `frontend/src/api/schema.d.ts`.
   바꿔야 하면 멈추고 "계약 변경 PR 이 필요합니다" 라고 사용자에게 알린다.
5. **DB 스키마 변경은 마이그레이션과 함께.** `models.py` 수정 → `uv run alembic revision --autogenerate -m "..."` → 생성 파일을 읽고 확인 → `alembic check` 통과.
6. **도메인 지식은 `domains/` 에만.** `agents/` · `workflows/` · `catalog/` 에 특정 상품 유형 · 브랜드 · 사양 이름을 쓰지 않는다.
7. **이벤트와 결과 저장 규칙을 지킨다.** 이벤트는 `append_event` 로만, 실행 결과 저장은 `WorkflowRunner._guarded` 안에서만,
   DB 조회는 항상 `company_id` 로 범위를 좁힌다.
8. **구현 뒤 테스트를 실제로 돌린다.** 돌린 명령과 결과를 보고한다. 못 돌렸으면 "안 돌림" 이라고 쓴다.
   실패한 테스트를 지우거나 건너뛰게(skip) 바꾸거나 기대값을 결과에 맞춰 고치지 않는다.
9. **의존성은 사용자 확인 뒤에만, 정확한 버전으로 추가한다.** `uv add "패키지==x.y.z"` / `npm install -E 패키지@x.y.z`, lockfile 도 같이 커밋한다. 큰 프레임워크를 새로 들이지 않는다.
10. **공유 설정 파일을 다시 만들지 않는다.** `compose.yaml`, `pyproject.toml`, `package.json`, lockfile, `tsconfig.json`, `eslint.config.js`, `.github/`, `.gitattributes`, `AGENTS.md`. 고쳐야 하면 필요한 줄만 고친다.
11. **비밀값 · 개인정보를 커밋하지 않는다.** API 키는 각자 `.env` 에만. 이메일 · 전화번호 · 실명 데이터를 코드나 견본 데이터에 넣지 않는다.
12. **프로젝트를 새로 만들지 않는다.** 문제가 생겨도 `npm create` · `uv init` 등으로 갈아엎지 않는다. [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) 부터 본다.
13. **데이터를 지어내지 않는다.** 실제 제품의 가격 · 사양을 확인하지 못했으면 `unconfirmed` · `unverified` 로 둔다. 테스트 데이터에는 표시를 남긴다.
14. **화면 상태는 이벤트로만 바꾼다.** 끝나지 않은 작업을 끝난 것처럼 보이게 하지 않는다.
15. **작업 하나 = 기능 브랜치 하나 = PR 하나.** `main` 에 직접 커밋하지 않는다.

## 자주 쓰는 명령 (저장소 맨 위 폴더에서)

```bash
docker compose up -d --build --wait                          # 켜기 (scripts/dev.ps1 · dev.sh)
docker compose exec -T backend uv run --frozen pytest -q     # 백엔드 테스트
docker compose exec -T frontend npm test                     # 프론트 테스트
scripts/check.ps1   또는   bash scripts/check.sh              # PR 전 전체 검사
scripts/gen-contracts.ps1 또는 bash scripts/gen-contracts.sh  # 계약을 바꾼 뒤 타입 다시 만들기
```

## 작업을 마칠 때 사용자에게 보고할 것

- 바꾼 파일 목록
- 돌린 검사 명령과 결과(PASS/FAIL 그대로)
- 돌리지 못한 검사와 이유
- 공통 계약 · DB · 공유 설정을 건드렸는지
