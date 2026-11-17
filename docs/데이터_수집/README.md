# 데이터 수집 작업 산출물

봇 코드와 날짜별 실행 결과를 한곳에 보관합니다. 원본 데이터는 기존 합의대로 저장소에 복제하지 않고 출처 링크를 둡니다. 생성된 정규화 미리보기와 검토 산출물은 크기 제한 안에서 날짜 폴더에 포함했습니다.

## 날짜별 작업

- [2026-11-16 봇·결과](2026-11-16/): 1차 수집 봇, 실행 결과·한계, 현황 시각화
- [2026-11-17 봇·결과](2026-11-17/): 재탐색 봇, 어제 대비 검토, 정규화 미리보기·manifest·매칭표
- [팀원용 데이터 다운로드 안내](2026-11-17/결과/팀원용_데이터_다운로드_가이드.md): 필요한 파일과 용도
- [대용량 벤치마크 CSV ZIP](2026-11-17/다운로드/benchmark_datasets_2026-11-17.zip): `benchmark_runs_load_ready.csv`, `benchmark_runs_preview.csv`
- [2주차 작업일지](../작업일지/주차별/2주차/2주차.md): 날짜별 작업 내역 링크

## 11월 17일 작업에서 제외한 파일

`2026-11-17/결과/제외_파일_목록.json`에 저장소에 복제하지 않은 항목과 사유를 기록했습니다.

- 원본 다운로드 데이터는 이전 요청에 따라 출처 링크로만 안내합니다. 이 저장소에 원본을 복제하지 않습니다.
- 두 대용량 변환 CSV는 GitHub 일반 파일의 100 MiB 제한 때문에 ZIP으로 제공하고, 원본 데이터는 출처 링크를 안내합니다. Git LFS는 새로 설정하지 않았습니다.
- `approved_sources.json`은 개인 승인 manifest라 저장소에 넣지 않았습니다. 예시 파일만 포함했습니다.

## 결과물 구성

```text
데이터_수집/
├─ README.md
├─ 2026-11-16/
│  ├─ 봇/
│  └─ 결과/
└─ 2026-11-17/
   ├─ 봇/
   ├─ 결과/
   └─ 다운로드/
```

11월 17일 결과에는 `benchmark_run_parts_preview.csv`, `parts_import_preview.csv`, `source_part_crosswalk.csv`, `unmatched_hardware.csv` 등 적재·매칭 검토용 생성 파일이 포함되어 있습니다. ERD 테이블이 확정되기 전이므로 실제 DB 적재가 완료된 것으로 해석하면 안 됩니다.

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
