# BUILDWISE 데이터 수집 봇

공개 데이터 후보를 Kaggle, Hugging Face, GitHub에서 찾아 CSV로 기록하고, 검토·승인된 정확한 파일만 내려받는 Python 표준 라이브러리 기반 초안입니다. 성능 평가 데이터 6개 분야와 RAG 공식 문서는 목적이 다르므로 서로 다른 source record와 평가로 관리합니다.

11월 16일판은 [archive/2026-11-16/](archive/2026-11-16/)에 보관합니다. 이 버전은 [당시 설정](../../data/collection/runs/2026-11-17/configs/archive/2026-11-16/)과 `data/collection/runs/2026-11-17/output/archive/2026-11-16/`를 사용합니다.

## 안전한 기본 동작

- `discover`는 검색 메타데이터만 저장합니다. 이 단계에서 원자료를 내려받지 않습니다.
- `collect`는 기본적으로 수집 계획만 만듭니다. 실제 다운로드는 `--execute`를 줘야 합니다.
- 실행해도 각 출처의 `approval`과 `license_review` 상태가 승인으로 되어 있지 않으면 수집하지 않습니다.
- GitHub/Hugging Face 파일은 브랜치가 아니라 고정된 40자리 커밋 SHA로 지정해야 합니다.
- 수집 파일은 manifest에 지정한 경로만 허용하고, 요청 호스트·리디렉션 호스트·파일 크기·확장자를 제한합니다.
- 직접 문서 URL은 HTTPS와 허용 호스트를 확인하고 robots.txt에서 허용을 확인할 수 없으면 보류합니다.
- Kaggle은 설치된 공식 `kaggle` CLI와 사용자의 인증이 필요합니다. 봇은 stderr나 키를 파일에 기록하지 않으며, 선택한 개별 파일의 크기를 확인한 뒤 ZIP 원본으로 저장합니다. 자동 압축 해제는 하지 않습니다.
- 압축 파일과 내려받은 코드는 실행하지 않습니다.

## 1. 후보 탐색

저장소 루트에서 Python 3.10 이상으로 실행합니다. 현재판은 [설정 폴더](../../data/collection/runs/2026-11-17/configs/current/)에서 설정을 읽고 `data/collection/runs/2026-11-17/output/`에 결과를 씁니다. 명령에서 별도로 지정한 상대 경로는 실행 디렉터리를 기준으로 합니다.

```powershell
python .\scripts\collection\dataset_crawler.py discover --limit 10
```

특정 플랫폼만 사용할 수 있습니다:

```powershell
python .\scripts\collection\dataset_crawler.py discover --platforms huggingface github
```

후보 결과는 `category`, 플랫폼 ID/URL, 라이선스 표시(있을 경우), 갱신일, 설명, 검색어를 기록합니다. 검색 결과의 라이선스 표시는 승인 증거가 아닙니다. 플랫폼별 공개 API로 후보를 찾고, 라이선스·원출처·측정 조건은 사람이 원문에서 검토해야 합니다.

GitHub API 인증이 필요하면 `GITHUB_TOKEN` 환경변수를 사용할 수 있습니다. 값은 코드/manifest에 넣지 않습니다. Kaggle 검색에는 Kaggle CLI의 사용자 인증 구성이 필요합니다. 자격 증명 설정은 팀과 합의된 PC에서만 사용합니다.

## 2. 검토·승인한 파일 수집

[approved_sources.example.json](../../data/collection/runs/2026-11-17/configs/current/approved_sources.example.json)을 같은 폴더에 `approved_sources.json`으로 복사하고, 후보를 사람이 확인한 후 승인된 파일만 등록합니다. 기본 실행은 계획 출력입니다.

```powershell
python .\scripts\collection\dataset_crawler.py collect
```

계획이 맞고 모든 승인 정보가 기록된 뒤에만 실제 저장을 실행합니다:

```powershell
python .\scripts\collection\dataset_crawler.py collect --execute
```

각 source record는 적어도 다음 정보를 가져야 합니다:

```json
{
  "source_id": "고유 ID",
  "category": "게임",
  "platform": "github",
  "locator": {"repo": "owner/repo"},
  "revision": "40자리 커밋 SHA",
  "url": "https://github.com/owner/repo",
  "files": [{"path": "data/results.csv", "max_bytes": 50000000}],
  "approval": {"status": "approved", "reviewed_on": "2026-11-16", "reviewer": "담당자"},
  "license_review": {"status": "approved", "id": "확인한 SPDX/조건", "reviewed_on": "2026-11-16", "source_url": "라이선스 근거 URL"},
  "notes": "원자료의 벤치마크 버전·장비 구성 조건"
}
```

## 3. PC 부품 카탈로그를 ERD 적재본으로 변환

`docyx/pc-part-dataset`의 PC 조립 핵심 CSV 8개를 고정 커밋에서 가져오고, Git blob SHA-1을 검증한 뒤 `parts` 적재 미리보기와 원본 행 crosswalk를 만듭니다.

