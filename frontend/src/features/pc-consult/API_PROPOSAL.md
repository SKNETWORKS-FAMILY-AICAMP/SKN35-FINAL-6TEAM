# PC 상담 API 제안

이 문서는 프론트 화면을 위한 **검토용 제안**입니다. 실제 API 경로·공통 계약·백엔드를 변경하지 않았습니다. 적용하려면 별도 계약 변경 PR이 필요합니다. 현재 `snapshotSource`는 정적 JSON을 처음 사용할 때 한 번 읽고 메모리에서만 처리합니다. `apiSource`는 연결 전이라는 오류를 반환하며 네트워크를 호출하지 않습니다.

참조: [DB 흐름](../../../../../docs/database/FLOW.md), [테이블 SQL](../../../../../backend/app/db/sql/parts_catalog.sql). SQL은 MySQL `dev_database`이며 `quotes`, `quote_items`에 버전과 당시 단가를 보존합니다. `source_key`는 스냅샷의 안정 키이고 실제 `parts` SQL 컬럼은 아닙니다. API 어댑터가 적재 식별자 매핑으로 서버의 `part_id`로 해결해야 하며, 프론트의 스냅샷 `part_id`를 서버 ID로 사용하면 안 됩니다.

## 공통 원칙

- 아래 경로는 모두 신설 제안입니다. 기업·사용자 범위는 인증된 서버 컨텍스트에서 결정하며 클라이언트 입력을 권한으로 신뢰하지 않습니다.
- 서버는 가격, 재고, 호환성, 예산, 견적 총액을 다시 계산합니다. 프론트의 간이 판단을 실제 검증으로 저장하지 않습니다.
- 검사 상태: `PASS`, `CONDITIONAL`, `UNKNOWN`, `FAIL`. 화면의 `PENDING`은 아직 선택하지 않은 부품 검사에만 쓰는 로컬 상태입니다.
- 응답에 `basis: "api"`, 검사 이유·출처·조건, 판정 시각·카탈로그 기준 버전을 포함합니다.
- 검증할 정보가 없으면 `UNKNOWN`입니다. `UNKNOWN`을 AI 추천 또는 통과 후보로 반환하지 않습니다.
- 새 조립에 판매량이 없으면 `sort: "price_asc"`, `sort_reason: "판매량 데이터 준비 중"`을 반환합니다. 성능 데이터가 없으면 실제 적용한 사양 하한만 안내합니다.
- 오류 예: `400 INVALID_INPUT`, `409 QUOTE_VERSION_CONFLICT`, `422 INCOMPATIBLE_CONFIGURATION`, `503 CATALOG_UNAVAILABLE`. 필드 오류는 `{ field, message }` 목록으로 반환합니다.
- 현재 기업용·개인용 진입은 시연입니다. 실제 인증·회원 관리 API는 이 문서의 네 가지 상담 API와 별도로 정의해야 합니다.

## 1. 후보 조회 (POST /api/pc-consult/candidates)

요청 예시:

```json
{
  "consultation_id": "demo-session-1",
  "mode": "new",
  "category": "motherboard",
  "survey": {
    "budget": 2000000,
    "purposes": ["gaming"],
    "resolution": "qhd",
    "frame_rate": 60,
    "work_scale": "basic"
  },
  "owned": [],
  "selected": [{ "category": "cpu", "source_key": "amd-ryzen-5-7600" }],
  "category_budget": 300000,
  "conditions": { "color": null, "note": "" },
  "cursor": null,
  "limit": 10
}
```

응답 예시 (아래 가격과 근거는 제공된 테스트 스냅샷 사례):

```json
{
  "basis": "api",
  "sort": "price_asc",
  "sort_reason": "판매량 데이터 준비 중",
  "criteria": ["CPU 6코어 이상", "GPU VRAM 8GB 이상"],
  "passed": [
    {
      "source_key": "mb-b650-tomahawk",
      "name": "MSI MAG B650 TOMAHAWK WIFI",
      "price": 257969,
      "price_status": "test",
      "recommended": true,
      "reason": "통과한 후보 중 가장 저렴합니다.",
      "validation": {
        "status": "CONDITIONAL",
        "checks": [
          {
            "code": "CPU_SUPPORT",
            "status": "CONDITIONAL",
            "min_bios_version": "7D75v10",
            "source_publisher": "MSI"
          }
        ]
      }
    }
  ],
  "needs_review": [],
  "rejected_count": 0,
  "missing_color_count": 0,
  "next_cursor": null
}
```

