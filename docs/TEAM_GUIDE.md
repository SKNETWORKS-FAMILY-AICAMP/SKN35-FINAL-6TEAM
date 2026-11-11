# 5명이 함께 개발하는 방법 (TEAM_GUIDE)

처음 설치는 [START_HERE.md](START_HERE.md) 를 먼저 끝내고 오세요. 이 문서는 **매일 개발할 때** 보는 문서입니다.
명령은 Windows PowerShell · macOS 터미널 모두 같습니다(다른 곳만 따로 적었습니다).

## 0. 용어 한 줄 정리

| 용어 | 한 줄 뜻 |
|---|---|
| GitHub | 팀의 공용 코드 보관함 |
| 저장소(repository) | 프로젝트 폴더 하나 — 우리는 `SKN35-FINAL-6TEAM` |
| Clone | 공용 보관함의 프로젝트를 내 PC 로 복사하는 것 |
| Branch(브랜치) | 다른 사람 작업을 건드리지 않고 내 작업 공간을 따로 만드는 것 |
| Commit(커밋) | 지금까지 고친 내용을 기록하는 저장 지점 |
| Push(푸시) | 내 커밋을 GitHub 로 올리는 것 |
| Pull(풀) | GitHub 의 최신 내용을 내 PC 로 가져오는 것 |
| Pull Request(PR) | "내 작업을 공용 프로젝트(main)에 합쳐 주세요" 라는 요청 |
| Merge(병합) | PR 을 받아들여 main 에 합치는 것 |
| Conflict(충돌) | 두 사람이 같은 줄을 다르게 고쳐서 git 이 어느 쪽을 쓸지 모르는 상황 |
| main | 언제나 잘 돌아가는 공용 버전. 직접 고치지 않습니다 |

## 1. 하루 작업 순서

```text
최신 main 받기 → 새 브랜치 → AI 와 작업 → 바뀐 파일 확인 → 검사 → 커밋 → 푸시 → PR → 리뷰 · 병합
```

## 2. 처음 기능 개발 시작하기

**지금 하는 일:** main 을 최신으로 맞추고, 내 작업용 브랜치를 만듭니다.

```bash
git switch main
git pull
git switch -c feat/office-desk-log
```

- 브랜치 이름: `종류/영역-내용` — `feat`(새 기능) · `fix`(버그) · `docs`(문서) · `chore`(설정 · 정리)
- 예: `feat/consultation-voice`, `fix/quote-shipping-fee`, `docs/start-here-mac`

