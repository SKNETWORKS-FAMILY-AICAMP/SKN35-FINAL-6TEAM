# 데이터 수집 작업 산출물

날짜별 데이터 공유 폴더의 색인입니다. 각 날짜 폴더에는 팀원이 받을 데이터와 사용 안내만 둡니다. 봇 코드·검색 로그·시각화·분석 문서·일일 작업일지는 해당 주차 작업일지의 날짜 폴더에 보관합니다.

## 날짜별 작업

- [2026-11-16 자료](2026-11-16/): 전날 공유 데이터
- [2026-11-17 공유 데이터와 다운로드 안내](2026-11-17/): 벤치마크·부품 결과 ZIP과 받는 방법
- [2026-11-18 RAG 통합 데이터 최종본](2026-11-18/): 최종 통합 ZIP, 확인용 Excel, 무결성 해시와 다운로드 안내
- [2026-11-17 작업 기록](../작업일지/주차별/2주차/11월17일/): 봇 코드·보고서·시각화·일일 작업일지
- [2주차 작업일지](../작업일지/주차별/2주차/2주차.md): 날짜별 작업 내역 링크

## 원본·미포함 자료

원본 데이터는 공유 ZIP에 복제하지 않고 출처 링크로 안내합니다. 개인 설정과 오래된 시트 내보내기 등 미포함 항목·대체 링크는 [상세 목록](../작업일지/주차별/2주차/11월17일/결과/제외_파일_목록.json)에 기록했습니다. 재현용 봇과 검색 결과는 [11월 17일 작업 폴더](../작업일지/주차별/2주차/11월17일/)에 있습니다.

## 결과물 구성

```text
데이터_수집/
├─ README.md                         # 날짜별 공유 폴더 색인
├─ 2026-11-16/                       # 이전 날짜 자료
└─ 2026-11-17/                       # 공유·다운로드에 필요한 파일만
   ├─ README.md                      # 받을 파일·용도·주의사항
   └─ 2026-11-17_공유데이터_일괄다운로드.zip

작업일지/주차별/2주차/11월17일/
├─ 11월17일_작업일지.md
├─ 봇/                              # 코드와 실행 방법
└─ 결과/                            # 보고서·시각화·로그·검토 문서
```

11월 17일 ZIP에는 벤치마크·부품 미리보기와 연결표·manifest가 들어 있습니다. 실제 DB 적재본은 아닙니다. 파일별 용도와 다운로드 순서는 [11월 17일 README](2026-11-17/README.md)를 확인하세요.

## 공유 시트

- [RAG·공식 문서 및 성능 데이터 정리](https://docs.google.com/spreadsheets/d/1fulqsRrHVriKkrGvz5519E7K9cvfnGbmpMyb-HfbVho/edit)
- [크롤링 원문·수집 기록](https://docs.google.com/spreadsheets/d/12_xSIi6L61M7BDBZe8gjZFN_Doi7vC39MFktG3TuDlE/edit)

## 원본 조회·다운로드 링크

- 게임: [Open GPU Benchmarks](https://opengpubenchmarks.com/) · [라이선스](https://opengpubenchmarks.com/license/)
- 3D 렌더링: [Blender Open Data 다운로드](https://opendata.blender.org/download/)
- 로컬 AI: [llm-speed 데이터 카드](https://huggingface.co/datasets/llmspeed/llm-speed-benchmarks)
- 부품 카탈로그: [docyx/pc-part-dataset](https://github.com/docyx/pc-part-dataset)
- 음악 제작: [DAWbench](https://dawbench.com/)
- 영상 편집: [PugetBench Premiere Pro](https://www.pugetsystems.com/pugetbench/creators/premiere-pro/)
- 사진 편집: [PugetBench Lightroom Classic](https://www.pugetsystems.com/pugetbench/creators/lightroom-classic/)
- CAD·워크스테이션 그래픽: [SPECviewperf 결과](https://ftp.spec.org/gwpg/gpc.static/specviewperfresults.html)
- 공식 AI 벤치마크 후보: [MLPerf Inference 결과](https://github.com/mlcommons/inference_results_v5.0)

공식 출처의 전체 원문을 저장소에 복제하지 않았습니다. 이용 조건과 데이터의 실제 범위는 날짜별 결과 보고서를 확인하세요.