```powershell
python .\scripts\collection\dataset_crawler.py import-parts --download
```

이미 원본 CSV가 있으면 `--download` 없이 변환/프로파일링을 다시 실행합니다. 산출물은 `data/collection/runs/2026-11-17/output/normalized/pc-part-dataset_c52a04ca/`에 생성됩니다.

- `parts_import_preview.csv`: ERD `parts` 컬럼 모양으로 정규화한 자료
- `source_part_crosswalk.csv`: 각 원본 행과 생성한 `part_id`의 연결
- `import_manifest.json`: 고정 커밋, 원본 해시, 행 수, 결측·중복 통계와 매핑 가정

브랜드/모델번호/개별 제품 URL/행별 갱신일이 원본에 없어 추측해 채우지 않습니다. CPU는 동일한 정확 모델명과 정적 사양의 반복 행만 하나의 `parts` 항목으로 합치고, 모든 원본 행을 crosswalk에 남깁니다. 가격 스냅샷도 `specs.source_price_snapshots`에 보존합니다. 오래된 USD 가격은 `current_price`에 넣지 않습니다. 저장소 MIT LICENSE 표기와 PCPartPicker 원천 데이터의 이용 조건은 별도로 확인해야 하며, 실제 DB 적재는 하지 않습니다.

지원 플랫폼은 `huggingface`, `github`, `kaggle`, `direct`입니다. 직접 URL source에는 `allowed_hosts`, 문서 버전/확인일을 담은 `snapshot`, 각 파일의 `url`을 명시합니다. Kaggle은 `locator.handle`을 `owner/dataset-name`, `locator.version`을 숫자 버전으로 적고 `files`에 Kaggle CLI의 정확한 파일명을 둡니다. 버전을 지정하지 않으면 실제 수집을 보류합니다.

## 4. 기존 성능 자료를 ERD 구조로 정규화

이미 확보한 Open GPU Benchmarks, Blender Open Data, llm-speed 자료를 각각 `benchmark_runs`와 `benchmark_run_parts` 적재 미리보기로 변환합니다. 먼저 부품 미리보기가 있어야 합니다. 기본값은 출처별 최대 1,000행이며 Blender 전체 638,347행은 `--all`로 명시해야 합니다.

```powershell
python .\scripts\collection\dataset_crawler.py prepare-benchmarks --limit 1000
python .\scripts\collection\dataset_crawler.py prepare-benchmarks --sources opengpu llmspeed
python .\scripts\collection\dataset_crawler.py prepare-benchmarks --all
```

생성 파일은 `data/collection/runs/2026-11-17/output/normalized/benchmarks/` 아래에 생성됩니다. `benchmark_runs_load_ready.csv`는 `benchmark_run_parts_preview.csv`에 부품 연결이 있는 run만 담아 후속 DB 입력 검토에 사용합니다. 전체 run 보존본은 `benchmark_runs_preview.csv`이며, 벤치마크에서 관측한 모델명으로 생성한 참조 GPU 행은 `parts_with_benchmark_references_preview.csv`에서 확인합니다. 미매칭 집계는 `unmatched_hardware_summary.csv`, 상세 내역은 `unmatched_hardware.csv`에 남깁니다. 2026-11-17 전체 변환은 638,587개 run 중 498,704개에 부품 연결이 있어 적재 검토 후보로 만들었고 139,883개는 보류했습니다. 연결은 CPU 모델번호 196,558건, GPU 참조 모델 302,146건입니다. 식별된 GPU 모델 249개는 parts 미리보기에 참조 전용으로 추가했으며 현재 결과에서 판매 SKU 직접 연결은 확인되지 않았습니다. part FK, 연결 run 집합, 중복 연결, 구매·견적 제외 플래그를 확인했습니다. ERD 8개 테이블에 벤치마크 저장 구조가 확정되지 않아 팀 DB 담당자 확인 전에는 실제 DB에 넣지 않습니다.

CPU는 실행환경 접미사를 떼고 정확 모델번호를 비교합니다. 예: `AMD Ryzen 7 7800X3D 8-Core Processor` → `AMD Ryzen 7 7800X3D`. 동일 CPU명·정적 사양 중복은 원본 crosswalk를 보존하며 한 제품 ID로 합칩니다. GPU 모델만 식별되고 판매 SKU를 특정할 수 없으면 판매 상품을 추정하지 않고 참조 전용 GPU 행을 추가합니다. 이 행은 `specs.record_kind=benchmark_reference_model`, `reference_only=true`, `quote_eligible=false`, `purchase_eligible=false`로 표시해 견적·구매 추천에서 제외합니다. 원문에 제조사 SKU가 명확한 경우에만 실판매 SKU에 연결합니다. 노트북 전용 CPU나 Mac SoC 등 기존 카탈로그에 없는 장치는 별도 카탈로그 보강 전까지 미매칭으로 보류합니다.

