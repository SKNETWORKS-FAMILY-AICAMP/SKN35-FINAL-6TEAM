# 2026-11-17 공유 데이터 다운로드

이 폴더에는 팀원이 받을 **공유 데이터 ZIP 하나와 이 안내서만** 있습니다. 봇·검색 로그·보고서·시각화·일일 작업일지는 [2주차 11월 17일 작업 폴더](../../작업일지/주차별/2주차/11월17일/)에서 확인합니다.

## 다운로드

- [2026-11-17 공유 데이터 전체 ZIP](https://raw.githubusercontent.com/SKNETWORKS-FAMILY-AICAMP/SKN35-FINAL-6TEAM/ssu/docs/%EB%8D%B0%EC%9D%B4%ED%84%B0_%EC%88%98%EC%A7%91/2026-11-17/2026-11-17_%EA%B3%B5%EC%9C%A0%EB%8D%B0%EC%9D%B4%ED%84%B0_%EC%9D%BC%EA%B4%84%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C.zip)
- 크기: 76,628,126 bytes
- SHA-256: `1085284418344EE4F8B4710546D501BC8E7C98B89BACB0A67AF08C15D77DA4E0`

Windows PowerShell에서 압축을 풀고 파일 무결성을 확인합니다.

```powershell
Get-FileHash .\2026-11-17_공유데이터_일괄다운로드.zip -Algorithm SHA256
Expand-Archive .\2026-11-17_공유데이터_일괄다운로드.zip -DestinationPath .\2026-11-17_공유데이터
```

## 압축에 들어 있는 파일

| 파일 | 용도 |
|---|---|
| `benchmark_runs_load_ready.csv` | 부품 연결을 확인한 벤치마크 run의 적재 검토 후보 |
| `benchmark_runs_preview.csv` | 매칭 보류를 포함한 벤치마크 전체 변환본. 전체 분석·감사용 |
| `benchmark_run_parts_preview.csv` | run과 식별된 부품 간 연결 검토표 |
| `parts_with_benchmark_references_preview.csv` | 판매용 부품과 구분한 참조 GPU 모델 포함 부품표 |
| `parts_import_preview.csv` | `parts` 적재 후보 |
| `source_part_crosswalk.csv` | 원본 부품 행과 생성한 부품 ID 간 추적표 |
| `unmatched_hardware.csv` | 부품 매칭이 안 된 하드웨어 상세 검토표 |
| `unmatched_hardware_summary.csv` | 미매칭 유형 요약 |
| `benchmark_import_manifest.json` | 벤치마크 변환 건수·출처·매핑 기록 |
| `parts_import_manifest.json` | 부품 원본 revision·해시·정규화 기록 |
| `README.txt` | 압축 안에서 보는 간단 안내 |

## 어떤 파일을 사용하나

- 전체 결과를 검토하려면 `benchmark_runs_preview.csv`를 봅니다.
- 연결이 확인된 run과 부품 구성을 검토하려면 `benchmark_runs_load_ready.csv`, `benchmark_run_parts_preview.csv`, `parts_with_benchmark_references_preview.csv`를 함께 봅니다.
- 카탈로그 입력 후보와 원본 행을 추적하려면 `parts_import_preview.csv`와 `source_part_crosswalk.csv`를 봅니다.
- 매칭 보류 원인을 확인할 때는 `unmatched_hardware.csv`와 요약표를 봅니다.

현재 산출물 기준 전체 run은 638,587건이고, 그중 부품 연결 검토 후보는 498,704건입니다. 부품 카탈로그 후보는 43,706행이며, 참조 GPU를 더한 부품표는 43,955행입니다.

## 사용 전 확인

CSV는 적재 검토 산출물이며 실제 DB에 넣은 데이터가 아닙니다. ERD 8개 테이블을 유지하기로 했으므로 DB 담당자와 실제 저장 위치·필드·PK/FK를 먼저 맞춥니다. 검증 전에는 추천이나 견적에 바로 사용하지 않습니다.

원본 데이터 재수집이 필요하면 [출처 링크와 이용 조건](../README.md)을 확인하고, 봇 사용법·분야별 한계는 [작업 기록 폴더](../../작업일지/주차별/2주차/11월17일/)를 참고합니다.
