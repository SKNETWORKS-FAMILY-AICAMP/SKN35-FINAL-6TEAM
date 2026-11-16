# 공개 데이터 탐색·수집 봇

6개 분야의 성능 평가 후보와 별도 RAG 근거 자료를 다루는 표준 라이브러리 기반 Python 봇입니다. 결과 원본 데이터는 팀 저장소에 넣지 않습니다. 원본은 각 출처 링크에서 조회·다운로드하세요.

## 파일

- `봇/dataset_crawler.py`: Kaggle·Hugging Face·GitHub 후보 탐색과 검토 승인된 파일 수집
- `봇/topics.json`: 분야별 검색어
- `봇/approved_sources.example.json`: 검토 후 채울 수집 manifest 예시
- `봇/process_blender_snapshot.py`: 로컬 Blender ZIP 내부 JSONL 스트리밍 처리기

## 실행 순서

1. Python 3.10 이상에서 `discover`로 후보 메타데이터를 확인합니다.
2. 원문에서 파일 경로·고정 revision·라이선스·측정 조건을 사람이 확인합니다.
3. 확인한 항목만 개인 manifest에 기록하고, `collect`를 먼저 계획 모드로 실행합니다.
4. 계획과 이용 조건을 재확인한 뒤 승인된 정확한 파일에만 `--execute`를 지정합니다.

```powershell
python .\봇\dataset_crawler.py discover --output .\candidates.csv --limit 10
python .\봇\dataset_crawler.py collect --manifest .\approved_sources.json --output-dir .\raw
```

API 키와 Kaggle 자격 증명을 코드·문서·저장소에 기록하지 마세요. 수집 권한이 확인되지 않은 파일은 실행 manifest에 넣지 않습니다.

## 조회·다운로드 링크

- 게임: [Open GPU Benchmarks](https://opengpubenchmarks.com/) · [라이선스](https://opengpubenchmarks.com/license/)
- 3D 렌더링: [Blender Open Data](https://opendata.blender.org/download/)
- 로컬 AI: [llm-speed 데이터 카드](https://huggingface.co/datasets/llmspeed/llm-speed-benchmarks)
- 부품 카탈로그 후보: [docyx/pc-part-dataset](https://github.com/docyx/pc-part-dataset)
- 음악 제작: [DAWbench](https://dawbench.com/)
- 영상 편집: [PugetBench Premiere Pro](https://www.pugetsystems.com/pugetbench/creators/premiere-pro/)
- 사진 편집: [PugetBench Lightroom Classic](https://www.pugetsystems.com/pugetbench/creators/lightroom-classic/)
- 공식 AI 벤치마크 후보: [MLPerf Inference results v5.0](https://github.com/mlcommons/inference_results_v5.0)

결과와 제약은 [2026-11-16 결과·한계](결과/2026-11-16_결과_한계.md)를 보세요. 데이터 원본 파일은 이 저장소에 없습니다.