`passed`에는 통과 또는 조건부만 넣으며 첫 후보 한 개에만 추천을 지정합니다. 조건부 BIOS 버전이 없는 경우 제조사 조건의 추가 확인을 명시합니다. 데이터에 색상 정보가 없으면 별도 개수를 반환합니다. 예산 재배분은 이 조회를 변경된 예산으로 호출하고, 기존 선택품의 대체안과 대체 전후 예상 총액을 별도 필드로 확장할 수 있습니다. 자동 교체하지 않고 사용자의 수락을 받습니다.

## 2. 호환성 검증 (POST /api/pc-consult/validations)

요청 예시:

```json
{
  "consultation_id": "demo-session-1",
  "scope": "configuration",
  "selected": [
    { "category": "cpu", "source_key": "amd-ryzen-5-7600", "quantity": 1 },
    { "category": "motherboard", "source_key": "mb-b650-tomahawk", "quantity": 1 }
  ],
  "owned": [],
  "complete": false
}
```

응답 예시:

```json
{
  "basis": "api",
  "status": "CONDITIONAL",
  "complete": false,
  "checks": [
    {
      "code": "CPU_SUPPORT",
      "status": "CONDITIONAL",
      "message": "최소 BIOS 7D75v10 조건을 확인해 주세요.",
      "source_publisher": "MSI"
    }
  ],
  "pending_categories": ["ram", "gpu", "storage", "cooler", "psu", "case"]
}
```

후보 조회는 해당 부품에 관련된 검사만 평가합니다. 최종 견적에서는 전체 구성을 다시 검증합니다. `CPU_SUPPORT`를 소켓 비교보다 우선하고, RAM의 규격·용량·모듈 수를 QVL과 별도로 검사합니다. 보유 부품의 직접 입력값은 `source_key: null`, `verification: "unverified"`로 전달합니다.

## 3. 견적 생성 (POST /api/pc-consult/quotes)

요청 예시:

```json
{
  "consultation_id": "demo-session-1",
  "expected_previous_version": 0,
  "items": [{ "category": "gpu", "source_key": "gpu-msi-3060-ventus-2x-12g", "quantity": 1 }]
}
```

응답 예시 (GPU 단품 교체 상담):

```json
{
  "quote_id": "server-quote-id",
  "consultation_id": "demo-session-1",
  "version": 1,
  "status": "DRAFT",
  "currency": "KRW",
  "total_amount": 408526,
  "created_at": "2026-11-18T07:24:32Z",
  "quote_items": [
    {
      "source_key": "gpu-msi-3060-ventus-2x-12g",
      "part_name_snapshot": "MSI GeForce RTX 3060 Ventus 2X 12G",
      "unit_price": 408526,
      "quantity": 1
    }
  ],
  "validation": {
    "status": "UNKNOWN",
    "checks": [
      { "code": "CASE_GPU", "status": "UNKNOWN", "message": "보유 케이스 길이 정보가 없습니다." }
    ]
  }
}
```

서버가 가격과 총액을 확정하며 버전은 상담별로 단조 증가합니다. 변경 요청은 기존 행을 수정하지 않고 새 버전을 만듭니다. 이미 승인된 버전은 이력으로 남고 새 버전은 `DRAFT`로 재승인 대기합니다. 호환 불가 `FAIL` 구성은 견적 생성 오류로 반환합니다. 조건부·확인 불가 항목은 승인 확인 화면까지 보존합니다.

## 4. 견적 승인·저장 (POST /api/pc-consult/quotes/{quote_id}/confirm)

요청 헤더: `Idempotency-Key: consultation-id:quote-version`

요청 예시:

```json
{
  "quotes": {
    "consultation_id": "demo-session-1",
    "version": 1,
    "status": "CONFIRMED",
    "total_amount": 408526,
    "currency": "KRW"
  },
  "quote_items": [
    {
      "source_key": "gpu-msi-3060-ventus-2x-12g",
      "category": "gpu",
      "part_name_snapshot": "MSI GeForce RTX 3060 Ventus 2X 12G",
      "unit_price": 408526,
      "quantity": 1,
      "price_checked_at": "2026-11-18T07:24:32.006880+00:00"
    }
  ]
}
```

