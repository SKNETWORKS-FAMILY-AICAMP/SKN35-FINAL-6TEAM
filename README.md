# BUILDWISE

판매 기업이 자사 **상품 데이터와 판매 정책을 연결해 AI 상담 직원을 두는** B2B2C 플랫폼입니다.
SK네트웍스 Family AI 캠프 35기 최종 프로젝트 6팀.

> **지금 상태 (2026-11-11):** 공동 개발을 시작하기 위한 초기 환경입니다. 외부 AI 를 부르지 않는 **Mock 모드**이고,
> 상품 데이터는 모두 **가상 브랜드 · 가상 모델의 테스트 데이터**입니다.

## BUILDWISE 는

- 고객은 AI 상담 직원과 대화하고, 그동안 뒤에서 **설계·분석팀 · 검증팀 · 견적·주문팀**이 상품 탐색 · 검증 · 견적을 처리합니다.
- 업무팀이 일하는 모습은 **2D 게임형 오피스 화면**에 실제 처리 상태 그대로 보입니다.
- 첫 시연 도메인은 **하드웨어 전체**(노트북 · 데스크톱 · 그래픽카드 · 서버 · 모니터 …)입니다.
- 목표는 "하드웨어를 잘 추천하는 AI" 보다 **같은 엔진에 기업의 상품 DB 와 판매 정책을 바꿔 끼우면 그 기업의 AI 판매 상담원이 되는 구조**를 보여 주는 것입니다.
  (실제 도입에는 데이터 변환 · 접근 권한 · 가격/재고 · CRM · 주문 연동이 더 필요합니다.)

## 지금 되는 것 / 아직 안 되는 것

| 기능 | 상태 |
|---|---|
| 상담 세션 · 요구사항(목적 · 상품 유형 · 예산) 저장과 버전 관리 | ✅ 화면 입력(음성 아님) |
| 업무팀 4개 백그라운드 실행 · 설계와 검증 겹쳐 진행 · 후보별 병렬 검증 | ✅ 규칙 코드(Mock) |
| 실행 이벤트 실시간 표시(SSE) · 끊겼다 다시 붙으면 이어 받기 | ✅ |
| 예산 변경 시 최신 결과로 갱신 · 늦게 온 옛 결과 차단 | ✅ 테스트로 확인 |
| 참고 견적 · 가상 주문(중복 요청 방지) | ✅ 실제 결제 없음 |
| 같은 엔진에 기업 2곳(공개 견본 카탈로그 · 가상 기업 A) 연결 | ✅ 카탈로그 형식 · 판매 정책이 다름 |
| 실시간 음성 상담 | ⬜ 미구현 |
| 실제 LLM 연결 | ⬜ 미구현(붙일 자리만 있음) |
| 2D 게임형 오피스 디자인 | ⬜ 상태 확인용 최소 화면만 |
| 실제 공식 상품 데이터 · 가격 | ⬜ 미수집 |
| 로그인 · 권한, AWS 배포 | ⬜ 미구현 |

## 빠른 시작

필요한 것: **Git**, **Docker Desktop**, 디스크 여유 공간 **10GB 이상**. (Python · Node · MySQL 은 따로 설치하지 않습니다.)

```bash
git clone https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN35-FINAL-6TEAM.git
cd SKN35-FINAL-6TEAM
docker compose up -d --build --wait
```

화면 http://localhost:5173 · API 문서 http://localhost:8000/docs

처음이라면 **[docs/START_HERE.md](docs/START_HERE.md)** 를 순서대로 따라 하세요(설치부터 검사까지).

## 문서

| 문서 | 언제 보나 |
|---|---|
| [docs/START_HERE.md](docs/START_HERE.md) | 처음 설치하고 켜 볼 때 |
| [docs/TEAM_GUIDE.md](docs/TEAM_GUIDE.md) | 매일 개발할 때 — 브랜치 · 커밋 · PR · 충돌 · 계약/DB 변경 |
| [docs/DEVELOPMENT_RULES.md](docs/DEVELOPMENT_RULES.md) | 팀 공통 규칙(사람용) |
| [AGENTS.md](AGENTS.md) | 같은 규칙(AI 코딩 도구용 원문) |
| [docs/QA_GUIDE.md](docs/QA_GUIDE.md) | 코드를 쓴 뒤 확인할 것 · 테스트 실패 시 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 막혔을 때 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 구조 · API · 이벤트 · DB 계약 |

## 이번에 한 일과 통합 방식 (2026-11-11, PM)

> 이 절은 초기 환경을 세우면서 무엇을 했는지 기록한 것입니다. 팀이 자리를 잡으면 줄이거나 다른 문서로 옮겨도 됩니다.

### 원래 저장소에 있던 것

