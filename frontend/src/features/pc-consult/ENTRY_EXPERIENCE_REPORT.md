# 밝은 시작 화면과 공통 색상 정리

2026-11-20. 시작 화면의 첫인상을 강화하고, 사용자가 요청한 밝은 색상을 개인·기업 화면까지 이어 적용했습니다.

## 화면 구성

- 아이보리 바탕, 짙고 읽기 쉬운 글자, 민트와 살구색 선택 카드를 사용합니다.
- 큰 제목 옆에 PC와 네 AI 팀을 한 장면으로 배치합니다. 팀을 선택하면 맡은 역할과 연결 경로를 보여 줍니다.
- 상품 DB와 판매 정책이 AI 상담팀에 연결된다는 설명을 첫 화면에 표시합니다.
- PC의 유리·금속·내부 부품 일러스트에 밝은 받침과 팀 카드를 조합했습니다. 포인터 반응은 작은 기울기로 제한합니다.
- 영속적인 장식 애니메이션은 멈출 수 있고, 움직임 줄이기 설정에서는 정지합니다.
- 업무 소개는 실제 상담 처리 상태가 아닙니다. 예시라는 문구를 붙였고 실제 사무실 상태나 AgentEvent를 만들지 않습니다.
- 데스크톱은 소개·장면 아래에 기업·개인 두 진입 카드를 나란히 둡니다. 모바일은 소개 → 진입 카드 → 팀 소개 순서로 보여 입장부터 쉽게 선택하게 합니다.
- 로그인과 회원가입, 시연 역할, 기업 인증번호 확인은 기존 동작을 유지합니다.

## 변경 파일

`frontend/src/` 기준입니다.

| 파일                                                                    | 변경 이유                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `features/pc-consult/components/StartScreen.tsx`                        | 소개 문구, 상품·정책 연결 설명, 팀 소개 장면, 계정 진입 카드 연결 |
| `features/pc-consult/components/entryScreen.css`                        | 밝은 전체 시작 화면, 큰 글자, 계층과 여백, 반응형 진입 순서       |
| `features/pc-consult/components/WelcomeStage.tsx`, `welcomeStage.css`   | 팀 선택·업무 설명·포인터 반응·멈춤 가능한 장면                    |
| `features/pc-consult/components/WelcomeVisual.tsx`, `welcomeVisual.css` | 기존 PC 그림의 배경 없는 표시와 밝은 장면 적용                    |
| `app/app.css`                                                           | 공통 표면·글자·강조 색상 정리                                     |
| `features/pc-consult/seller/management.css`                             | 기업 홈의 짙은 영역을 밝은 민트색으로 변경                        |
| `features/pc-consult/seller/seller.css`                                 | 기업 화면 색상 토큰 연결과 표·보조 문구 대비 개선                 |
| `features/pc-consult/teamTheme.css`                                     | 팀별 의미색을 유지하며 밝은 배경색 정리                           |
| `features/pc-consult/verification/verify-entry-experience.mjs`          | 변경 전후 캡처와 실제 로그인·팀 소개·접근성 검증                  |
| `features/pc-consult/ENTRY_EXPERIENCE_REPORT.md`                        | 변경 내용과 검사 결과 기록                                        |

## 검사

`frontend`에서 실행했습니다.

| 명령                   | 결과                                                  |
| ---------------------- | ----------------------------------------------------- |
| `npm run typecheck`    | PASS                                                  |
| `npm run lint`         | PASS                                                  |
| `npm test`             | PASS — 25개 파일, 271개 테스트                        |
| `npm run format:check` | PASS — 신규 검증 스크립트 정렬 후 재검사              |
| `npm run build`        | PASS — 94개 모듈, 기존 500kB 초과 번들 안내 경고 있음 |

첫 포맷 검사는 작성 중인 새 검증 스크립트의 정렬 때문에 FAIL이었고, Prettier로 정렬한 뒤 전체 검사를 다시 실행해 PASS했습니다. 기존 테스트나 기대값은 수정하지 않았습니다.

Playwright 최종 결과: **159/159 PASS**. 1440×900, 1366×768, 1024×900, 360×900에서 확인했습니다.

- 네 팀 선택·역할 설명, 움직임 정지·재생, 키보드 조작, 움직임 줄이기 설정을 확인했습니다.
- 기업·개인 로그인과 회원가입, 기업 인증번호 거부·통과, 관리자·상담원 권한, 개인 설문 진입을 확인했습니다.
- 브라우저 오류, 백엔드 호출, 가로 넘침은 모두 0건입니다.
- 첫 브라우저 검사는 158/159 PASS였습니다. 1366×768에서 진입 카드가 화면 아래로 약 6px 내려가는 문제를 발견해 짧은 화면의 여백을 줄였습니다. 기대값을 바꾸지 않고 다시 실행해 모든 검사를 통과했습니다.
- 팀 카드 글자에 영향을 주던 입체 변형은 PC 일러스트에만 적용하도록 수정했습니다. 마지막 캡처를 직접 열어 글자 선명도와 잘림을 확인했습니다.
- 최종 CSS 수정 뒤 `npm run build`, `npm run format:check`도 다시 실행해 PASS했습니다.

백엔드 검사는 안 돌림: 이번 변경은 시작 화면과 프론트엔드 색상·접근성에 한정됩니다.

캡처는 `frontend/test-results/entry-experience/` 아래에 저장했습니다. 변경 전 2장, 최종 변경 후 56장입니다. 이전 검증 스크립트와 캡처는 보존합니다.

- 시작 화면: `after/welcome-1440x900.png`
- 작은 노트북 첫 화면: `after/welcome-viewport-1366x768.png`
- 모바일 첫 화면: `after/welcome-viewport-360x900.png`
- 기업 홈: `after/business-home-1440x900.png`
- 개인 상담: `after/personal-consultation-1024x900.png`
- 상세 검사 결과: `after/report.json`

공통 계약·백엔드·DB·공유 설정·스냅샷은 변경하지 않았습니다. 패키지·외부 폰트·이미지 파일은 추가하지 않았습니다. Git 명령과 화면 조작 도구는 사용하지 않았습니다.
