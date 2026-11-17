# 처음 오신 분은 여기부터 (START_HERE)

> 이 문서는 기존 Mock 앱의 기록입니다. 현재 로컬 DB의 설치·검사 방법은 [DB 작업 안내](database/README.md)를 참고하세요.

이 문서만 순서대로 따라 하면 내 PC 에서 BUILDWISE 를 켜고, 화면을 보고, 검사까지 돌릴 수 있습니다.
처음에는 30분~1시간 정도 걸립니다(대부분 설치와 다운로드 시간).

- 명령은 회색 상자 안에 있습니다. 상자 오른쪽 위 복사 버튼으로 복사해서 붙여 넣으세요.
- **Windows** 는 `PowerShell`, **macOS** 는 `터미널` 에 입력합니다. 둘이 다른 곳은 따로 적었습니다.
- 각 단계마다 **성공하면 보이는 것**이 있습니다. 다르게 나오면 **실패하면** 칸을 보세요.

### 이 안내서를 실제로 돌려 본 환경

| 환경 | 상태 (2026-11-11) |
|---|---|
| Ubuntu 24.04 (GitHub Actions) | **확인함** — `docker compose up -d --build --wait` → `scripts/check.sh` 12단계 모두 PASS → 브라우저 테스트 통과 |
| Windows (GitHub Actions, PowerShell 5.1) | `scripts/*.ps1` 구문 검사 · 윈도우에서 프론트 빌드/테스트 통과. **Docker Desktop 으로 끝까지 켜 본 것은 아직** (첫 시도 PC 의 디스크 부족으로 중단) |
| macOS | **아직 확인하지 않음** |

Windows · macOS 에서 처음 해 보는 분은 막힌 곳과 해결 방법을 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) 에 추가해 주세요.
Docker 이미지와 의존성으로 **디스크 여유 공간이 10GB 이상** 필요합니다.

---

## 1. GitHub 계정 준비

**지금 하는 일:** 팀 코드 보관함(GitHub)에 들어갈 계정을 만듭니다.

1. https://github.com 에서 **Sign up** 으로 가입합니다(이미 있으면 건너뜀).
2. 내 아이디(예: `hong-gildong`)를 팀 채팅에 알려 줍니다. PM 이 저장소에 초대합니다.

**성공하면:** 오른쪽 위에 내 프로필 사진이 보입니다.

## 2. 프로젝트 초대 수락

**지금 하는 일:** 팀 저장소에 들어갈 권한을 받습니다.

1. GitHub 오른쪽 위 알림(종 모양) 또는 가입 메일에서 `SKN35-FINAL-6TEAM` 초대를 엽니다.
2. **Accept invitation** 을 누릅니다.

**성공하면:** https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN35-FINAL-6TEAM 에서 오른쪽 위 **Code** 버튼이 보입니다.
**실패하면:** 초대가 안 보이면 PM 에게 아이디를 다시 확인해 달라고 합니다. 초대는 7일이 지나면 만료됩니다.

## 3. Git 설치 · 내 이름 설정

**지금 하는 일:** 코드 기록 도구(Git)를 설치하고, 커밋에 남을 이름과 이메일을 정합니다.

**Windows** — PowerShell 에서:

```powershell
winget install --id Git.Git -e
```

