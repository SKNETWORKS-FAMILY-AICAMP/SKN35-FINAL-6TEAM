# BUILDWISE

**판매 기업이 상품 DB · 판매 정책을 연결하면, 고객 요구를 받아 추천 · 호환성 검증 · 견적까지 처리하는 AI 상담 직원 플랫폼(B2B2C).**
첫 시연은 **AI 개발 입문자를 위한 개발 장비 상담**(노트북 · 데스크톱 · GPU · 서버, 클라우드 GPU 비교)입니다.
SK네트웍스 Family AI 캠프 35기 최종 프로젝트 6팀.

> **지금 상태 (2026-11-12):** 외부 AI 를 부르지 않는 **Mock 모드**(규칙 코드)이고, 상품 · 클라우드 가격 데이터는 모두
> **가상 브랜드 · 가상 공급자의 테스트 데이터**입니다. 2026-11-12 팀 합의로 DB 를 PostgreSQL + pgvector 로 바꾸고
> 채팅 상담 · 발화 이해(NLU) 기준선 · 하드웨어 계산 규칙을 넣었습니다 — [아래 결정 기록](#2026-11-12-팀-합의-결정).

## BUILDWISE 는

- 고객은 AI 상담 직원과 대화하고, 그동안 뒤에서 **설계·분석팀 · 검증팀 · 견적·주문팀**이 상품 탐색 · 검증 · 견적을 처리합니다.
- 업무팀이 일하는 모습은 **2D 게임형 오피스 화면**에 실제 처리 상태 그대로 보입니다.
- 첫 시연은 **AI 개발 입문자를 위한 개발 장비 상담**입니다 — "7B 모델 파인튜닝할 노트북", "지금 노트북 업그레이드로 될까",
  "클라우드 GPU 를 빌리는 게 나을까" 같은 질문에 필요한 VRAM 계산 · 보유 장비 진단 · 비용 비교까지 답합니다.
- 목표는 "하드웨어를 잘 추천하는 AI" 보다 **같은 엔진에 기업의 상품 DB 와 판매 정책을 바꿔 끼우면 그 기업의 AI 판매 상담원이 되는 구조**를 보여 주는 것입니다.
  (실제 도입에는 데이터 변환 · 접근 권한 · 가격/재고 · CRM · 주문 연동이 더 필요합니다.)

## 지금 되는 것 / 아직 안 되는 것

| 기능 | 상태 |
|---|---|
| 상담 세션 · 요구사항(목적 · 상품 유형 · 예산) 저장과 버전 관리 | ✅ 화면 입력 · 채팅 |
| **채팅 상담**(텍스트 + 선택지 칩) · 상담 이력 저장 · 빠진 조건 되묻기 | ✅ 규칙 기반 응답(Mock) |
| **상담 발화 이해(NLU)** — 의도 6종 · 조건(슬롯) 9종 | ✅ 규칙 기준선: 의도 정확도 0.903 · macro-F1 0.904 · 슬롯 F1 0.900 (가상 평가셋 72건). 3주차 학습 모델로 교체 — [ML_PLAN](docs/ML_PLAN.md) |
| VRAM 추정 · 보유 장비 업그레이드 진단 · 로컬 대 클라우드 GPU 손익분기 | ✅ 도구 API + 채팅 답(공식 · 가정을 응답에 함께 표시) |
| 견적서 인쇄 · PDF 저장 | ✅ 브라우저 인쇄(테스트 데이터 표시가 인쇄본에도 남음) |
| PostgreSQL + pgvector(벡터 DB) | ✅ 확장 켜짐 · 벡터 저장/거리 질의 테스트. 벡터 테이블 설계는 5주차 |
| 업무팀 4개 백그라운드 실행 · 설계와 검증 겹쳐 진행 · 후보별 병렬 검증 | ✅ 규칙 코드(Mock) |
| 실행 이벤트 실시간 표시(SSE) · 끊겼다 다시 붙으면 이어 받기 | ✅ |
| 예산 변경 시 최신 결과로 갱신 · 늦게 온 옛 결과 차단 | ✅ 테스트로 확인 |
| 참고 견적 · 가상 주문(중복 요청 방지) | ✅ 실제 결제 없음 |
| 같은 엔진에 기업 2곳(공개 견본 카탈로그 · 가상 기업 A) 연결 | ✅ 카탈로그 형식 · 판매 정책이 다름 |
| 음성 상담 | ⬜ 확장(구현하지 않음 — 받아쓴 문장을 같은 NLU 에 넣는 구조) |
| 실제 LLM 연결 | ⬜ 확장(붙일 자리만 있음) |
| 상담 결과 이메일 · 공유 링크 | ⬜ 확장(개인정보 — 고객 동의 기반으로 따로 설계) |
| 가격 비교 사이트 등 실시간 가격 수집 | ⛔ 하지 않음 — 이용 허락된 데이터만 쓰고, 없으면 '가격 미확인' |
| 2D 게임형 오피스 디자인 | ⬜ 상태 확인용 최소 화면만 |
| 실제 공식 상품 데이터 · 가격 | ⬜ 미수집 |
| 로그인 · 권한, AWS 배포 | ⬜ 미구현 |

## 빠른 시작

필요한 것: **Git**, **Docker Desktop**, 디스크 여유 공간 **10GB 이상**. (Python · Node · PostgreSQL 은 따로 설치하지 않습니다.)

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
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 구조 · API · 이벤트 · DB 계약 · 채팅/NLU |
| [docs/ML_PLAN.md](docs/ML_PLAN.md) | 3주차 ML — 의도 분류 · 슬롯 추출 데이터 · 라벨 기준 · 지표 · 기준선 점수 · 결과서 목차 |

## 2026-11-12 팀 합의 결정

PM 과 팀원 전원이 2026-11-12 에 합의한 결정과, 그에 맞춰 저장소에서 바꾼 것입니다.

| # | 결정 | 왜 | 저장소에서 바꾼 것 |
|---|---|---|---|
| 1 | 제품 한 줄을 "판매 기업이 상품 DB · 판매 정책을 연결하면 추천 · 호환성 검증 · 견적까지 처리하는 AI 상담 직원 플랫폼(B2B2C)" 으로, 첫 시연을 **AI 개발 입문자 개발 장비 상담**으로 | 시연 시나리오를 한 사용자층에 맞춰 구체적으로 보여 주려고 | README · AGENTS.md 소개, 하드웨어 규칙(VRAM · 진단 · 클라우드 비교) |
| 2 | DB 를 **MySQL → PostgreSQL + pgvector 하나로**. OpenSearch · Redis 는 쓰지 않음(필요해지면 확장) | 5주차 '벡터DB 구축 결과서'가 캠프 필수 산출물 — 관계형 데이터와 벡터를 한 DB 에서. 운영할 저장소를 늘리지 않음 | `compose.yaml` · CI 의 DB 이미지, 드라이버 psycopg 3, JSON → JSONB, Alembic 0001 을 PostgreSQL 기준으로 다시 씀(`CREATE EXTENSION vector` 포함), 동시성 · 벡터 테스트 |
| 3 | 프론트는 **React + TypeScript + Vite 유지**(Next.js 아님) | 이미 계약 → 타입 자동 생성 · 테스트가 이 구조로 돌아감 | 변경 없음 |
| 4 | 3주차 ML/DL 모델 = **상담 발화 의도 분류 + 조건(슬롯) 추출** | 채팅 상담이 업무팀 실행으로 이어지는 핵심 단계라서 | `backend/app/nlu/` 인터페이스 · 규칙 기준선 · 지표 · 평가 스크립트, `data/nlu/` 평가셋 72건, [ML_PLAN](docs/ML_PLAN.md) |
| 5 | MVP 입력은 **텍스트 채팅 + 클릭 선택지(Quick Reply)**, 음성은 확장 | 시연 안정성 · 비용 | 채팅 API 2개 · `chat_messages` 테이블 · 채팅 패널 |
| 6 | 실시간 가격 수집은 하지 않음(이용 허락된 데이터만, 없으면 '가격 미확인'). 이메일 발송 · 공유 링크는 이번에 구현하지 않음 | 이용 약관 · 개인정보 | 클라우드 가격은 가상 견본(`data_status=test`), 가격 없으면 '가격 미확인' 표시, 이메일 · 공유는 문서에 '확장 · 동의 기반'으로만 |

### 새로 생긴 API · 테이블

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| POST | `/api/sessions/{id}/messages` | 채팅 메시지 보내기 → NLU → 되묻기(선택지) 또는 요구사항 새 버전 + 업무팀 실행 |
| GET | `/api/sessions/{id}/messages` | 채팅 상담 이력 |
| POST | `/api/tools/vram-estimate` | 모델 크기 · 정밀도 · 추론/LoRA → 필요 VRAM(공식 · 가정 포함) |
| POST | `/api/tools/diagnose` | 보유 장비(직접 입력 또는 카탈로그 상품코드) → 업그레이드로 충분 / 새 장비 필요 |
| POST | `/api/tools/cloud-compare` | 가상 클라우드 GPU 가격 견본 + 주당 사용 시간 → 월 비용 · 손익분기 개월 |

테이블 `chat_messages`(company_id · session_id · role · content · quick_replies · nlu · created_at) — 마이그레이션 `0002`.
상품 견본에 램 온보드 여부 · 최대 램 · 빈 램 슬롯 · 빈 M.2 슬롯을 추가했고(가상 값), 클라우드 GPU 가격 견본(`data/fixtures/cloud_gpu_prices.json`, 가상 공급자 3곳)을 넣었습니다.

### 버전 고정 근거 (2026-11-12 레지스트리 실측)

"이 PC 가 아니라 프로젝트 기준": AWS RDS PostgreSQL 이 지원하는 가장 새 메이저이면서 pgvector 공식 이미지가 있는 판, 그중 **2주 이상 된** 정확한 태그를 골랐습니다.

| 항목 | 고정 값 | 확인한 방법과 결과 |
|---|---|---|
| DB 이미지 | `pgvector/pgvector:0.8.6-pg18-trixie` (PostgreSQL 18.6 · pgvector 0.8.6) | Docker Hub 태그 API(`hub.docker.com/v2/repositories/pgvector/pgvector/tags`) — 이 태그 마지막 푸시 2026-08-13, 다이제스트 `sha256:78bf48b801e7…`. 이미지 설정의 `PG_VERSION=18.6-1.pgdg13+2`(레지스트리 매니페스트 조회). 0.8.7 태그는 2026-10-31 푸시라 2주가 안 돼 제외, `pg19` 태그는 없음(PostgreSQL 19 는 아직 RC) |
| AWS RDS 지원 | PostgreSQL 18 | AWS 문서 'Release calendars for Amazon RDS for PostgreSQL' — 18 은 2025-11-14 RDS 출시, 18.6 지원. RDS 18.6 의 pgvector 는 0.8.2(로컬 0.8.6 과 다름 — 지금 쓰는 vector 타입 · 거리 연산은 둘 다 지원, 인덱스 같은 기능을 쓸 때 RDS 판을 다시 확인) |
| 드라이버 | `psycopg[binary]==3.3.6` | PyPI JSON — 2026-09-18 업로드, Python 3.14 휠(Windows x64 · Linux x86_64/aarch64 · macOS arm64) 있음. 3.3.7 · 3.3.8 은 2026-11-03 · 04 업로드라 제외 |
| 벡터 파이썬 | `pgvector==0.5.1` | PyPI — 2026-10-09 업로드, 순수 파이썬 휠, 필수 의존성 없음(numpy 불필요) |
| lockfile | `backend/uv.lock` | 패키지 추가 · 제거(psycopg · psycopg-binary · pgvector · tzdata ↔ pymysql · cryptography · cffi · pycparser) 외에는 기존 내용과 같음을 확인. CI 의 uv 0.13.7 `uv sync --frozen` 으로 설치 통과 |

### 2026-11-12 검증 결과

| 환경 | 무엇을 돌렸나 | 결과 |
|---|---|---|
| GitHub Actions(수동 실행 `workflow_dispatch`, 실행 번호 43142412975) — Ubuntu 24.04 · PostgreSQL 18 + pgvector 서비스 | 백엔드 린트 · 포맷 · 견본 데이터 · NLU 평가 · `alembic upgrade`/`check` · pytest | 통과 — pytest **91 passed**(기존 29개 포함), NLU 의도 정확도 0.903 · macro-F1 0.904 · 슬롯 F1 0.900 |
| 같은 실행 — 통합 | `docker compose up --wait`(pgvector 이미지) → `scripts/check.sh` 12단계 → Playwright | 통과 — 12/12 PASS, 브라우저 2 passed(기존 흐름 + 채팅 → 선택지 → 견적) |
| 같은 실행 — 계약 · 프론트 · 윈도우 · 비밀값 | 계약 파일 재생성 비교 · eslint · prettier · tsc · vitest · build · PowerShell 5.1 · gitleaks | 통과 — vitest 9 passed |
| 작업 PC | Docker 를 쓰지 않음(디스크 부족) — DB 없는 테스트 · ruff 만 | DB 없는 pytest 58 passed, ruff check · format 통과 |

## 이번에 한 일과 통합 방식 (2026-11-11, PM)

> 이 절은 초기 환경을 세우면서 무엇을 했는지 기록한 것입니다. 팀이 자리를 잡으면 줄이거나 다른 문서로 옮겨도 됩니다.
> 2026-11-12 결정으로 DB(MySQL → PostgreSQL) · API 수 · 테이블 수 · 테스트 수가 바뀌었습니다 — 최신은 위 [2026-11-12 팀 합의 결정](#2026-11-12-팀-합의-결정)과 아래 기술 스택 표.

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
| 개인 브랜치 + `dev` | `main` + 작업마다 짧은 기능 브랜치(`이니셜/영역-내용`, 예: `hgd/office-desk-log`) | 오래 사는 개인 브랜치는 합칠 때 충돌이 커집니다. 작업마다 브랜치를 만들고 PR 로 `main` 에 합칩니다. `main` 은 보호(PR · CI · 승인 1명) |
| 옛 브랜치 5개 | `archive/pre-buildwise-2026-11-11` 태그로 보존 후 정리 | 필요하면 태그에서 언제든 다시 꺼낼 수 있습니다 |
| 루트 README | 이 README | |
| 이슈 #2 (문서화) | `docs/` 폴더 6개 문서 | 프로젝트 문서는 `docs/` 에 모읍니다. 이슈는 문서화 담당이 계속 이어 갑니다 |

### 새로 만든 것

- **실행 환경:** `compose.yaml` 하나로 DB(당시 MySQL 8.4, 2026-11-12 부터 PostgreSQL 18 + pgvector) · 백엔드 · 프론트가 함께 켜집니다. `.env` 없이 기본값으로 실행되고, 처음 켤 때 DB 마이그레이션과 견본 데이터가 자동으로 들어갑니다.
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
| DB 도구 | SQLAlchemy 2.1.8 · Alembic 1.20.1 · psycopg 3.3.6(binary) · pgvector 0.5.1 | 마이그레이션 필수 규칙을 도구로 지킴, psycopg 는 OS 별 미리 빌드된 휠이 있어 설치가 단순 (2026-11-12 PyMySQL 에서 바꿈) |
| DB | PostgreSQL 18.6 + pgvector 0.8.6 (`pgvector/pgvector:0.8.6-pg18-trixie`) | 벡터 DB 를 같은 DB 에서(5주차), AWS RDS 가 지원하는 가장 새 메이저 — 근거는 위 '버전 고정 근거' (2026-11-12 MySQL 8.4 에서 바꿈) |
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
3. 공식 공개 자료로 실제 상품 데이터 수집(출처 · 이용 허락 범위 기록, 가격 미확인은 미확인으로 — 실시간 가격 수집은 하지 않음)
4. 3주차: NLU 학습 데이터 수집 · 라벨 · 학습 모델 교체([ML_PLAN](docs/ML_PLAN.md)) / 5주차: pgvector 벡터 테이블 설계 · 결과서
5. LLM 연결 범위 결정(요구사항 구조화 · 추가 질문 · 비교 설명) — 검색 · 필터 · 계산은 코드 유지. 음성 상담은 확장
6. 2D 게임형 오피스 디자인(입력은 지금의 `OfficeState` 그대로)
7. AWS 배포 경로 결정

## 폴더 구조

```text
backend/            FastAPI 백엔드 (app/ · migrations/ · tests/)
frontend/           React 화면 (src/features/ · src/events/ · src/api/ · e2e/)
contracts/          자동 생성된 API · 이벤트 계약 (직접 고치지 않음)
data/fixtures/      가상 견본 데이터 (상품 · 기업 정책 · 클라우드 GPU 가격)
data/nlu/           상담 발화 평가셋 (가상 발화 · 의도 · 슬롯 정답)
scripts/            dev · check · stop · reset · gen-contracts (.ps1 / .sh)
docs/               안내서 · 규칙 · 구조
.github/            CI · PR 템플릿
compose.yaml        개발 환경 전체 실행
AGENTS.md           AI 코딩 도구 공통 규칙 (CLAUDE.md 는 이것을 불러옴)
```

폴더별 역할은 [docs/ARCHITECTURE.md §2](docs/ARCHITECTURE.md#2-폴더-역할).