현재 수집 자료는 게임·3D 렌더링·로컬 AI 일부만 포함합니다. 음악·영상·사진·CAD 성능평가 자료나 진봉 님의 제조사 공식 문서 목록을 대체하지 않습니다. 진봉 님의 RAG 수집 범위와 성욱 님의 6개 성능분야 데이터 계획 비교는 [자료 비교 문서](../../docs/데이터_수집/2026-11-17/결과/RAG_검증_데이터/진봉님_자료와_성욱님_데이터수집방향_비교_2026-11-17.md)에 있습니다. 현재 ERD 8개 테이블에는 벤치마크 전용 run/link 테이블이 보이지 않습니다. 실제 저장 위치와 필드·PK/FK는 팀 DB 담당자와 확정하기 전까지 DB 적재를 보류합니다.

## 저장 결과와 범위

- 원자료: `data/collection/runs/2026-11-17/output/raw/<source_id>/`
- 파일별 출처·수집일·크기·SHA-256·라이선스 메타데이터: `<파일명>.metadata.json`
- 실행 로그: `data/collection/runs/2026-11-17/output/raw/collection_log.json`
- 후보 검색 결과와 오류 로그: 지정한 CSV와 `*_errors.json`
- 동일 SHA-256 파일은 기존 sidecar와 대조해 중복 저장을 건너뜁니다.
- CSV/JSON 등 원자료의 분야별 정규화와 벤치마크 점수 비교는 별도 후처리 단계입니다. 벤치마크별 버전·OS·해상도·프리셋이 다른 측정값을 한 수치로 합치지 않습니다.

## 이번 실행 결과와 남은 수집

2026-11-16 자동 탐색은 첫 시도에서 DNS 실패 24건과 Kaggle CLI 부재 12건으로 후보 0건이었습니다. 네트워크를 허용해 재실행해도 Hugging Face 검색어가 너무 구체적이어서 0건, GitHub API는 마지막 2건이 HTTP 403 호출 제한, Kaggle은 CLI 부재로 후보가 나오지 않았습니다. 짧은 고유명사 검색으로 Hugging Face 후보 11건을 찾았으나 수동 적합성 검토가 필요합니다. 상세 원인·분야별 한계·다음 계획은 [수집 재실행 진단 보고서](../../docs/작업일지/주차별/2주차/11월17일/결과/수집_재실행_진단보고서.html)와 [데이터 목록](../../data/collection/runs/2026-11-17/dataset_inventory.json)을 확인하세요.

실제 파일은 게임(Open GPU Benchmarks 20개 측정값, CC BY 4.0), 3D 렌더링(Blender 4.0 이상 638,347행, CC0), 로컬 AI(llm-speed CSV 220행, CC BY 4.0)에서 확보했습니다. Blender 원본 ZIP은 압축을 풀면 약 1.91GB라 원본을 보존하고 CSV만 스트리밍 파생했습니다.

음악·영상·사진 자료는 다운로드 또는 재사용 조건을 확인할 때까지 보류하고, CAD 자료는 별도 후보가 필요합니다. RAG 근거 문서는 고정 완성 PC가 아니라 지원 부품 카탈로그와 호환 규칙을 기준으로 수집합니다. 사이트 전체를 긁지 않고 승인된 공개 API/파일과 정확한 경로만 대상으로 합니다.

## 참고하는 공식 도구 문서

- Kaggle API/CLI: https://www.kaggle.com/docs/api
- Kaggle CLI 데이터셋 명령: https://github.com/Kaggle/kaggle-cli/blob/main/docs/datasets.md
- Hugging Face Hub CLI: https://huggingface.co/docs/huggingface_hub/package_reference/cli
- GitHub REST API 속도 제한: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

## RAG 부품 카탈로그 후보 (읽기 전용 검토)

docyx/pc-part-dataset 저장소를 사용자 제안 후보로 검토했습니다. 기준 커밋 `c52a04ca9465c83997ed335f7767b09a2005dd26` (2025-07-23), README 기준 66,778개 부품, JSON/JSONL/CSV 형식이며 루트 LICENSE는 MIT입니다. README는 PCPartPicker에서 수집한 데이터라고 설명합니다. MIT 표기가 원천 사이트 데이터의 이용·재배포 권한까지 해결하는 것은 아니므로, 팀 사용 전 조건 확인이 필요합니다. 이번 검토에서는 파일을 복사하거나 크롤러를 실행하지 않았습니다.

이 데이터는 구조화 상품 카탈로그 전처리 후보입니다. CPU-보드 BIOS 지원, GPU 전원 연결, 케이스 여유 공간 등 실제 호환성 판단에 필요한 필드는 제조사 공식 사양·매뉴얼·QVL 자료로 보완하고 근거 URL과 버전을 함께 기록합니다. 최신 가격/재고 자료로 간주하지 않습니다.