설치가 끝나면 PowerShell 을 **닫았다가 다시 엽니다**.
(`winget` 이 없다고 나오면 https://git-scm.com/download/win 에서 설치 파일을 받아 기본값으로 설치합니다.)

**macOS** — 터미널에서:

```bash
xcode-select --install
```

**확인 (공통):**

```bash
git --version
```

**성공하면:** `git version 2.xx.x` 처럼 버전이 나옵니다.

**내 이름 · 이메일 설정.** 이 저장소는 **공개**라서 커밋에 남는 이메일이 누구에게나 보입니다. 개인 메일 대신 GitHub 가 주는 비공개 주소를 씁니다.

1. GitHub 오른쪽 위 프로필 사진을 누르고 **Settings** 메뉴의 **Emails** 로 가서 **Keep my email addresses private** 를 켭니다.
2. 그 아래에 보이는 `숫자+아이디@users.noreply.github.com` 주소를 복사합니다.
3. 아래 명령의 값을 내 것으로 바꿔 실행합니다.

```bash
git config --global user.name "내GitHub아이디"
git config --global user.email "123456+내GitHub아이디@users.noreply.github.com"
```

**실패하면:** `git` 을 찾을 수 없다고 나오면 PowerShell · 터미널을 새로 열었는지 확인합니다.

## 4. Docker 설치

**지금 하는 일:** 팀원마다 다른 PC 환경 차이를 없애 주는 실행 도구(Docker)를 설치합니다.
Docker 가 Python · Node · MySQL 을 **정해진 버전 그대로** 상자(컨테이너)에 담아 실행해 주기 때문에, 내 PC 에 따로 설치할 필요가 없습니다.

1. https://www.docker.com/products/docker-desktop/ 에서 내 OS 용 **Docker Desktop** 을 받아 설치합니다.
   - Windows: 설치 중 **Use WSL 2** 를 켠 상태로 둡니다.
   - macOS: M1~M4 칩이면 Apple Silicon 용을 받습니다.
2. Docker Desktop 을 실행하고, 왼쪽 아래가 **Engine running** 이 될 때까지 기다립니다.

**확인:**

```bash
docker version
docker compose version
```

**성공하면:** `Server:` 부분이 포함된 버전 정보와 `Docker Compose version v2...` 가 나옵니다.
**실패하면:** `Cannot connect to the Docker daemon` → Docker Desktop 이 아직 켜지는 중입니다. [TROUBLESHOOTING §1](TROUBLESHOOTING.md#1-docker-가-실행되지-않음)

## 5. (Windows 만) WSL2 확인

**지금 하는 일:** Docker Desktop 이 Windows 에서 쓰는 리눅스 엔진(WSL2)이 준비됐는지 봅니다. macOS 는 건너뜁니다.

```powershell
wsl --status
```

**성공하면:** `기본 버전: 2` (또는 `Default Version: 2`)가 보입니다.
**실패하면:** PowerShell 을 **관리자 권한으로 실행**해서 아래를 실행하고 재부팅합니다.

```powershell
wsl --install
```

## 6. 저장소 클론(내 PC 로 복사)

**지금 하는 일:** 팀 프로젝트를 내 PC 로 복사합니다.

> 클론할 위치: **OneDrive 로 동기화되는 폴더(바탕화면 · 문서가 OneDrive 인 경우)와 경로에 한글이 들어간 폴더는 피해 주세요.**
> Docker 가 파일 변경을 늦게 알아채거나 동기화 충돌이 날 수 있습니다. 예: `C:\dev`, `~/dev`

**Windows:**

```powershell
mkdir C:\dev -Force
cd C:\dev
git clone https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN35-FINAL-6TEAM.git
cd SKN35-FINAL-6TEAM
```

**macOS:**

```bash
mkdir -p ~/dev && cd ~/dev
git clone https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN35-FINAL-6TEAM.git
cd SKN35-FINAL-6TEAM
```

**성공하면:** `Cloning into 'SKN35-FINAL-6TEAM'...` 뒤에 `done.` 이 나오고, `git status` 를 치면 `On branch main` 이 보입니다.
**실패하면:** 로그인 창이 뜨면 GitHub 로 로그인합니다. `Repository not found` 면 2단계 초대 수락을 확인합니다. [TROUBLESHOOTING §5](TROUBLESHOOTING.md#5-github-로그인--인증-실패)

## 7. 프로젝트 폴더 열기

**지금 하는 일:** 편집기와 AI 코딩 도구로 프로젝트를 엽니다.

```bash
code .
```

- VS Code 가 열리고 오른쪽 아래에 **권장 확장 설치** 알림이 뜨면 **Install** 을 누릅니다(EditorConfig · Python · Ruff · ESLint · Prettier · Docker).
- Claude Code 나 Codex 도 **이 폴더에서** 실행합니다. 두 도구 모두 `AGENTS.md` 의 팀 규칙을 자동으로 읽습니다(Claude Code 는 `CLAUDE.md` 를 통해).

**실패하면:** `code` 를 찾을 수 없으면 VS Code 를 열고 **File → Open Folder** 로 `SKN35-FINAL-6TEAM` 폴더를 엽니다.

## 8. 환경변수 파일 준비 (지금은 건너뛰어도 됩니다)

**지금 하는 일:** 없음. **`.env` 파일 없이도 실행됩니다.** 기본값이 `compose.yaml` 에 들어 있습니다.

포트를 바꾸거나 나중에 API 키를 넣을 때만 만듭니다.

| Windows PowerShell | macOS |
|---|---|
| `Copy-Item .env.example .env` | `cp .env.example .env` |

`.env` 는 커밋되지 않습니다. **API 키는 여기에만** 넣고, 코드나 채팅에 붙여 넣지 않습니다.

## 9. Docker 로 프로젝트 실행

**지금 하는 일:** DB(MySQL) · 백엔드 · 프론트엔드 세 컨테이너를 한 번에 켭니다. 처음에는 이미지 다운로드 때문에 5~10분 걸립니다.

**Windows:**

```powershell
.\scripts\dev.ps1
```

**macOS:**

```bash
bash scripts/dev.sh
```

**성공하면:** 마지막에 아래가 나옵니다.

```text
[3/3] 준비 완료
  화면       http://localhost:5173
  API 문서   http://localhost:8000/docs
```

**실패하면:**
- `스크립트를 실행할 수 없으므로` → `powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1` ([TROUBLESHOOTING §11](TROUBLESHOOTING.md#11-powershell-이-스크립트-실행을-막음))
- `port is already allocated` → [TROUBLESHOOTING §2](TROUBLESHOOTING.md#2-포트가-이미-사용-중)
- 그 밖에는 `docker compose ps` 와 `docker compose logs backend --tail 50` 결과를 보고 [TROUBLESHOOTING](TROUBLESHOOTING.md) 에서 찾습니다.

스크립트를 쓰지 않고 같은 일을 하는 명령: `docker compose up -d --build --wait`

## 10. 브라우저에서 화면 확인

**지금 하는 일:** 실제로 돌아가는 화면을 봅니다.

http://localhost:5173 을 엽니다.

**성공하면:**
1. 위쪽에 `BUILDWISE` 와 노란 **테스트 데이터 · Mock 모드** 표시, 그 아래 **실시간 연결됨** 이 보입니다.
2. 왼쪽 상담 칸에서 사용 목적 `영상 편집`, 노트북, 예산 `2500000` 그대로 **요구사항 보내기** 를 누릅니다.
3. 가운데 **AI 오피스** 의 네 칸(상담팀 · 설계·분석팀 · 검증팀 · 견적·주문팀)이 차례로 `진행 중` → `완료` 로 바뀌고,
   추천 후보 표와 오른쪽 **참고 견적**(합계 2,190,000원)이 채워집니다.
4. 오른쪽 위 기업을 **가상 기업 A** 로 바꿔 같은 요구사항을 보내면 다른 상품 · 다른 견적(할인 · 배송비 규칙이 다름)이 나옵니다.

**실패하면:** `연결 끊김` 이 계속되면 `docker compose ps` 로 `backend` 가 healthy 인지 확인합니다.
백엔드 없이 화면만 보려면 http://localhost:5173/?mock=1 (가짜 이벤트 대본).

## 11. API 연결 확인

**지금 하는 일:** 백엔드가 응답하는지 직접 확인합니다.

**Windows:**

```powershell
Invoke-RestMethod http://localhost:8000/api/health
```

**macOS:**

```bash
curl http://localhost:8000/api/health
```

**성공하면:** `status: ok`, `mode: mock`, `database: ok` 가 보입니다.
API 전체 목록과 직접 호출해 보는 화면은 http://localhost:8000/docs 에 있습니다.

## 12. 테스트 실행

**지금 하는 일:** 우리 팀이 PR 전에 돌리는 전체 검사(12단계)를 돌립니다. 3~5분 걸립니다.

**Windows:**

```powershell
.\scripts\check.ps1
```

**macOS:**

```bash
bash scripts/check.sh
```

**성공하면:** 결과 표에 `PASS` 만 있고 마지막 줄이 `모두 통과했습니다.`
**실패하면:** `FAIL` 단계 바로 위 출력에 원인이 있습니다. 처음 받은 코드에서 실패했다면 내 PC 환경 문제일 가능성이 큽니다 — 출력을 복사해 팀에 알려 주세요. [QA_GUIDE](QA_GUIDE.md)

## 13. 서버 종료

**지금 하는 일:** 컨테이너를 끕니다. DB 데이터는 남습니다.

| Windows PowerShell | macOS |
|---|---|
| `.\scripts\stop.ps1` | `bash scripts/stop.sh` |

**성공하면:** `꺼졌습니다.`
DB 까지 처음 상태로 돌리고 싶으면 `scripts/reset.ps1` / `reset.sh` (내 PC 의 개발 DB 만 지웁니다).

## 14. 다음 날 다시 개발 시작하기

1. Docker Desktop 을 켭니다(Engine running 까지).
2. 프로젝트 폴더에서 최신 코드를 받습니다.

   ```bash
   git switch main
   git pull
   ```

3. 켭니다: `.\scripts\dev.ps1` (macOS: `bash scripts/dev.sh`)
4. 오늘 할 작업 브랜치를 만들고 시작합니다 → [TEAM_GUIDE.md](TEAM_GUIDE.md)

---

다음에 읽을 문서: [TEAM_GUIDE.md](TEAM_GUIDE.md) (매일 작업 방법) · [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) (팀 규칙) · [ARCHITECTURE.md](ARCHITECTURE.md) (구조)
