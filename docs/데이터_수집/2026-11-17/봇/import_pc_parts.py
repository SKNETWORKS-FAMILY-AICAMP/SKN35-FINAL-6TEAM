#!/usr/bin/env python3
"""PC Part Dataset 고정 커밋의 CSV를 내려받고 parts 테이블 적재 미리보기로 변환한다."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import urllib.error
import urllib.request
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

REPO = "docyx/pc-part-dataset"
REVISION = "c52a04ca9465c83997ed335f7767b09a2005dd26"
DATASET_LAST_UPDATED = "2025-07-23"
BASE_URL = f"https://raw.githubusercontent.com/{REPO}/{REVISION}/data/csv"
OUTPUT_ROOT = Path(__file__).with_name("output")
RAW_DIR = OUTPUT_ROOT / "raw" / "pc-part-dataset_c52a04ca" / "csv"
NORMALIZED_DIR = OUTPUT_ROOT / "normalized" / "pc-part-dataset_c52a04ca"

# GitHub tree blob SHA-1 values captured from this exact immutable commit.
FILES = {
    "cpu": "351643ea4df542e38313fafc5886dd7502cdf8c5",
    "cpu-cooler": "25d2aca708a1a561a17e1135d93fd5dbc7e35166",
    "motherboard": "d8c8cc02ba30896d1d1fa5aa287074efd129473b",
    "memory": "127ab9d4867dd7a0e3adda5f10e31775823967c0",
    "internal-hard-drive": "18db917eb9ee7d3bd55a4687e8468bc9d6b19927",
    "video-card": "a4447baab0a7782a2416296e0cce75b7d43fe441",
    "case": "a38b3dba748bf30abcc40220e3f8c061f8fab004",
    "power-supply": "d2f7c0298e6ff86e7ff9fc983dc949d78e63a136",
}
CATEGORY_MAP = {
    "cpu": "cpu",
    "cpu-cooler": "cpu_cooler",
    "motherboard": "motherboard",
    "memory": "memory",
    "internal-hard-drive": "storage",
    "video-card": "gpu",
    "case": "case",
    "power-supply": "psu",
}
NUMERIC_FIELDS = {
    "cpu": {"price", "core_count", "core_clock", "boost_clock", "tdp"},
    "cpu-cooler": {"price", "noise_level", "size"},
    "motherboard": {"price", "max_memory", "memory_slots"},
    "memory": {"price", "price_per_gb", "first_word_latency", "cas_latency"},
    "internal-hard-drive": {"price", "capacity", "price_per_gb", "cache"},
    "video-card": {"price", "memory", "core_clock", "boost_clock", "length"},
    "case": {"price", "psu", "external_volume", "internal_35_bays"},
    "power-supply": {"price", "wattage"},
}
ARRAY_FIELDS = {
    "cpu-cooler": {"rpm", "noise_level"},
    "memory": {"speed", "modules"},
}


class ImportErrorDetail(Exception):
    pass


def git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()


def download_sources() -> dict[str, dict[str, Any]]:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict[str, Any]] = {}
    for file_stem, expected_blob in FILES.items():
        filename = f"{file_stem}.csv"
        path = RAW_DIR / filename
        if path.exists():
            data = path.read_bytes()
        else:
            request = urllib.request.Request(
                f"{BASE_URL}/{filename}",
                headers={"User-Agent": "BUILDWISE-PC-Part-Importer/1.0"},
            )
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    data = response.read()
            except (urllib.error.URLError, TimeoutError) as exc:
                raise ImportErrorDetail(f"다운로드 실패: {filename}: {exc}") from exc
            path.write_bytes(data)

        actual_blob = git_blob_sha(data)
        if actual_blob != expected_blob:
            raise ImportErrorDetail(
                f"고정 커밋 파일 검증 실패: {filename}; 예상 {expected_blob}, 실제 {actual_blob}"
            )
        manifest[file_stem] = {
            "file": filename,
            "path": str(path),
            "url": f"https://github.com/{REPO}/blob/{REVISION}/data/csv/{filename}",
            "bytes": len(data),
            "git_blob_sha1": actual_blob,
            "sha256": hashlib.sha256(data).hexdigest(),
        }
    return manifest


def parse_scalar(value: str, numeric: bool) -> Any:
    value = value.strip()
    if not value:
        return None
    if not numeric:
        return value
    try:
        number = Decimal(value)
    except InvalidOperation:
        return value
    if number == number.to_integral_value():
        return int(number)
    return float(number)


def parse_value(category_file: str, key: str, value: str) -> Any:
    value = value.strip()
    if not value:
        return None
    if key in ARRAY_FIELDS.get(category_file, set()) and "," in value:
        return [parse_scalar(part, True) for part in value.split(",")]
    return parse_scalar(value, key in NUMERIC_FIELDS.get(category_file, set()))


def record_fingerprint(file_stem: str, row: dict[str, str], headers: list[str]) -> str:
    stable_record = [file_stem, [(key, (row.get(key) or "").strip()) for key in headers]]
    payload = json.dumps(stable_record, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def stable_id(fingerprint: str) -> int:
    # 15 hex digits fit a positive signed BIGINT.
    return int(fingerprint[:15], 16)


def read_category(file_stem: str) -> tuple[list[dict[str, str]], list[str]]:
    path = RAW_DIR / f"{file_stem}.csv"
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        headers = reader.fieldnames or []
        if "name" not in headers or "price" not in headers:
            raise ImportErrorDetail(f"필수 필드 name/price 누락: {path.name}")
        rows = list(reader)
    return rows, headers


def normalize_all(manifest: dict[str, dict[str, Any]]) -> dict[str, Any]:
    NORMALIZED_DIR.mkdir(parents=True, exist_ok=True)
    output_path = NORMALIZED_DIR / "parts_import_preview.csv"
    crosswalk_path = NORMALIZED_DIR / "source_part_crosswalk.csv"
    stats: dict[str, Any] = {}
    all_parts: list[dict[str, Any]] = []
    crosswalk: list[dict[str, Any]] = []
    seen_ids: dict[int, str] = {}

    for file_stem in FILES:
        rows, headers = read_category(file_stem)
        grouped_rows: dict[str, list[tuple[int, dict[str, str]]]] = {}
        for row_number, row in enumerate(rows, start=2):
            fingerprint = record_fingerprint(file_stem, row, headers)
            grouped_rows.setdefault(fingerprint, []).append((row_number, row))
        name_counts = Counter((row.get("name") or "").strip().casefold() for row in rows)
        name_fingerprints: dict[str, set[str]] = {}
        for row in rows:
            normalized_name = (row.get("name") or "").strip().casefold()
            name_fingerprints.setdefault(normalized_name, set()).add(record_fingerprint(file_stem, row, headers))
        category_stats = {
            "rows": len(rows),
            "unique_exact_records": len(grouped_rows),
            "fields": headers,
            "blank_counts": {h: sum(not (row.get(h) or "").strip() for row in rows) for h in headers},
            "distinct_names": len(name_counts),
            "rows_with_repeated_name": sum(count for count in name_counts.values() if count > 1),
            "repeated_name_groups": sum(1 for count in name_counts.values() if count > 1),
            "name_groups_with_distinct_records": sum(1 for records in name_fingerprints.values() if len(records) > 1),
            "exact_duplicate_rows_after_first": sum(len(group) - 1 for group in grouped_rows.values()),
        }
        stats[file_stem] = category_stats

        # CPU는 정확한 모델명이 곧 SKU 정체성이다. 같은 CPU 모델의 정적 사양이
        # 같고 원본 가격만 다른 레코드는 한 parts 행으로 묶고 모든 원본 행을 crosswalk에 보존한다.
        normalized_groups: list[tuple[str, list[tuple[str, list[tuple[int, dict[str, str]]]]]]] = []
        if file_stem == "cpu":
            cpu_buckets: dict[tuple[str, str], list[tuple[str, list[tuple[int, dict[str, str]]]]]] = {}
            static_signatures_by_name: dict[str, set[str]] = {}
            for fingerprint, group in grouped_rows.items():
                row = group[0][1]
                static_fields = [(key, (row.get(key) or "").strip()) for key in headers if key not in {"name", "price"}]
                normalized_name = (row.get("name") or "").strip().casefold()
                static_signature = json.dumps(static_fields, ensure_ascii=False, separators=(",", ":"))
                static_signatures_by_name.setdefault(normalized_name, set()).add(static_signature)
                bucket_key = (normalized_name, static_signature)
                cpu_buckets.setdefault(bucket_key, []).append((fingerprint, group))
            for members in cpu_buckets.values():
                normalized_groups.append((min(item[0] for item in members), members))
            category_stats["same_name_same_specs_groups_collapsed"] = sum(len(members) - 1 for members in cpu_buckets.values())
            category_stats["same_name_different_specs_groups_kept_separate"] = sum(
                1 for signatures in static_signatures_by_name.values() if len(signatures) > 1
            )
        else:
            normalized_groups = [(fingerprint, [(fingerprint, group)]) for fingerprint, group in grouped_rows.items()]

        for fingerprint, member_groups in normalized_groups:
            row_number, row = member_groups[0][1][0]
            source_key = f"{REPO}:{REVISION}:data/csv/{file_stem}.csv:record:{fingerprint}"
            part_id = stable_id(fingerprint)
            prior_fingerprint = seen_ids.get(part_id)
            if prior_fingerprint is not None and prior_fingerprint != fingerprint:
                raise ImportErrorDetail(f"part_id 해시 충돌 발생: {source_key}")
            seen_ids[part_id] = fingerprint
            tech_specs = {
                key: parse_value(file_stem, key, value)
                for key, value in row.items()
                if key not in {"name", "price"}
            }
            price_snapshots = []
            all_source_rows: list[tuple[str, int]] = []
            for member_fingerprint, member_group in member_groups:
                member_source_key = f"{REPO}:{REVISION}:data/csv/{file_stem}.csv:record:{member_fingerprint}"
                for line_number, member_row in member_group:
                    all_source_rows.append((member_source_key, line_number))
                source_price = parse_value(file_stem, "price", member_group[0][1].get("price") or "")
                if source_price is not None:
                    price_snapshots.append({
                        "amount": source_price,
                        "currency": "USD",
                        "dataset_last_updated": DATASET_LAST_UPDATED,
                        "source_key": member_source_key,
                        "note": "참고용 원본 스냅샷 가격이며 현재 판매가로 사용하지 않음",
                    })
            if price_snapshots:
                tech_specs["source_price_snapshots"] = price_snapshots
            tech_specs["source_keys"] = sorted({key for key, _ in all_source_rows})
            tech_specs["source_row_numbers"] = sorted(number for _, number in all_source_rows)
            tech_specs["source_name_duplicate_count"] = name_counts[(row.get("name") or "").strip().casefold()]
            tech_specs["source_name_distinct_record_count"] = len(name_fingerprints[(row.get("name") or "").strip().casefold()])
            tech_specs["source_exact_duplicate_group_size"] = sum(len(member_group) for _, member_group in member_groups)
            if file_stem == "cpu" and len(member_groups) > 1:
                tech_specs["source_same_model_record_count"] = len(member_groups)

            source_info = manifest[file_stem]
            source_url = source_info["url"]
            part = {
                "part_id": part_id,
                "category": CATEGORY_MAP[file_stem],
                "brand": "",
                "name": (row.get("name") or "").strip(),
                "model_number": "",
                "specs": json.dumps(tech_specs, ensure_ascii=False, separators=(",", ":")),
                "source_url": source_url,
                "verified_at": "",
                "current_price": "",
                "currency": "",
            }
            all_parts.append(part)
            for member_source_key, line_number in all_source_rows:
                crosswalk.append({
                    "part_id": part_id,
                    "category": part["category"],
                    "name": part["name"],
                    "source_key": member_source_key,
                    "source_row_number": line_number,
                    "source_file_url": source_url,
                    "match_status": "cpu_same_model_consolidated" if file_stem == "cpu" and len(member_groups) > 1 else "source_row_imported; manufacturer identity unverified",
                })

    part_columns = ["part_id", "category", "brand", "name", "model_number", "specs", "source_url", "verified_at", "current_price", "currency"]
    with output_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=part_columns)
        writer.writeheader()
        writer.writerows(all_parts)
    crosswalk_columns = ["part_id", "category", "name", "source_key", "source_row_number", "source_file_url", "match_status"]
    with crosswalk_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=crosswalk_columns)
        writer.writeheader()
        writer.writerows(crosswalk)

    result = {
        "dataset": REPO,
        "revision": REVISION,
        "dataset_last_updated": DATASET_LAST_UPDATED,
        "license_note": "저장소 LICENSE 표기와 스크레이핑된 PCPartPicker 원천 데이터 이용/재배포 조건은 별도 확인 필요",
        "source_files": manifest,
        "categories": stats,
        "source_row_count": sum(v["rows"] for v in stats.values()),
        "normalized_parts_count": len(all_parts),
        "exact_duplicate_rows_after_first": sum(v["exact_duplicate_rows_after_first"] for v in stats.values()),
        "source_repeated_name_groups": sum(v["repeated_name_groups"] for v in stats.values()),
        "source_name_groups_with_distinct_records": sum(v["name_groups_with_distinct_records"] for v in stats.values()),
        "normalization": {
            "part_id": "category와 전체 원본 행 지문에서 생성한 양수 BIGINT 해시. 완전히 동일한 원본 행은 한 부품으로 합치고 crosswalk에 각 행 번호를 연결.",
            "brand": "NULL (원본에 별도 필드 없음)",
            "model_number": "NULL (원본에 별도 필드 없음)",
            "source_url": "상품 페이지가 아니라 고정 커밋의 category CSV URL",
            "verified_at": "NULL (제조사 공식 출처와 아직 대조하지 않음)",
            "current_price": "NULL (원본 USD 가격은 오래된 스냅샷이므로 현재가로 넣지 않음)",
            "currency": "NULL (current_price가 NULL이므로; 원본 스냅샷 통화는 specs JSON에 보존)",
            "source_price_snapshots": "가격이 제공된 원본 행의 스냅샷 배열을 specs JSON에 보존",
            "cpu_same_model_policy": "동일 CPU 이름·동일 정적 사양은 한 parts 행으로 통합. 원본 가격 스냅샷과 모든 행은 specs/crosswalk에 보존. 정적 사양이 다르면 별도 행으로 남김.",
            "duplicate_policy": "완전히 같은 행은 한 parts 행으로 합치고 원본 행 번호는 crosswalk로 보존. 이름만 같고 속성/가격이 다른 행은 별도 유지하고 수동 검토 표시",
        },
        "outputs": {
            "parts_import_preview": str(output_path),
            "source_part_crosswalk": str(crosswalk_path),
        },
    }
    manifest_path = NORMALIZED_DIR / "import_manifest.json"
    manifest_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def run_import(download: bool = False) -> dict[str, Any]:
    try:
        if download:
            manifest = download_sources()
        else:
            missing = [f"{stem}.csv" for stem in FILES if not (RAW_DIR / f"{stem}.csv").is_file()]
            if missing:
                raise ImportErrorDetail(f"원본 파일이 없습니다. --download로 먼저 수집하세요: {', '.join(missing)}")
            manifest = {}
            for stem, expected_blob in FILES.items():
                path = RAW_DIR / f"{stem}.csv"
                data = path.read_bytes()
                actual_blob = git_blob_sha(data)
                if actual_blob != expected_blob:
                    raise ImportErrorDetail(f"고정 커밋 파일 검증 실패: {path.name}")
                manifest[stem] = {
                    "file": path.name,
                    "path": str(path),
                    "url": f"https://github.com/{REPO}/blob/{REVISION}/data/csv/{path.name}",
                    "bytes": len(data),
                    "git_blob_sha1": actual_blob,
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
        result = normalize_all(manifest)
    except (ImportErrorDetail, OSError, UnicodeError, csv.Error) as exc:
        raise ImportErrorDetail(str(exc)) from exc
    print(f"원본 {result['source_row_count']:,}행 → 정규화 부품 {result['normalized_parts_count']:,}행 변환 완료")
    print(f"미리보기: {result['outputs']['parts_import_preview']}")
    print(f"원본 매핑: {result['outputs']['source_part_crosswalk']}")
    print(f"manifest: {NORMALIZED_DIR / 'import_manifest.json'}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="고정 커밋 PC 부품 CSV를 ERD parts 적재 미리보기로 변환")
    parser.add_argument("--download", action="store_true", help="고정 커밋의 8개 CSV를 GitHub raw에서 내려받음")
    args = parser.parse_args()
    try:
        run_import(download=args.download)
    except ImportErrorDetail as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
