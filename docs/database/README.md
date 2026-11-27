# PC 부품 데이터 관리

MySQL `dev_database`의 부품·가격·호환성 수집 자료를 관리합니다.
[부품 DB 흐름과 기능별 테이블](FLOW.md)에서 적재, 상담, 견적, 검증의 관계를 볼 수 있습니다.
모든 명령은 저장소 루트에서 실행합니다. 로컬 MySQL은 Docker 없이 사용합니다.
먼저 [PC 상담 실행 안내](../../README.md#pc-상담-실행)에 따라 `UV_PROJECT_ENVIRONMENT`를 루트 `.venv`로 설정하고 의존성을 설치합니다. `--directory backend`는 백엔드의 프로젝트와 실행 위치를 선택합니다. Intel Mac에서는 아래 `uv run` 명령의 `--frozen` 대신 `--no-sync`를 사용합니다.

## 로컬 DB 설정

팀 환경은 Python 3.14와 uv 0.13 이상입니다. DBeaver는 관리 도구이며 MySQL 서버를 별도로 실행해야 합니다.
`uv --version`이 0.13 미만이면 `uv self update 0.13.7`로 팀 도구 버전을 먼저 맞추세요.
기존 MySQL 서버와 `dev_database`를 그대로 사용합니다. 루트 `.env`에 다음 키를 설정합니다.

```dotenv
PARTS_MYSQL_HOST=127.0.0.1
PARTS_MYSQL_PORT=3306
PARTS_MYSQL_DATABASE=dev_database
PARTS_MYSQL_USER=root
PARTS_MYSQL_PASSWORD='직접 입력'
```

설정 우선순위는 같은 키의 프로세스 환경변수 → 루트 `.env`입니다. 비밀번호의 `${...}`는 치환하지 않습니다.
`PARTS_MYSQL_*`가 하나라도 있으면 해당 설정만 사용합니다.
기존 `.env`의 `MYSQL_DATABASE=dev_database`와 `MYSQL_*` 설정도 호환됩니다.
비밀번호가 비어 있거나 DB 이름이 `dev_database`가 아니면 접속을 중단합니다.
연결 확인 명령은 `SELECT DATABASE(), VERSION()`만 실행하며 비밀번호를 출력하지 않습니다.
비밀번호는 루트 `.env`를 읽습니다. 비밀번호를 데이터 파일이나 실행 인자에 쓰지 않습니다.

## 빠른 사용

```powershell
# DB 연결 확인
uv run --directory backend --frozen python -X utf8 -m app.db.schema

# 최초 생성. 기존 데이터 삭제나 컬럼 자동 변경을 수행하지 않음
uv run --directory backend --frozen python -X utf8 -m app.db.schema --init

# 미리보기: 원본을 정리하고 보고서를 만들며 DB에는 쓰지 않음
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.import_parts

# 실제 저장: 부품을 먼저 저장
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.import_parts --apply

# 읽기 전용 DB 점검
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.check_data
```

DBeaver에서도 [최초 생성 SQL](../../backend/app/db/sql/parts_catalog.sql) 전체를 실행할 수 있습니다.
대상 스키마는 `dev_database`입니다. 생성 후 탐색기에서 새로고침하면 됩니다.
`CREATE TABLE IF NOT EXISTS`는 이미 존재하는 테이블을 새 구조로 변경하지 않습니다.
기존 테이블의 변경 SQL은 `backend/app/db/sql/migrations/`에서 관리하며 변경 후 ERD를 갱신합니다.
MySQL의 테이블 생성 DDL은 전체 롤백이 되지 않습니다. 데이터 가져오기는 트랜잭션으로 처리합니다.

## 기존 DB의 결제 견적 구조 적용

초기 생성은 새 결제 견적 구조를 사용합니다. 기존 `dev_database`는 견적 저장 작업을 잠시 멈춘 상태에서 아래 명령으로 [005 마이그레이션](../../backend/app/db/sql/migrations/005_paid_quotes.sql)을 적용합니다.

```powershell
uv run --directory backend --frozen python -X utf8 -m app.db.schema --migrate-paid-quotes
```

명령은 대상 테이블의 컬럼 구성과 기존 견적 존재 여부를 먼저 확인합니다. 과거 견적이 있으면 DDL 실행 전에 중단합니다. 결제 식별값 등 필요한 정보를 확인해 이관 계획을 세운 뒤 구조를 변경할 수 있습니다. 견적이 비어 있다면 사용 중인 부품·호환성 데이터와 사용자 데이터를 유지한 채 견적 관련 테이블 구조만 전환합니다.

## 기존 DB의 부품 출처 URL 컬럼 정리

기존 `dev_database`의 부품 출처 URL 두 컬럼은 [006 마이그레이션](../../backend/app/db/sql/migrations/006_remove_parts_source_urls.sql)으로 정리합니다.

```powershell
uv run --directory backend --frozen python -X utf8 -m app.db.schema --migrate-part-source-urls
```

명령은 부품 출처와 값이 다른 가격 출처가 있으면 변경 전에 중단합니다. 상품과 가격의 데이터셋 출처는 `parts.specs._provenance`에서 찾을 수 있습니다. 가격이 있는 부품에는 가격 확인 시각이 필요합니다.

## 기존 DB의 호환성 출처 URL 컬럼 정리

[007 마이그레이션](../../backend/app/db/sql/migrations/007_remove_compatibility_source_url.sql)은 `part_compatibility`의 중복 출처 URL 컬럼을 제거합니다.

```powershell
uv run --directory backend --frozen python -X utf8 -m app.db.schema --migrate-compatibility-source-url
```

명령은 각 행의 `conditions._record_key`로 [별도 호환성 근거 자료](../../data/hardware/docyx_compatibility.json)를 찾아 URL이 모두 일치하는지 확인합니다. 키나 URL이 일치하지 않는 행이 있으면 컬럼 삭제 전에 중단합니다. 적용 후 `list_compatibility`는 같은 키로 원문 URL을 조회해 반환합니다.

## 기존 DB의 호환성 원문 갱신일 컬럼 정리

[008 마이그레이션](../../backend/app/db/sql/migrations/008_remove_compatibility_source_updated_at.sql)은 `part_compatibility.source_updated_at`을 제거합니다. `source_url`이 남아 있으면 007을 먼저 적용합니다.

```powershell
uv run --directory backend --frozen python -X utf8 -m app.db.schema --migrate-compatibility-source-updated-at
```

원문 갱신일은 [호환성 근거 JSON](../../data/hardware/docyx_compatibility.json)의 `source_updated_on`에서 확인할 수 있습니다.

## 기존 DB의 호환성 적재 확인 시각 컬럼 정리

[009 마이그레이션](../../backend/app/db/sql/migrations/009_remove_compatibility_verified_at.sql)은 `part_compatibility.verified_at`을 제거합니다. `source_updated_at`이 남아 있으면 008을 먼저 적용합니다.

```powershell
uv run --directory backend --frozen python -X utf8 -m app.db.schema --migrate-compatibility-verified-at
```

## 기존 DB의 부품 확인 시각 컬럼 정리

[010 마이그레이션](../../backend/app/db/sql/migrations/010_remove_parts_verified_at.sql)은 `parts.verified_at`을 제거합니다. 006이 완료된 스키마에 적용합니다.

```powershell
uv run --directory backend --frozen python -X utf8 -m app.db.schema --migrate-part-verified-at
```

명령은 `verified_at`에 값이 있는 부품이 있으면 컬럼을 제거하기 전에 중단합니다.

## 기존 DB의 호환성 출처 발행자 컬럼 정리

[011 마이그레이션](../../backend/app/db/sql/migrations/011_remove_compatibility_source_publisher.sql)은 `part_compatibility.source_publisher`를 제거합니다. 009가 완료된 스키마에 적용합니다.

```powershell
uv run --directory backend --frozen python -X utf8 -m app.db.schema --migrate-compatibility-source-publisher
```

명령은 `conditions._record_key`로 각 행의 원본 발행자를 찾아 DB 값과 대조합니다. 원본 키를 찾을 수 없거나 발행자가 일치하지 않으면 컬럼을 제거하기 전에 중단합니다. 적용 후 `list_compatibility`는 같은 키로 원본 발행자와 URL을 찾아 반환합니다. [호환성 근거 JSON](../../data/hardware/docyx_compatibility.json)

## 부품 소비전력과 이미지 URL

기존 DB에 두 컬럼이 없으면 DBeaver에서 [004 마이그레이션](../../backend/app/db/sql/migrations/004_add_part_power_and_image.sql)을 실행합니다.
새 DB는 `parts_catalog.sql`에 두 컬럼이 포함되어 있습니다.

- `parts.power_draw_w`의 단위는 W입니다. CPU는 원본 TDP를 저장하고 공식 최대 터보 전력은 `specs.cpu_power_limit_w`에 보관합니다. GPU는 카드 모델의 공식 보드 전력(TGP·TBP 등)을 우선합니다. 메인보드·RAM·저장장치·쿨러·케이스도 확인된 전력을 우선합니다. 제조사 근거는 [전력 사양 검토 데이터](../../data/hardware/reviewed_power_specs.json)에 기록합니다.
- 공식값이 없는 부하 부품은 PSU 산정용 추정값을 저장합니다. `specs._power_estimate`에 `status=unconfirmed`, 산정 기준과 출처를 남깁니다. GPU는 [모델별 추정 근거](../../data/hardware/reviewed_gpu_estimates.json)가 있으면 그 값을 사용합니다. 그 외는 [칩셋별 공식 참조 전력](../../data/hardware/gpu_power_references.json)과 확인된 동일 칩셋 보드 전력 중 큰 값에 10%를 추가해 5 W 단위로 올림합니다. 자료가 없는 새 GPU에는 모델 또는 칩셋 근거를 추가해야 적재할 수 있습니다. PSU의 정격 출력은 `specs.wattage_w`에 들어 있으며 PSU 행의 `power_draw_w`는 `NULL`입니다.
- `parts.image_url`에는 [Doshiba PCPartPicker JSONL](https://huggingface.co/datasets/Doshiba/pcpartpicker-parts-dataset/blob/4d83d726b37b8c7342ce07c72f73eacc71ddf37a/pcpartpicker_parts.jsonl)에서 분류·제품명이 일치하는 사진을 저장합니다. 동명 제품은 색상, 용량, 크기 등 카테고리별 사양을 대조합니다. 사양이 같은 CPU는 같은 모델의 박스 또는 트레이 제품 사진을 사용할 수 있습니다. 데이터셋에서 판별할 수 없는 사진은 [검토한 제조사 이미지](../../data/hardware/reviewed_part_images.json)에서 찾습니다. 일치하는 사진을 확인할 수 없으면 PCPartPicker의 `no-image.png`를 저장합니다. 현행 실제 사진은 유지하며, 이후 실제 사진이 확인되면 대체 이미지를 교체합니다.

Doshiba 원본의 `specs.TDP`는 CPU 행에만 있습니다. GPU 제조사의 권장 PSU 용량과 PSU 정격 출력은 별도 사양입니다.

기존 CPU TDP, 제조사 검토 전력, PSU 산정용 추정값을 갱신할 때 아래 명령을 사용합니다. 첫 명령은 미리보기입니다.

```powershell
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.import_parts --power-only
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.import_parts --power-only --apply
```

`PSU_CAPACITY`는 독립 Python 검증 CLI의 계산입니다. DB가 제공하는 입력과 향후 RAG의 계산 위치는 [PSU 산정과 RAG의 경계](FLOW.md#psu-산정과-rag의-경계)에 정리했습니다.

기존 부품의 두 컬럼을 채울 때는 아래 명령을 사용합니다. 미리보기에서 매칭 건수와 갱신할 행 수를 확인합니다.

```powershell
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.import_parts --metadata-only
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.import_parts --metadata-only --apply
```

`--metadata-only`는 부품 ID, 가격, 견적, 호환성 자료를 유지합니다. 일반 부품 적재에도 `--with-images`를 추가하면 이미지 URL을 함께 가져옵니다. 이미지 조회를 생략한 새 행은 대체 이미지로 시작합니다.
고정 리비전의 다운로드는 SHA-256을 검사합니다. 이미 받은 JSONL을 읽으려면 `--image-dataset <경로>`를 사용합니다.

## 현재 카탈로그 원본

- 부품과 기준 가격은 [고정 리비전의 docyx 스냅샷](https://github.com/docyx/pc-part-dataset/tree/06ffc8eec068db5e8145e012ad2ec11e56a7c969/data/json)에서 가져옵니다. `specs._provenance`에 데이터셋, 리비전과 원본 매칭 키를 기록하고 `price_status=test`로 테스트 가격을 표시합니다.
- 공식 CPU 지원 및 RAM QVL은 [호환성 근거](../../data/hardware/docyx_compatibility.json)에 기록합니다. `import_parts --apply`가 금액이 있는 부품을 먼저 적재한 뒤 두 부품을 찾을 수 있는 호환성 근거를 연결합니다.
- 부품 고유 키는 분류·브랜드·제품명입니다. 원본 매칭 키는 `specs._provenance.source_key`에 보존하며, 가져오기 작업은 named lock으로 직렬화합니다. 오류가 나면 이번 적재에 포함된 데이터 변경을 롤백합니다.

<details>
<summary>이전 BuildCores·다나와 수집과 초기 표본 기록</summary>

이 기록은 이전 카탈로그의 작업 이력입니다. 아래의 `collect_parts` 명령과 `part_offers`는 당시 구조를 설명합니다. 현재 적재 절차는 [빠른 사용](#빠른-사용)을 따릅니다.

## 수집 환경과 갱신

팀 기준 Python 3.14, MySQL 8.4, Node.js 24를 사용합니다.
현재 Python 의존성은 프로젝트의 `backend/pyproject.toml`/`backend/uv.lock`에 있습니다.
다나와 도구는 `scripts/data/tools/package.json`과 lock 파일에 3.0.0으로 고정합니다.

```powershell
npm --prefix scripts/data/tools ci --cache scripts/data/.npm-cache --ignore-scripts --no-audit --no-fund
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.collect_parts

# BuildCores 스냅샷 또는 가격만 갱신
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.collect_parts --source catalog
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.collect_parts --source danawa

# 특정 제품만 다시 검색
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.collect_parts --source danawa --only amd-ryzen-5-7600

# BuildCores UUID 또는 품목 배치로 검색
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.collect_parts --source danawa --only 0bd31f89-46f3-487c-83d4-878518c4455a
uv run --directory backend --frozen python -X utf8 -m app.domains.hardware.ingestion.collect_parts --source danawa --category storage --offset 0 --limit 20
```

기본 원본은 [BuildCores OpenDB](https://github.com/buildcores/buildcores-open-db)입니다. `--catalog-revision`으로 40자리 스냅샷 SHA를 지정할 수 있습니다.
수집기는 지원 품목 8개를 변환하고, `raw/buildcores/`에 원본 아카이브·정규화 자료·출처 리비전을 보존합니다.
기본 가격 갱신은 검토 매핑의 부품을 검색합니다. `--only`와 `--category`로 검토 매핑이 없는 부품도 후보를 수집할 수 있습니다.
품목 배치는 수집한 스냅샷의 UUID 정렬 순서를 사용합니다. 다음 묶음은 같은 스냅샷에서 `--offset`을 늘리세요.

검색당 최대 20개 후보를 조회합니다. 일반 검색에서 해당 모델의 중고·리퍼비시 후보를 확인하지 못하면 각 키워드를 붙여 검색합니다.
필요한 경우 `part_matches.json`의 `used_query`와 `refurbished_query`로 추가 검색어를 지정합니다.
검색 실패와 빈 결과도 원본에 남깁니다.
실패는 국내 미판매·단종·호환 불가의 증거가 아닙니다. 수집 결과 중 보류가 있으면 종료 코드 2를 반환합니다.
원본은 UTC 시각별 폴더에 저장하며 `raw/collection_manifest.json`은 최신 파일을 가리킵니다.
각 실행의 manifest도 `raw/manifests/`에 보관합니다. `--only`는 그 제품의 포인터만 바꿉니다.
수집만으로 DB 값은 바뀌지 않습니다. 이후 `import_parts --apply`를 실행합니다.

## 파일 역할

| 위치 (저장소 루트 기준) | 내용 |
|---|---|
| `backend/app/db/connection.py` | 로컬 MySQL 연결 및 환경변수 |
| `backend/app/db/schema.py` | 연결 확인 및 최초 테이블 생성 CLI |
| `backend/app/db/sql/parts_catalog.sql` | 부품 DB 최초 생성 SQL과 PK·FK·CHECK·인덱스 |
| `backend/app/domains/hardware/ingestion/` | 수집·가격 추출·부품/호환성 가져오기·무결성 점검 |
| `backend/tests/hardware_data/` | 정규화·가격·호환성·경로·설정 및 MySQL 제약 검증 |
| `scripts/data/tools/` | danawa-cli 3.0.0과 npm lockfile |
| `data/hardware/part_matches.json` | 원본 ID, 제품 식별, 선택 상품코드, 검토 상태 |
| `data/hardware/reviewed_specs_overrides.json` | 수동 검토 원본은 보존하고, 적용할 사양 보정과 제조사 출처 키를 지정 |
| `data/hardware/raw/` | BuildCores 스냅샷, 이전 PC Builder 원본, 다나와 응답/HTML, 제조사 수동 검토, manifest |
| `data/hardware/processed/` | 가져오기에 사용하는 정규화 결과 |
| `data/hardware/reports/` | 실행 보고서, 무결성 점검, DB 부품 스냅샷 |
| `docs/database/erd/` | Mermaid, Graphviz, SVG, PNG |
| `backend/app/db/render_erd.py` | 스키마 SQL을 읽어 ERD 생성 |

아래의 `raw/`, `processed/`, `reports/`, `part_matches.json`은 모두 `data/hardware/` 기준입니다.
manifest의 상대 경로는 이 기준 디렉터리 내부를 가리키므로 기존 수집 이력을 그대로 사용할 수 있습니다.
`data/hardware/raw/`는 `.gitattributes`에서 줄바꿈 변환을 제외합니다. 다운로드한 원본 바이트와
기록된 SHA-256을 보존하기 위한 설정이며, 원본 HTML을 포매터로 다시 저장하지 마세요.

재배치 시 원본·매칭 파일 94개가 작업 전 Git 스냅샷과 바이트 단위로 같음을 확인했습니다.
다만 기존 HTML 18개는 그 스냅샷에서도 수집 당시 `sha256`과 다릅니다. Git에 저장된 LF 줄바꿈에서
수집 당시 혼합 줄바꿈을 정확히 복구할 수 없어, 수집 해시는 변경하지 않고 현재 보관 파일의 해시를
`data/hardware/reports/layout_integrity.json`에 별도 기록했습니다. 원본 바이트 검증이 필요한 경우
새 타임스탬프 폴더로 다시 수집해야 하며 기존 증거 파일을 덮어쓰지 않습니다.

`raw/manufacturer`의 JSON/TXT는 2026-11-11 대화에서 제조사 페이지를 직접 확인한
결과를 옮긴 **수동 검토 기록**입니다. 제조사 HTML 원문 전체를 다운로드한 파일로 표시하지 않습니다.
자동 QVL 크롤러는 구현하지 않았습니다. 추가 자료는 원문을 확인한 뒤 이 기록에 추가합니다.

## 최초 표본 기록

- 기존 스냅샷은 30개 표본 중 구체적 제품 27개를 저장한 기록입니다. 이후 정확한 QVL RAM을 한 개 추가했습니다.
  신규 적재는 아래 판매 상품 검증 기준을 적용합니다.
- `RTX 5060 Ti 16GB` 제품군 1개, 정확한 MPN이 없는 삼성 16GB/32GB 집계상품 2개는
  `part_matches.json`의 `import_enabled=false`로 보류합니다.
- ASRock QVL에서 확인한 삼성 `M323R2GA3DB0-CWMOD`를 별도 추가하여 총 28개입니다.
  이 모듈에 기존 삼성 16GB 집계상품의 가격이나 QVL을 자동으로 연결하지 않습니다.
- 공식 호환성은 CPU 지원 12건과 RAM QVL 9건, 총 21건입니다.
  CPU 4종 × 메인보드 3종, ASUS Flare 32GB 2계열, MSI Flare 32GB 1계열,
  ASRock 삼성 RAM 3계열, G.SKILL Flare 64GB/MSI 보드 3계열을 기록합니다.
- 사용자·상담·메시지·견적·견적 항목·견적 검증 결과는 서비스 이용 중 생성되므로 초기 입력하지 않습니다.
  과거 설명용 ID나 테스트용 견적을 실제 사용자 데이터로 넣지 않습니다.

## 제품 식별과 재실행

`parts`는 독립 자동 증가 PK를 사용합니다. 가져오기에서는 검토한 분류·제조사·정규 제품명을
고유하게 사용하고 원본 키를 `specs._provenance.source_key`에 보존합니다.
이름 유사도만으로 후보를 선택하지 않습니다. 가격 연결에는 검토한 상품코드와 전체 상품명이 모두 필요합니다.
키트 수량, RGB, 세대, 색상, OC, 방열판, 모델 접미사를 다른 제품으로 구분합니다.
정규 제품명 변경·중복 키·모델번호 변경은 수동 검토 후 수정하세요.
기존 검토 모델은 BuildCores UUID를 `buildcores_id`로 연결하거나 제조사·정확한 모델 식별자가 유일하게 일치할 때 기존 `source_key`를 재사용합니다.
BuildCores 전용 검토 모델은 `buildcores_parts`에 기록합니다. 검토 매핑 없이 조회한 모델은 품목과 유일한 MPN이 다나와 상품명에 정확히 일치할 때만 자동 연결합니다.

`part_matches.json`의 모델에 `danawa_offers` 배열을 추가하면 검토한 상품코드를 여러 건 연결할 수 있습니다.
각 항목에 `danawa_product_code`와 `expected_listing_name`을 기록합니다. 기존 최상위 상품코드는 기본 매핑입니다.
상품 상세의 제목 표기나 `itemCondition`으로 상태를 확인합니다. 같은 다나와 상품코드 상세에서 수동으로 상태를 검토한 경우에는
해당 상품에 `condition_review`를 추가하고 `condition`, 실제 표기를 담은 `evidence`, 같은 상품코드의 `source_url`을 남깁니다.
미검토 후보는 미리보기의 `listing_reviews`에 나옵니다. 제목·상세·수동 검토가 서로 불일치하면 보류합니다.

호환성 근거의 고유 키는 `conditions._record_key`에 보존합니다.
같은 부품 두 개라도 CPU 계열·QVL 조건·출처가 다르면 여러 근거 행이 존재할 수 있습니다.
가져오기 명령끼리는 MySQL named lock으로 직렬화합니다. 재실행 시 기존 ID를 유지해 갱신합니다.
오류가 나면 해당 가져오기 작업의 DML을 모두 롤백합니다.
가격 조건으로 부품이 아직 적재되지 않은 호환성 근거는 `PART_NOT_IMPORTED`로 보고하고 원본에 보존합니다.

## 가격 정책

금액은 KRW, `DECIMAL(15,2)`입니다. 배송비·조립비 컬럼은 없습니다.
본체 총액은 견적 항목의 `unit_price × quantity` 합계입니다.
가격 미확인 상태는 `NULL`이며 0원으로 대체하지 않습니다.
새 부품은 **검색에서 반환된 정확한 상품코드의 신품·중고·리퍼비시 가격을 하나 이상 검증한 경우** 적재합니다.
`part_offers`에는 검증된 `NEW`, `USED`, `REFURBISHED`의 상품가를 상품코드별로 저장합니다.
미확인·가격 보류 건과 상태별 준비 건수는 미리보기에서 확인합니다.
`parts.current_price`는 검증된 기본 신품 가격을 담는 기존 필드입니다. 리퍼비시만 가격을 확인한 모델의
가격과 중고 가격은 `part_offers`에서 확인합니다. 기존 부품과 호환성 행은 자동 삭제하지 않습니다.

CLI의 `minPrice`는 원본 응답에 보존합니다. 현재 수집기는 매칭한 상품의 페이지도 확인하여
`sell-price`의 **`data-base-price`와 `data-delivery-price`가 별도 제공되는 경우** 상품 금액만 사용합니다.
페이지의 상품명·상품코드도 대조합니다. 배송비를 추정해서 빼거나 표시 합계를 그대로 복사하지 않습니다.
페이지 구조가 바뀌거나 상품 금액이 분리 확인되지 않으면 가격을 보류합니다.
`part_matches.json`의 `price_basis=COMPONENT_ONLY`는 별도로 근거를 검토한 경우에만 설정하는 수동 대안이며
초기 매핑은 모두 `UNVERIFIED`입니다.

수집 실패·잘못된 가격·이전 시각의 가격으로 기존 유효 가격을 덮어쓰지 않습니다.
상세 페이지에서 명시적 품절을 확인하면 기존 판매 상품의 판매 상태만 갱신합니다. 검색 실패와 재고 미확인은 그대로 보류합니다.
`parts.current_price` 갱신은 `quote_items.unit_price`를 변경하지 않습니다.
가격 확인은 재고, 결제 가능 여부, 국내 최저 구매비용 전체를 보장하지 않습니다.

</details>

## 사양과 호환성 조건

사양에는 숫자 단위를 필드명으로 나타냅니다: `length_mm`, `wattage_w`, `capacity_gb`, `speed_mtps`.
메모리의 `modules_per_item`은 상품 1개 안의 모듈 수입니다. 2개입 키트 1개 구매는
견적 수량 1, 장착 DIMM 수 2입니다. TDP와 GPU TGP를 실측 최대 소비전력으로 취급하지 않습니다.
원본의 게임 등급·추천 설명은 하드웨어 사양에 넣지 않습니다.
PSU의 물리 규격 `ATX`와 전기 표준 `atx_version=3.1`을 구분합니다.
MSI A850GS는 PSU 쪽 포트 수와 GPU용 동봉 케이블 수를 구분하여 동봉 16핀 케이블 1개를 사용합니다.
사양 JSON의 `_provenance`에는 출처, 검토 상태, 상품코드, 가격 상태를 남깁니다.

- CPU 최소 BIOS: `bios_scope=MIN_VERSION`, `min_bios_version`에 명시된 버전.
- ASUS의 `ALL`: 모든 BIOS 지원 표기. 정보 없음과 구별합니다.
- RAM QVL 시험 BIOS: `conditions.tested_bios`. CPU 최소 BIOS로 복사하지 않습니다.
- CPU 계열, RAM 정확한 MPN, 장착 DIMM 수, 시험 속도·전압·프로파일은 적용 조건입니다.
- QVL에 없는 조합은 미확인입니다. 근거 없이 `UNSUPPORTED` 행을 생성하지 않습니다.
- G.SKILL QVL은 RAM 제조사의 근거입니다. MSI 자체 QVL과 검증 주체를 구분합니다.
- BIOS 버전 문자열을 단순한 사전순 또는 숫자 크기로 비교하지 마세요.

시간은 UTC로 저장하며 화면에서 KST로 변환합니다. 원문 갱신일은 JSON의 `source_updated_on`에 보존합니다.
날짜가 있는 근거에는 `conditions.source_date_precision=day`를 기록합니다.
호환성 근거를 처음 확인한 날짜는 `conditions.evidence_checked_on`에 보존합니다.

## 견적 저장 시 애플리케이션이 지킬 사항

모든 테이블은 단일 독립 PK이며 FK를 PK에 포함하지 않습니다.
검증 대상 항목이 다른 견적에 속하지 못하도록 복합 FK로도 소속을 확인합니다.
필요한 FK는 삭제 제한을 사용해 과거 기록이 의도 없이 지워지지 않게 합니다.

기존 부품과 호환성 자료는 `app.db.catalog`의 `list_parts`와 `list_compatibility`에서 조회합니다.
결제 성공을 확인한 호출자는 기존 사용자 ID, 견적 유형(`UPGRADE` 또는 `NEW_BUILD`), 결제 식별값과 완료 시각, 목표 성능, 부품별 결제 단가와 선택 근거를 `app.db.paid_quotes`의 `PaidQuote` 및 `PaidQuoteItem`으로 구성합니다.
열린 트랜잭션이 없는 연결을 `save_paid_quote(connection, quote)`에 넘기면 최종 견적과 품목이 한 트랜잭션으로 저장됩니다. 총액은 품목별 단가와 수량으로 확인하며, 동일한 결제 식별값의 재전달은 같은 견적을 반환합니다.
구매한 품목은 `get_paid_quote(connection, user_id=..., quote_id=...)`에서 해당 사용자의 저장 시점 정보로 조회합니다. 결제 전 초안의 수명은 상담 흐름에서 관리합니다.

## ERD와 테스트

생성된 ERD는 [SVG](erd/schema.svg) 또는 [PNG](erd/schema.png)로 볼 수 있습니다. 재생성에는 Graphviz의 `dot` 명령이 필요합니다.
그림은 `backend/app/db/sql/parts_catalog.sql`에서 컬럼을 추출하고 관계를 점선으로 그립니다.
SQL의 FK를 추가·변경할 경우 `backend/app/db/render_erd.py`의 관계 목록도 함께 갱신하세요.
SVG의 `?`는 NULL 허용을 뜻합니다.

```powershell
uv run --directory backend --frozen python -X utf8 -m app.db.render_erd
uv run --directory backend --frozen pytest tests/hardware_data -q

# 실제 DB 제약 및 재실행 검사. 테스트용 행은 모두 롤백됨
$env:RUN_MYSQL_TESTS='1'
uv run --directory backend --frozen python -X utf8 -m unittest tests.hardware_data.test_mysql -v
Remove-Item Env:RUN_MYSQL_TESTS
```

## 출처

- [BuildCores OpenDB](https://github.com/buildcores/buildcores-open-db) ([CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)). 부품 사양 일부의 필드와 표기를 프로젝트 형식으로 변환했습니다. 사용한 리비전과 원본 링크는 수집 manifest와 부품 출처에 기록합니다.
- TechFuelHQ PC Builder Parts Dataset (CC BY 4.0): https://techfuelhq.com/tools/pc-builder/
  원본: https://github.com/iBlessi/pc-builder-parts . 선택·정규화·공식 사양 보완을 수행했습니다.
- danawa-cli 3.0.0: https://github.com/tellang/danawa-cli . 코드 라이선스 및 이용 안내는 해당 저장소 참고.
- ASRock CPU/RAM: https://www.asrock.com/mb/AMD/A620AM-HVS/index.asp#Support
- ASUS CPU: https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b850-plus-wifi/helpdesk_cpu?model2Name=TUF-GAMING-B850-PLUS-WIFI
- ASUS RAM: https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b850-plus-wifi/helpdesk_qvl_memory?model2Name=TUF-GAMING-B850-PLUS-WIFI
- MSI CPU: https://www.msi.com/Motherboard/MAG-B650-TOMAHAWK-WIFI/support#cpu
- MSI RAM: https://ca.msi.com/Motherboard/MAG-B650-TOMAHAWK-WIFI/support#mem
- G.SKILL RAM: https://www.gskill.com/qvl/165/396/1691400033/F5-6000J3040G32GX2-FX5-QVL

추가 사양 출처는 `raw/manufacturer/pilot_specs_review.json`의 `sources`에 있습니다.