| 위치 | 내용 |
|---|---|
| `main` | README 한 줄(`# SKN35-FINAL-6TEAM`) |
| `dev` | PR #1 "초기 환경 생성" — `uv init` 기본 뼈대(`pyproject.toml` 의존성 없음, `.python-version` 3.12, `main.py` 인사 출력, `uv.lock`, `.gitignore`) |
| `ish` · `jjb` · `kyj` · `ssu` | 개인 브랜치, 모두 `dev` 와 같은 커밋(추가 작업 없음) |
| 이슈 #2 | "6팀 문서화 진행" |

### 무엇으로 통합했나

| 기존 | 지금 | 이유 |
|---|---|---|
| `dev` 의 `uv init` 뼈대(루트) | `backend/` 의 `pyproject.toml` · `uv.lock` · `.python-version` | **uv 를 쓰는 방식은 그대로** 이어받았습니다. 프론트와 나란히 두려고 `backend/` 폴더로 옮겼고, 의존성과 버전을 고정했습니다 |
| Python 3.12 | Python 3.14 | 2026-11 기준 주요 라이브러리 바이너리가 모두 나온 최신 안정판. uv 가 버전을 자동으로 맞춰 줘서 팀원 PC 의 Python 버전과는 상관없습니다 |
| `main.py` (인사 출력) | `backend/app/main.py` (FastAPI 앱) | |
| 개인 브랜치 + `dev` | `main` + 짧은 기능 브랜치(`feat/…`, `fix/…`) | 오래 사는 개인 브랜치는 합칠 때 충돌이 커집니다. 작업마다 브랜치를 만들고 PR 로 `main` 에 합칩니다. `main` 은 보호(PR · CI · 승인 1명) |
| 옛 브랜치 5개 | `archive/pre-buildwise-2026-11-11` 태그로 보존 후 정리 | 필요하면 태그에서 언제든 다시 꺼낼 수 있습니다 |
| 루트 README | 이 README | |
| 이슈 #2 (문서화) | `docs/` 폴더 6개 문서 | 프로젝트 문서는 `docs/` 에 모읍니다. 이슈는 문서화 담당이 계속 이어 갑니다 |

### 새로 만든 것

- **실행 환경:** `compose.yaml` 하나로 MySQL 8.4 · 백엔드 · 프론트가 함께 켜집니다. `.env` 없이 기본값으로 실행되고, 처음 켤 때 DB 마이그레이션과 견본 데이터가 자동으로 들어갑니다.
  Windows 대응: 줄바꿈 LF 고정(`.gitattributes`), 파일 변경 폴링 감지, 의존성은 컨테이너 볼륨(Windows 파일과 섞이지 않게), PowerShell 5.1 용 스크립트(UTF-8 BOM).
- **스크립트:** `scripts/dev` · `check` · `stop` · `reset` · `gen-contracts` — `.ps1`(Windows)과 `.sh`(macOS · Linux) 같은 동작.
- **공통 계약:** API 12개 · 이벤트 형식 · 상태값을 `backend/app/contracts/schemas.py` 한 곳에서 정의하고, OpenAPI(`contracts/`)와 프론트 TypeScript 타입(`frontend/src/api/schema.d.ts`)을 자동 생성합니다. CI 가 생성물과 코드가 다르면 실패시킵니다.
- **DB:** 테이블 11개와 Alembic 첫 마이그레이션. CI 가 모델과 마이그레이션 차이를 검사합니다.
- **엔진(Mock):** 업무팀 4개 실행기 — 후보가 나오는 대로 검증을 병렬로 시작, 요구사항 버전으로 옛 결과 차단, 세션별 이벤트 순번(빈 번호 없음), 일시 오류 재시도, 서버 재시작 뒤 정리, 가상 주문 멱등 처리.
- **기업 교체 구조:** 하드웨어 도메인 팩(`domains/hardware`) · 데이터 적재 어댑터(공통 형식 JSON / 기업 CSV + 컬럼 매핑) · 기업별 판매 정책. 견본 기업 2곳.
- **화면:** 상태 확인용 최소 화면 — 기업 전환 · 상담 입력 · 업무팀 4칸 오피스 · 후보/검증 · 견적 · 가상 주문. 실제 이벤트와 가짜 이벤트 대본(`?mock=1`)을 같은 인터페이스로 받습니다.
- **테스트 · CI:** 백엔드 pytest 29개, 프론트 vitest 5개, Playwright 브라우저 테스트 1개. GitHub Actions 에서 백엔드 · 계약 · 프론트 · 윈도우(PowerShell 5.1 구문 · 윈도우 빌드) · 비밀값(gitleaks) · 통합(Docker 전체 실행 + 검사 스크립트 + 브라우저) 6개 잡.
- **AI 코딩 도구 규칙:** `AGENTS.md` 하나가 정본(Codex 가 자동으로 읽음), `CLAUDE.md` 는 그것을 불러오기만 합니다. 사람용 설명은 `docs/DEVELOPMENT_RULES.md`(같은 번호).
- **안내서:** Git · Docker 를 처음 쓰는 팀원 기준의 단계별 문서 6개(`docs/`).