**성공하면:** `Switched to a new branch 'feat/office-desk-log'`
**실패하면:** `error: Your local changes ... would be overwritten` → 아직 커밋 안 한 변경이 있다는 뜻입니다. [14번](#14-실수로-main-에서-작업했을-때)을 보세요.

## 3. Claude Code 또는 Codex 에 일 맡기기

두 도구 모두 저장소 맨 위의 `AGENTS.md` 규칙을 읽습니다(Claude Code 는 `CLAUDE.md` 를 통해).
아래처럼 **범위 · 규칙 · 확인 방법**을 같이 말해 주면 결과가 훨씬 안정적입니다.

```text
frontend/src/features/office/ 안에서만 작업해 줘.
검증팀 칸을 누르면 후보별 검증 결과(통과/탈락과 이유)가 보이게 하고 싶어.
1) 먼저 관련 파일을 읽고 바꿀 파일 목록과 이유를 알려 줘. 내가 확인하면 시작해.
2) 공통 계약(backend/app/contracts, frontend/src/api/schema.d.ts)은 바꾸지 마.
3) 끝나면 docker compose exec -T frontend npm test 와 npm run lint 를 돌리고 결과를 그대로 보여 줘.
```

AI 가 "프로젝트를 새로 만들자", "package.json 을 다시 쓰자" 고 하면 멈추세요(규칙 10 · 12).

## 4. 바뀐 파일 확인하기

```bash
git status          # 어떤 파일이 바뀌었는지
git diff            # 무엇이 바뀌었는지(줄 단위). q 를 누르면 나갑니다
```

**확인할 것:** 내가 부탁한 범위 밖의 파일이 바뀌지 않았는지. 특히 `compose.yaml`, `package.json`, `pyproject.toml`, lockfile, `.github/`.
범위 밖 파일을 되돌리려면:

```bash
git restore 파일경로
```

## 5. 검사하기

컨테이너가 켜져 있어야 합니다(`scripts/dev.ps1` 또는 `scripts/dev.sh`).

| Windows PowerShell | macOS · Linux |
|---|---|
| `.\scripts\check.ps1` | `./scripts/check.sh` |

**성공하면:** 마지막에 `모두 통과했습니다.`
**실패하면:** `FAIL` 이 붙은 단계 바로 위의 오류를 읽습니다. 자세한 행동은 [QA_GUIDE.md](QA_GUIDE.md).

## 6. 커밋하기

파일을 **이름으로 골라서** 담습니다(`git add .` 는 엉뚱한 파일까지 담기 쉬워 쓰지 않습니다).

```bash
git add frontend/src/features/office/OfficeBoard.tsx frontend/src/features/office/officeState.ts
git commit -m "검증팀 칸에 후보별 검증 결과 표시"
```

커밋 메시지는 한국어 한 줄로 **무엇을 했는지** 씁니다. "수정", "ㅇㅇ" 같은 메시지는 쓰지 않습니다.

## 7. GitHub 에 올리기(푸시)

```bash
git push -u origin feat/office-desk-log
```

처음 한 번만 `-u origin 브랜치이름` 을 붙이고, 그다음부터는 `git push` 만 치면 됩니다.

## 8. PR 만들기

1. 푸시하면 GitHub 저장소 화면 위쪽에 노란 띠로 **Compare & pull request** 버튼이 보입니다. 누릅니다.
2. base 가 `main`, compare 가 내 브랜치인지 확인합니다.
3. 템플릿의 빈칸(무엇을 · 왜 · 공통 파일 · 확인한 것)을 채우고 **Create pull request**.
4. 아래 **Checks** 에 CI 결과가 나옵니다. 빨간 X 면 [QA_GUIDE.md](QA_GUIDE.md) 를 보고 고친 뒤 다시 푸시합니다(같은 PR 에 자동으로 붙습니다).

리뷰어는 1명 이상 승인해야 합니다. 승인 + CI 통과가 되면 **Squash and merge** 로 합칩니다.

## 9. 리뷰하는 사람이 볼 것

- PR 설명대로 바뀌었는지, 범위 밖 파일이 없는지
- 공통 계약 · DB · 공유 설정을 건드렸다면 팀에 미리 이야기됐는지
- CI 가 초록색인지 — 빨간데 승인하지 않습니다
- 궁금하면 질문을 남깁니다. 승인은 **Files changed → Review changes → Approve**

## 10. 다른 사람 작업 가져오기

다른 사람 PR 이 main 에 합쳐지면, 내 브랜치에도 그 내용을 섞어 줍니다.

```bash
git switch main
git pull
git switch feat/office-desk-log
git merge main
```

**성공하면:** 편집기가 열리면 저장하고 닫거나(기본 메시지), `Already up to date` 가 나옵니다.
**충돌이 나면:** 다음 절.

병합된 내 브랜치는 그 뒤로 쓰지 않습니다. **다음 작업은 최신 main 에서 새 브랜치**로 시작합니다.

## 11. 충돌 해결하기

`CONFLICT (content): Merge conflict in 파일` 이 나오면:

1. VS Code 로 그 파일을 엽니다. 아래 같은 표시가 보입니다.

   ```text
   <<<<<<< HEAD
   내 브랜치의 내용
   =======
   main 에서 온 내용
   >>>>>>> main
   ```

2. 둘 중 하나를 고르거나 둘을 합쳐 **올바른 최종 내용만 남기고** `<<<<<<<` `=======` `>>>>>>>` 줄을 지웁니다.
   VS Code 의 **Accept Current / Accept Incoming / Accept Both** 버튼을 써도 됩니다.
3. 검사를 다시 돌리고 저장합니다.

```bash
git add 충돌난파일
git commit -m "main 병합 충돌 해결"
git push
```

모르겠으면 `git merge --abort` 로 병합 전 상태로 돌아가 팀원에게 물어봅니다. 남의 코드를 지워서 해결하지 않습니다.

## 12. 공통 API 를 바꿔야 할 때

API 필드 · 이벤트 타입 · 상태값은 5명이 함께 쓰는 약속입니다.

1. 팀 채팅에 먼저 알립니다: "`QuotationOut` 에 `delivery_days` 필드를 추가하려고 합니다. 이유: …"
2. 동의를 받으면 **계약 변경만 담은 PR** 을 따로 만듭니다(`feat/contract-delivery-days`).
3. `backend/app/contracts/schemas.py` 를 고치고 계약 파일을 다시 만듭니다.

   | Windows PowerShell | macOS · Linux |
   |---|---|
   | `.\scripts\gen-contracts.ps1` | `./scripts/gen-contracts.sh` |

4. 바뀐 `contracts/*` 와 `frontend/src/api/schema.d.ts` 를 같은 PR 에 커밋합니다. 빼먹으면 CI '계약' 잡이 실패합니다.
5. 필드를 **지우거나 이름을 바꾸는** 변경은 쓰는 쪽 코드를 같은 PR 에서 함께 고칩니다.

## 13. DB 컬럼을 추가해야 할 때

1. 팀에 알립니다(규칙 5).
2. `backend/app/db/models.py` 를 고칩니다.
3. 마이그레이션 파일을 만듭니다.

   ```bash
   docker compose exec backend uv run --frozen alembic revision --autogenerate -m "견적에 배송 예정일 추가"
   ```

4. `backend/migrations/versions/` 에 새로 생긴 파일을 **직접 열어** 의도한 변경만 있는지 확인합니다.
5. 적용하고 확인합니다.

   ```bash
   docker compose exec backend uv run --frozen alembic upgrade head
   docker compose exec backend uv run --frozen alembic check
   ```

6. API 에도 보여야 하면 12번 절차를 이어서 합니다. `docs/ARCHITECTURE.md` 의 DB 표도 고칩니다.

이미 main 에 들어간 마이그레이션 파일은 고치지 않습니다. 고칠 게 있으면 새 마이그레이션을 하나 더 만듭니다.

## 14. 실수로 main 에서 작업했을 때

`git push` 가 `protected branch` 오류로 막혔거나, main 에서 고친 걸 알아챘다면:

```bash
git switch -c feat/내작업이름          # 지금까지 한 변경(커밋 포함)을 새 브랜치로 그대로 가져갑니다
git branch -f main origin/main        # 내 PC 의 main 을 GitHub 상태로 되돌립니다(작업은 새 브랜치에 남아 있음)
git push -u origin feat/내작업이름
```

그다음 8번(PR 만들기)부터 이어 갑니다. 모르겠으면 아무것도 지우지 말고 팀원에게 화면을 보여 주세요.

## 15. 도움 요청하기

막히면 30분 안에 물어보는 게 혼자 3시간 헤매는 것보다 낫습니다. 아래 형식으로 팀 채팅에 올려 주세요.

```text
[도움 요청] 무엇을 하다가: scripts/dev.ps1 실행
어디서 막힘: [2/3] 단계에서 실패
오류 메시지(그대로 복사): ...
내 환경: Windows 11 / Docker Desktop 4.xx / 브랜치 feat/...
이미 해 본 것: TROUBLESHOOTING 의 '포트가 이미 사용 중' 확인
```

## 16. 담당표 (역할이 정해지면 채웁니다)

| 영역 | 폴더 | 담당 |
|---|---|---|
| 상담 · 음성 | `frontend/src/features/consultation/`, `backend/app/agents/consultation.py` | (미정) |
| 오피스 화면 | `frontend/src/features/office/` | (미정) |
| 설계 · 검증 엔진 | `backend/app/agents/`, `backend/app/workflows/` | (미정) |
| 하드웨어 데이터 · 규칙 | `backend/app/domains/hardware/`, `data/fixtures/` | (미정) |
| 견적 · 주문 | `backend/app/agents/quotation.py`, `backend/app/orders/`, `frontend/src/features/quotations/`, `orders/` | (미정) |
| 공통 계약 · DB · CI | `backend/app/contracts/`, `backend/app/db/`, `.github/` | PM |
