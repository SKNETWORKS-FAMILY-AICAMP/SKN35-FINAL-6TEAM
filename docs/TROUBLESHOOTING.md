# 자주 막히는 문제 (TROUBLESHOOTING)

> 이 문서는 기존 Mock 앱의 기록입니다. 현재 로컬 DB의 설치·검사 방법은 [DB 작업 안내](database/README.md)를 참고하세요.

증상을 찾아 **확인 → 해결** 순서로 따라 하세요. 여기 없으면 [TEAM_GUIDE §15](TEAM_GUIDE.md#15-도움-요청하기) 형식으로 팀에 물어보세요.

먼저 상태부터 봅니다. 문제 대부분이 여기서 보입니다.

```bash
docker compose ps                         # 세 컨테이너(db · backend · frontend)가 healthy 인지
docker compose logs backend --tail 50     # 백엔드 마지막 로그
docker compose logs frontend --tail 50
docker compose logs db --tail 50
```

---

## 1. Docker 가 실행되지 않음

**증상:** `Docker Desktop 이 꺼져 있습니다` / `error during connect` / `Cannot connect to the Docker daemon`

**해결**
1. Docker Desktop 을 켜고 왼쪽 아래가 **Engine running** 이 될 때까지 기다립니다(1~2분).
2. Windows 에서 Docker Desktop 이 "WSL 2 is not installed" 라고 하면 PowerShell 을 **관리자 권한**으로 열고:

   ```powershell
   wsl --install
   ```

   재부팅 뒤 Docker Desktop 을 다시 켭니다.
3. "Virtualization support not detected" 가 나오면 BIOS 에서 가상화(Intel VT-x / AMD-V · SVM)를 켜야 합니다. 학원 PC 라면 관리자에게 문의하세요.

## 2. 포트가 이미 사용 중

**증상:** `Bind for 0.0.0.0:8000 failed: port is already allocated` / `ports are not available`

**확인**

| Windows PowerShell | macOS · Linux |
|---|---|
| `netstat -ano \| findstr :8000` | `lsof -i :8000` |

Windows 에서는 Hyper-V 가 포트 묶음을 미리 잡아 두는 경우도 있습니다.

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

**해결:** 그 프로그램을 끄거나, 저장소 맨 위에 `.env` 를 만들어 포트를 바꿉니다(.env.example 참고).

```text
WEB_PORT=5174
API_PORT=8001
DB_PORT=3308
```

바꾼 뒤 `scripts/stop` → `scripts/dev` 로 다시 켭니다. 화면 주소도 바뀐 포트로 엽니다.

## 3. DB 에 연결되지 않음

**증상:** 백엔드 로그에 `Can't connect to MySQL server` / `Access denied for user 'buildwise'`

**확인:** `docker compose ps` 에서 `db` 가 `healthy` 인지. 처음 켤 때는 MySQL 준비에 30초쯤 걸립니다.

**해결**
- `starting` 이면 조금 기다렸다 `scripts/dev` 를 다시 실행합니다.
- `.env` 의 DB 비밀번호를 **나중에 바꿨다면** 기존 DB 볼륨은 옛 비밀번호를 기억합니다 → `scripts/reset`(개발 DB 초기화) 후 다시 켭니다.
- Docker 없이 `uv run` 으로 백엔드를 직접 돌린다면 DB 주소는 `127.0.0.1:3307` 입니다(Compose 의 DB 가 켜져 있어야 함).

## 4. 환경변수 파일(.env)이 없음

**.env 가 없어도 실행됩니다.** 기본값이 `compose.yaml` 에 들어 있습니다.
값을 바꾸고 싶을 때만 만듭니다.

| Windows PowerShell | macOS · Linux |
|---|---|
| `Copy-Item .env.example .env` | `cp .env.example .env` |

`.env` 는 커밋되지 않습니다(.gitignore). API 키는 여기에만 넣습니다.

## 5. GitHub 로그인 · 인증 실패

**증상:** `Authentication failed` / `Permission denied` / `remote: Repository not found` / `403`

**해결**
1. GitHub 에서 저장소 **초대를 수락**했는지 확인합니다(GitHub 알림 또는 메일).
2. Windows: Git for Windows 에 들어 있는 Git Credential Manager 가 처음 push · clone 때 **브라우저 로그인 창**을 띄웁니다. 그 창에서 로그인합니다.
3. macOS: 비밀번호 대신 토큰이 필요합니다. GitHub CLI 를 쓰면 가장 쉽습니다.

   ```bash
   brew install gh
   gh auth login
   ```

4. 다른 계정으로 로그인돼 있으면 Windows 는 **자격 증명 관리자 → Windows 자격 증명** 에서 `git:https://github.com` 을 지우고 다시 시도합니다.

## 6. 브랜치를 잘못 선택함

**확인:** `git branch` — 별표(`*`)가 붙은 것이 지금 브랜치입니다.

**해결**
- 커밋 전이면 그대로 옮겨 갑니다: `git switch -c feat/새이름` (변경 내용이 따라옵니다)
- main 에서 커밋까지 했으면: [TEAM_GUIDE §14](TEAM_GUIDE.md#14-실수로-main-에서-작업했을-때)
- 다른 기능 브랜치에 커밋했으면: 팀원과 같이 `git cherry-pick` 으로 옮깁니다(혼자 하지 마세요).

## 7. Git 충돌

[TEAM_GUIDE §11](TEAM_GUIDE.md#11-충돌-해결하기) 을 따라 합니다. 모르겠으면 `git merge --abort` 로 되돌리고 물어보세요.

## 8. 패키지 설치 실패 · "module not found"

**증상:** 백엔드 `ModuleNotFoundError`, 프론트 `Cannot find module` / `Failed to resolve import`

**해결**
1. 누군가 의존성을 추가했을 수 있습니다. 최신 main 을 받은 뒤 다시 켭니다: `scripts/dev` (lockfile 이 바뀌면 컨테이너가 시작할 때 자동으로 다시 설치합니다).
2. 그래도 안 되면 의존성 볼륨까지 지우고 이미지를 다시 만듭니다.

   ```bash
   docker compose down -v
   docker compose build --no-cache
   docker compose up -d --wait
   ```

   (`down -v` 는 내 PC 의 개발 DB 도 지웁니다. 견본 데이터는 켜질 때 다시 들어갑니다.)
3. 학원 · 회사 네트워크에서 다운로드가 막히면 다른 네트워크(휴대폰 테더링 등)로 한 번 시도해 봅니다.

## 9. Windows 와 macOS 에서 결과가 다름

| 원인 | 확인 · 해결 |
|---|---|
| 줄바꿈(CRLF/LF) | 저장소가 `.gitattributes` 로 LF 를 강제합니다. VS Code 오른쪽 아래가 `CRLF` 면 `LF` 로 바꿔 저장 |
| 파일 이름 대소문자 | Windows · macOS 는 `Office.tsx` 와 `office.tsx` 를 같은 파일로 봅니다(Linux CI 는 다르게 봄). 이름을 바꿀 땐 `git mv` 로 |
| 셸 스크립트 실행 권한 | macOS 에서 `Permission denied` 면 `bash scripts/dev.sh` 처럼 앞에 `bash` 를 붙입니다 |
| Apple Silicon(M 칩) | 우리가 쓰는 이미지는 arm64 도 제공됩니다. 그래도 이미지 오류가 나면 Docker Desktop 을 최신으로 |
| 로컬 Python · Node 버전 | Docker 로 실행하면 상관없습니다. 로컬에서 직접 돌릴 때만 `uv` 와 Node 24 를 씁니다 |

**macOS 는 아직 실제로 검증하지 않았습니다.** macOS 팀원이 처음 따라 해 본 결과(막힌 곳 포함)를 이 문서에 추가해 주세요.

## 10. AI 도구가 공통 설정 파일을 바꿨음

**확인:** `git status` 에 `compose.yaml`, `package.json`, `package-lock.json`, `pyproject.toml`, `uv.lock`, `tsconfig.json`, `.github/` 등이 보임

**해결**
1. 정말 필요한 변경인지 AI 에게 이유를 묻습니다.
2. 필요 없으면 되돌립니다.

   ```bash
   git restore compose.yaml package.json
   ```

3. 필요하면 PR 템플릿의 "공유 설정" 칸에 체크하고 팀에 알립니다([규칙 10](DEVELOPMENT_RULES.md#10-공유-설정-파일을-다시-만들지-않는다)).

## 11. PowerShell 이 스크립트 실행을 막음

**증상:** `이 시스템에서 스크립트를 실행할 수 없으므로 ... 로드할 수 없습니다` / `running scripts is disabled on this system`

**해결(둘 중 하나)**

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1
```

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

스크립트를 아예 쓰지 않고 같은 일을 할 수도 있습니다: `docker compose up -d --build --wait`

## 12. 한글이 깨져 보임

- `scripts/*.ps1` 은 Windows PowerShell 5.1 을 위해 UTF-8 BOM 으로 저장돼 있습니다. 편집기에서 인코딩을 바꿔 저장하지 마세요(.editorconfig 가 지켜 줍니다).
- Windows 에서 `uv run python ...` 출력 한글이 깨지면: `$env:PYTHONUTF8 = 1` 을 먼저 실행합니다.

## 13. 코드를 고쳤는데 화면 · 서버에 반영이 안 됨

- 저장 후 몇 초 기다립니다(Windows 는 폴링 방식으로 변경을 감지해서 1~2초 늦습니다).
- 그래도 안 되면: `docker compose restart backend` 또는 `docker compose restart frontend`
- 브라우저는 새로고침(Ctrl+F5).

## 14. 서버를 다시 켰더니 작업이 '실패(SERVER_RESTART)'

정상입니다. 코드 저장으로 서버가 다시 켜지면 진행 중이던 작업은 이어지지 않습니다.
화면의 **다시 시도** 버튼을 누르거나 요구사항을 다시 보냅니다.

## 15. 디스크 공간 부족

```bash
docker system df          # Docker 가 쓰는 공간
docker builder prune      # 빌드 캐시 정리(다시 만들 수 있는 것만)
```

`docker system prune -a --volumes` 는 다른 프로젝트 데이터까지 지울 수 있으니 쓰지 마세요.

## 16. 로컬에서 `uv` 가 "required version" 오류

```text
error: Required uv version `>=0.13` does not match the running version
```

```bash
uv self update
```