### 기술 스택과 고정 버전

| 영역 | 선택 · 버전 | 이유 |
|---|---|---|
| 백엔드 | Python 3.14 · FastAPI 0.162.4 · Uvicorn 0.54.0 · Pydantic 2.14 | 스키마 → OpenAPI → TS 타입이 자동으로 이어져 계약 관리가 쉽고, 실시간 스트림(SSE)이 단순 |
| DB 도구 | SQLAlchemy 2.1.8 · Alembic 1.20.1 · PyMySQL 1.2.4 | 마이그레이션 필수 규칙을 도구로 지킴, 순수 파이썬 드라이버라 OS 별 빌드 문제 없음 |
| DB | MySQL 8.4.13 (LTS) | 최신 LTS 9.7 은 AWS RDS 지원을 확인하지 못해 RDS 가 지원하는 8.4 |
| 패키지 관리 | uv 0.13.7 · npm(lockfile) | 버전을 lockfile 로 고정 |
| 프론트 | React 19.3.1 · TypeScript 5.9.3 · Vite 8.3.8 · Node 24 LTS | TS 7 은 린트 · 타입 생성 도구가 아직 지원하지 않아 5.9 |
| 품질 | ruff 0.17.4 · ESLint 10 · Prettier 3.9 · pytest 9.2 · Vitest 5.1 · Playwright 1.65 · gitleaks 8.30.1 | |
| 실행 | Docker Compose v2 | 팀원 PC 차이를 없앰 |

Django 대신 FastAPI 를 고른 이유, 스레드 실행 · SSE 를 고른 이유는 [docs/ARCHITECTURE.md §11](docs/ARCHITECTURE.md#11-기술-선택-이유-2026-11-11).
모든 버전은 2026-11-11 에 npm · PyPI · Docker Hub 에서 서로 호환되는지 확인하고 고정했습니다.

### 검증 결과

| 환경 | 무엇을 돌렸나 | 결과 |
|---|---|---|
| GitHub Actions — Ubuntu 24.04 | 백엔드 린트 · 포맷 · 견본 데이터 · `alembic upgrade`/`check` · pytest | 통과 (pytest 29 passed) |
| GitHub Actions — Ubuntu 24.04 | `docker compose up --wait` → `scripts/check.sh` 12단계 → Playwright | 통과 (12/12 PASS, 브라우저 1 passed) |
| GitHub Actions — Windows Server 2025 | PowerShell 5.1 로 `scripts/*.ps1` 구문 · BOM, 윈도우 체크아웃으로 백엔드(DB 없는) 테스트 · 프론트 포맷 · 테스트 · 빌드 | 통과 |
| PM PC — Windows 11 · Docker Desktop · PowerShell 5.1 | `scripts\dev.ps1` → `scripts\check.ps1` | **미완료** — `dev.ps1` 은 실행됐지만 PC 디스크가 가득 차 이미지 빌드 중 중단(2026-11-11). 다른 Windows PC 에서 다시 확인 필요 |
| macOS | — | **아직 확인하지 않음** |

**팀원 5명 각자 PC 에서의 실행은 아직 확인하지 않았습니다.** 각자 START_HERE 를 따라 해 보고 막힌 곳을 알려 주세요.

### 다음 우선순위

1. 팀원 전원 START_HERE 로 실행 확인(특히 macOS) — 막힌 곳은 TROUBLESHOOTING 에 추가
2. 역할 분담 확정 → [TEAM_GUIDE §16](docs/TEAM_GUIDE.md#16-담당표-역할이-정해지면-채웁니다) 담당표 · CODEOWNERS
3. 공식 공개 자료로 실제 상품 데이터 수집(출처 · 이용 허락 범위 기록, 가격 미확인은 미확인으로)
4. 실시간 음성 상담 공급자 · 비용 결정 → 상담팀 연결
5. LLM 연결 범위 결정(요구사항 구조화 · 추가 질문 · 비교 설명) — 검색 · 필터 · 계산은 코드 유지
6. 2D 게임형 오피스 디자인(입력은 지금의 `OfficeState` 그대로)
7. AWS 배포 경로 결정

## 폴더 구조

```text
backend/            FastAPI 백엔드 (app/ · migrations/ · tests/)
frontend/           React 화면 (src/features/ · src/events/ · src/api/ · e2e/)
contracts/          자동 생성된 API · 이벤트 계약 (직접 고치지 않음)
data/fixtures/      가상 견본 데이터
scripts/            dev · check · stop · reset · gen-contracts (.ps1 / .sh)
docs/               안내서 · 규칙 · 구조
.github/            CI · PR 템플릿
compose.yaml        개발 환경 전체 실행
AGENTS.md           AI 코딩 도구 공통 규칙 (CLAUDE.md 는 이것을 불러옴)
```

폴더별 역할은 [docs/ARCHITECTURE.md §2](docs/ARCHITECTURE.md#2-폴더-역할).
