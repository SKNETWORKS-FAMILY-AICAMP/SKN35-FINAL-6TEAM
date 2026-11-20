# 기업 운영 화면의 외부 코드 출처

아래 무료 템플릿의 일부 마크업 구조와 CSS 규칙을 기존 React 컴포넌트와 저장소의 색상 변수에 맞게 수정했습니다. 템플릿 전체, 실행 스크립트, 프레임워크, 폰트, 사진, 제품 데이터 및 유료 컴포넌트는 포함하지 않았습니다. 참고 파일은 실행하거나 수정하지 않았습니다.

| 출처                                                                                                  | 확인한 저장소 내 원본                                                                                                                                                                                                                      | 이식한 부분                                                                     | 적용 파일                                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Tabler](https://github.com/tabler/tabler), 로컬 CSS v1.7.5                                           | `frontend/test-results/refs/src/tabler/dashboard.html`, `tabler.css`, `LICENSE`                                                                                                                                                            | Tasks의 제목·작업 행 구성, 활동 목록의 기록·시간 구성, 카드 행의 여백과 구분선  | `seller/ManagementPanels.tsx`, `seller/management.css`                                |
| [TailAdmin 무료 HTML 템플릿](https://github.com/TailAdmin/tailadmin-free-tailwind-dashboard-template) | `frontend/test-results/refs/src/tailadmin/src/partials/layout/app-layout/sidebar/index.html`, `src/partials/main/dashboard/ecommerce/ecommerce-metrics.html`, `monthly-target/index.html`, `monthly-target/target-metrics.html`, `LICENSE` | 메뉴 그룹 구조, 아이콘·제목·숫자·보조 설명의 지표 카드, 게이지와 하단 지표 구성 | `seller/SellerNavigation.tsx`, `seller/ManagementPanels.tsx`, `seller/management.css` |
| [PlainAdmin 무료 Bootstrap 템플릿](https://github.com/PlainAdmin/plain-free-bootstrap-admin-template) | `frontend/test-results/refs/src/plainadmin/index.html`, `assets/scss/buttons/_buttons.scss`, `assets/scss/tables/_tables.scss`, `LICENSE`                                                                                                  | 상태 배지의 둥근 모양·여백·의미별 색 구분, 작업 행의 상태 표시                  | `seller/ManagementPanels.tsx`, `seller/management.css`                                |

TailAdmin과 PlainAdmin은 저장소에 준비된 무료 소스를 기준으로 확인했으며 확인하지 않은 버전이나 커밋 번호를 기재하지 않았습니다. `03-plainadmin-crm.png`는 eCommerce 화면을 담고 있습니다. 캡처에 보이는 유료 CRM 메뉴나 유료 소스는 이식하지 않았습니다.

Tabler의 저장 공간 분할 막대와 카드 구획도 `seller/CatalogPanel.tsx`, `seller/b2b.css`의 실제 스냅샷 분류 표시로 옮겼습니다. TailAdmin에서 가져온 메뉴 묶음 구조는 `app/App.tsx`, `app/app.css`의 기존 셸에도 적용했습니다.

템플릿의 고정 숫자·이름·사진을 사용하지 않습니다. 부품 수는 읽기 전용 스냅샷 집계, 운영 표본은 별도로 표시한 저장소의 가상 데이터, 팀 상태와 활동은 실제 수신한 시연 이벤트입니다. 게이지 SVG와 메뉴 SVG 아이콘은 이 저장소에서 작성했습니다.

## Tabler — MIT License

Copyright (c) 2018-2026 The Tabler Authors

원본 CSS의 추가 고지: Copyright 2018-2026 codecalm.net Paweł Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## TailAdmin — MIT License

Copyright (c) 2023 TailAdmin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## PlainAdmin — MIT License

Copyright (c) 2021 PlainAdmin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
