# 작업일지 보관 규칙

`docs/작업일지/`에는 주차별·날짜별 작업일지 Markdown과 일지에서 사용하는 이미지·시각화 보고서(HTML 등)만 보관합니다. 원본과 실행 결과는 각 담당 폴더에 두고 일지 본문에서 상대 경로로 연결합니다.

| 자료 | 보관 위치 |
|---|---|
| 수집·전처리 Python 코드와 실행 안내 | [scripts/collection/](../../scripts/collection/README.md) |
| 수집 후보·로그·설정 등 CSV·JSON·JSONL | [data/collection/runs/](../../data/collection/runs/) |
| 벤치마크·부품 미리보기 ZIP | [data/benchmarks/releases/](../../data/benchmarks/releases/) |
| RAG 배포 ZIP·Excel·정규화 데이터 | [data/rag/releases/](../../data/rag/releases/) |
| 수집 자료 안내와 분석 문서 | [docs/데이터_수집/](../데이터_수집/README.md) |
| 기획서·설계 문서 | [docs/기획/](../기획/) · [docs/설계/](../설계/) |

주간 기록은 [주차별 폴더](주차별/)에서 확인합니다.

## 주차 요약 파일(`N주차.md`) 규칙

- 진행 중인 주차의 `N주차.md`에는 **앞선 주차 작업 요약**과 **이번 주 현황**(날짜별 작업일지 링크)을 적습니다.
- 다음 주차로 넘어가면 `N주차.md`를 **그 주 전체 작업 브리핑**으로 정리합니다(날짜별 한 일, 주요 내용, 다음 주로 넘어간 일).