응답 예시:

```json
{
  "quote_id": "server-quote-id",
  "version": 1,
  "status": "CONFIRMED",
  "storage": "database",
  "saved": true
}
```

서버는 저장된 현재 버전·총액·부품 스냅샷과 요청의 일치를 확인하고 트랜잭션으로 저장합니다. 새 견적이 생성된 뒤 이전 미승인 버전 승인 시 `409`를 반환합니다. 같은 승인 요청을 반복해도 중복 저장하지 않습니다. 승인된 부품·단가와 이전 버전은 덮어쓰지 않습니다.

스냅샷 구현의 같은 인터페이스는 `storage: "memory"`, `message: "시연 저장 (DB에 기록 안 됨)"`을 반환합니다. 실제 DB 저장 응답을 흉내 내지 않습니다. 부품 교체의 결제 안내 화면은 이 성공 응답을 받은 후에만 열립니다.

## 간이 기준표와 데이터 한계

모든 시연 판단은 `data/demoRules.ts`에 모였습니다. `DEMO_RULES`는 실제 성능의 검증 결과가 아닌 UX 시연 기준입니다.

| 항목          | 기준                                                    | 이유                                                                                      |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 전력 여유     | 소비 부품 합계 +25%                                     | 시연에서 여유 있는 정격 비교를 설명하기 위한 일정 비율. PSU 자체 소비전력은 합산하지 않음 |
| CPU           | 게임·이미지 6코어, 동영상 8코어, 기타 4코어; 큰 작업 +2 | 작업 규모에 따른 사양 하한 예시                                                           |
| GPU           | FHD 6GB, QHD 8GB, 4K 12GB; 144프레임 목표 +2GB          | 목표 선택에 따라 VRAM 하한을 달리하는 시연. FPS 보장 아님                                 |
| RAM           | 기본 16GB, 큰 작업 32GB                                 | 작업 규모별 최소 용량 예시                                                                |
| 저장장치      | 기본 500GB, 큰 작업 1TB                                 | 작업 규모별 공간 예시                                                                     |
| 예산 순서     | CPU / 보드 / RAM / GPU / 저장 / 쿨러 / 파워 / 케이스    | 신규 조립의 고정 8단계                                                                    |
| 게임 예산 %   | 20 / 13 / 10 / 32 / 8 / 4 / 7 / 6                       | GPU 비중 높임                                                                             |
| 이미지 예산 % | 24 / 14 / 16 / 18 / 12 / 4 / 7 / 5                      | CPU와 RAM 비중 높임                                                                       |
| 동영상 예산 % | 25 / 12 / 15 / 23 / 11 / 4 / 6 / 4                      | CPU·GPU·RAM에 배분                                                                        |
| 기타 예산 %   | 24 / 16 / 13 / 18 / 12 / 4 / 7 / 6                      | 일반적인 시연 배분                                                                        |

목적이 여러 개면 비율을 평균하고, 한 분류 예산을 고정하면 남은 분류를 그 비중대로 다시 나눕니다. 반올림 잔여 원은 마지막 분류에 배정해 총합을 보존합니다. 교체 문제는 게임은 GPU, 여러 프로그램은 RAM, 저장 공간은 저장장치, 편집·렌더링은 CPU, 발열·소음은 쿨러, 전원 불안정은 파워로 연결합니다. 이는 고장 진단이 아닙니다.

CPU 492개 중 소켓 값은 24개이며, 제조사 CPU 근거가 있는 CPU는 445개입니다. 케이스 GPU 허용 길이는 1,048개 중 8개, 쿨러 지원 소켓은 942개 중 1개에만 있습니다. 따라서 케이스·쿨러는 확인 불가가 많습니다. 저장장치의 연결 포트 사양은 메인보드 데이터에 없어 별도 확인이 필요합니다. 가격순 최저가 CPU를 선택하면 해당 CPU의 보드 예산이 부족해질 수 있습니다. 빈 후보는 예산 변경·앞 단계 변경으로 해결하며 누락 사양을 만들어 통과시키지 않습니다.
