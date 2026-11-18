# 2026-11-18 RAG 통합 데이터 최종본

오늘 공유용으로 확정한 최종 데이터 패키지입니다. 내부 원본 시트의 기준일과 산출물 파일명은 2026-11-17이며, 2026-11-18 폴더는 팀 공유 등록일 기준입니다. 기존 원본 Google Sheets는 수정하지 않았습니다.

## 다운로드

- [전체 데이터 ZIP](BUILDWISE_RAG_통합데이터_최종본_2026-11-17.zip): 데이터 사전, ID 충돌·조인 안내, ID 배정표, 정규화 CSV/JSONL 등 전체 패키지
- [확인용 Excel](BUILDWISE_RAG_데이터_통합_최종본_2026-11-17.xlsx): 시트별 통합 결과와 ID 배정표를 빠르게 확인
- [Google Sheets 최종본](https://docs.google.com/spreadsheets/d/1OOguiAQCe1_D4CHUZweHut-FTDGw36N0BuO9Ws6_sZ0/edit)

## 압축 해제 후 읽는 순서

1. `데이터화/ID_충돌_및_조인_가이드.md`
2. `데이터화/데이터_사전.md`
3. `global_id_assignment.csv`, `source_key_assignment.csv` 또는 Excel의 ID 배정 탭
4. `데이터화/normalized/`의 정규화 CSV/JSONL

## 무결성 확인

PowerShell에서 다운로드한 파일이 이 폴더의 파일과 같은지 확인할 수 있습니다.

```powershell
Get-FileHash .\BUILDWISE_RAG_통합데이터_최종본_2026-11-17.zip -Algorithm SHA256
Get-FileHash .\BUILDWISE_RAG_데이터_통합_최종본_2026-11-17.xlsx -Algorithm SHA256
```

- ZIP SHA-256: `FF32588B0EC12B69661C910CD920304AF2CBC7D711BDEDAFB136F287A3AA1261`
- Excel SHA-256: `899ECC2C0043C543DAD21D412D9BCC28C6455BEE63DB66BD8D6E359F08C7B13A`

이 패키지는 두 원본 시트에 있던 수집·정리 자료를 통합하고 전역 ID 및 출처 연결을 정리한 결과입니다. 공식 웹페이지의 원문 전체를 새로 내려받아 저장한 패키지는 아닙니다. 상세한 데이터 범위와 미확인 항목은 ZIP 안의 안내서를 확인하세요.
