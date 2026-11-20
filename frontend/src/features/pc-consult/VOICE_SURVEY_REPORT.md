# 고객용 음성 상담 안에 설문 배치

사용자의 후속 요청에 따라 음성 상담 박스를 넓히고, 상담 유형 선택·설문 작성·입력 확인을 그 안에 배치했습니다. 부품 후보·예산 조정·견적·승인·결제 자리는 아래 `#results`에서 이어집니다.

## 배치

| 화면 폭 | 배치                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1440px  | 왼쪽 사무실과 오른쪽 음성 상담을 약 1:1로 배치합니다. 음성 안내 바로 아래에 설문, 그 아래에 대화 기록과 글 입력을 둡니다. |
| 1024px  | 사무실 아래에 전체 폭의 음성 상담·설문을 배치합니다.                                                                      |
| 360px   | 같은 순서로 세로 배치하며, 긴 설문은 페이지 스크롤로 작성합니다.                                                          |

이전 통합 배치에서 설문의 위치와 고객용 상담 박스의 크기만 바꾸었습니다. 상담 상태를 가진 `PcConsult`는 한 개를 계속 유지합니다. 설문 확인·수정·후보 전환 때 초안과 대화가 초기화되지 않도록 표시 위치만 바꿉니다. 설문은 채팅 폼이나 대화 기록의 `aria-live` 영역 안에 넣지 않았습니다.

## 변경 파일과 이유

경로는 `frontend/src/` 기준입니다.

| 파일                                                       | 변경 이유                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `features/pc-consult/IntegratedWorkspace.tsx`              | 음성 상담 안에 초기 입력 화면을 배치하고, 부품 선택 이후는 기존 결과 영역에 연결합니다.                                    |
| `features/pc-consult/PcConsult.tsx`                        | 상태를 유지한 채 셸이 현재 화면 위치를 정할 수 있는 `renderLayout` 옵션을 추가했습니다.                                    |
| `features/chat/ChatPanel.tsx`                              | 음성 안내와 대화 기록 사이에 선택 콘텐츠를 넣는 `children` 옵션만 추가했습니다. 기존 호출의 렌더링·음성 로직은 유지합니다. |
| `features/pc-consult/pcConsult.css`                        | 고객용 상담 박스 확대, 설문 간격, 좁은 입력 영역, 대화 기록 높이, 반응형 배치를 조정했습니다.                              |
| `features/pc-consult/verification/verify-voice-survey.mjs` | 신규·교체 설문의 표시 위치, 입력·대화 보존, 후보·견적 전환, 화면 넘침을 Playwright로 검사합니다.                           |
| `features/pc-consult/verification/voice-survey/`           | 이번 변경의 화면과 브라우저 검사 결과를 따로 보존합니다.                                                                   |
| `features/pc-consult/VOICE_SURVEY_REPORT.md`               | 이번 후속 변경을 기록합니다.                                                                                               |

## 확인 결과

실행 위치는 `frontend`입니다. Windows의 `npm.cmd`로 같은 npm 스크립트를 실행했습니다.

| 명령                                 | 결과                                             |
| ------------------------------------ | ------------------------------------------------ |
| `npm run typecheck`                  | PASS, 종료 코드 0                                |
| `npm run lint`                       | PASS, 종료 코드 0                                |
| `npm test`                           | PASS, 21개 파일·235개 테스트                     |
| `npm run format:check`               | PASS, All matched files use Prettier code style! |
| `npm run build`                      | PASS, 70개 모듈, JS 493.69 kB / gzip 145.36 kB   |
| Playwright `verify-voice-survey.mjs` | PASS, 1440·1024·360px, 스크린샷 27장             |

Vitest의 첫 샌드박스 실행은 작업 프로세스 생성 제한(`spawn EPERM`)으로 FAIL이었고, 동일 명령을 승인된 실행으로 다시 돌려 235개 모두 PASS했습니다. 기존 테스트를 수정하거나 삭제·skip하지 않았습니다.

Playwright는 저장소 내부에 설치된 브라우저 캐시를 사용했습니다. 1440px에서 사무실과 음성 상담의 실측 폭은 각각 648px이며, 1024px·360px은 세로 배치입니다. 신규 조립·부품 교체 설문, 확인, 수정, 후보, 견적으로 이어지는 이동, 입력값·대화 보존을 확인했습니다. 가로 넘침·페이지 오류·백엔드 요청은 0건이고, 스냅샷은 파일별 한 번만 읽었습니다.

- [브라우저 검증 결과](verification/voice-survey/voice-survey-report.json)
- [1440px 설문 화면](verification/voice-survey/voice-survey-1440-02-new-survey-in-voice.png)
- [1024px 설문 화면](verification/voice-survey/voice-survey-1024-02-new-survey-in-voice.png)
- [360px 설문 화면](verification/voice-survey/voice-survey-360-02-new-survey-in-voice.png)

이번 변경은 실제 마이크 입력이나 백엔드 연동을 새로 검증하지 않습니다. 음성 처리 코드는 바꾸지 않았습니다. 공통 계약·DB·백엔드·공유 설정·패키지·스냅샷 데이터는 변경하지 않았고 Git 명령도 실행하지 않았습니다. 이전 검증 스크립트와 스크린샷은 그대로 보존했습니다.
