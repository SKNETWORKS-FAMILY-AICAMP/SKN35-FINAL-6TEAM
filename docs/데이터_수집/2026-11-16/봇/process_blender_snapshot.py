#!/usr/bin/env python3
"""Blender Open Data ZIP에서 최근 버전의 렌더링 측정 행만 CSV로 평탄화한다.

원본 ZIP은 그대로 보존하고 JSONL을 스트리밍해 읽습니다. ZIP을 풀지 않으며,
원본 안의 실제 값만 뽑아 결측값은 빈 칸으로 둡니다.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any


def version_key(value: str) -> tuple[int, ...]:
    parts = re.findall(r"\d+", value)
    return tuple(int(part) for part in parts[:3]) if parts else (0,)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def flatten(record: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    device_info = result.get("device_info") or {}
    system_info = result.get("system_info") or {}
    blender = result.get("blender_version") or {}
    scene = result.get("scene") or {}
    stats = result.get("stats") or {}
    device_names = sorted({
        str(item.get("name", ""))
        for item in device_info.get("compute_devices", [])
        if item.get("name")
    })
    return {
        "record_id": record.get("id", ""),
        "timestamp": result.get("timestamp") or record.get("created_at", ""),
        "blender_version": blender.get("label", ""),
        "scene": scene.get("label", ""),
        "device_type": device_info.get("device_type", ""),
        "device_names": "; ".join(device_names),
        "system": system_info.get("system", ""),
        "os_distribution": system_info.get("dist_name", ""),
        "cpu_cores": system_info.get("num_cpu_cores", ""),
        "cpu_threads": system_info.get("num_cpu_threads", device_info.get("num_cpu_threads", "")),
        "render_time_seconds": stats.get("total_render_time", ""),
        "render_time_no_sync_seconds": stats.get("render_time_no_sync", ""),
        "device_peak_memory_mb": stats.get("device_peak_memory", ""),
        "launcher_version": (result.get("benchmark_launcher") or {}).get("label", ""),
        "benchmark_script_version": (result.get("benchmark_script") or {}).get("label", ""),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--minimum-version", default="4.0.0")
    args = parser.parse_args()
    columns = [
        "record_id", "timestamp", "blender_version", "scene", "device_type", "device_names",
        "system", "os_distribution", "cpu_cores", "cpu_threads", "render_time_seconds",
        "render_time_no_sync_seconds", "device_peak_memory_mb", "launcher_version",
        "benchmark_script_version",
    ]
    versions: Counter[str] = Counter()
    devices: Counter[str] = Counter()
    scenes: Counter[str] = Counter()
    kept = 0
    malformed_lines = 0
    skipped_entries = 0
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(args.archive) as archive:
        members = [name for name in archive.namelist() if name.endswith(".jsonl")]
        if len(members) != 1:
            raise SystemExit(f"JSONL 원본을 하나로 특정할 수 없습니다: {members}")
        member = members[0]
        with archive.open(member) as source, args.output.open("w", newline="", encoding="utf-8-sig") as target:
            writer = csv.DictWriter(target, fieldnames=columns)
            writer.writeheader()
            for line_number, line in enumerate(source, 1):
                try:
                    record = json.loads(line)
                except (UnicodeDecodeError, json.JSONDecodeError):
                    malformed_lines += 1
                    continue
                results = record.get("data", []) if isinstance(record, dict) else []
                if not isinstance(results, list):
                    skipped_entries += 1
                    continue
                for result in results:
                    if not isinstance(result, dict):
                        skipped_entries += 1
                        continue
                    version = str((result.get("blender_version") or {}).get("label", ""))
                    if version_key(version) < version_key(args.minimum_version):
                        continue
                    row = flatten(record, result)
                    writer.writerow(row)
                    kept += 1
                    versions[row["blender_version"]] += 1
                    devices[row["device_type"] or "(미상)"] += 1
                    scenes[row["scene"] or "(미상)"] += 1

    summary = {
        "archive": str(args.archive),
        "archive_sha256": sha256_file(args.archive),
        "source_member": member,
        "minimum_blender_version": args.minimum_version,
        "derived_csv": str(args.output),
        "derived_rows": kept,
        "malformed_json_lines": malformed_lines,
        "skipped_non_object_entries": skipped_entries,
        "blender_versions": dict(versions.most_common()),
        "device_types": dict(devices.most_common()),
        "scenes": dict(scenes.most_common()),
        "license": "CC0 1.0 Universal (source archive LICENSE.txt)",
        "source": "https://opendata.blender.org/download/",
        "note": "ZIP을 압축 해제하지 않고 JSONL을 스트리밍 처리했습니다. 각 행은 기기·씬·버전이 서로 다를 수 있어 비교 전에 그룹을 맞춰야 합니다.",
    }
    summary_path = args.output.with_suffix(".summary.json")
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"측정 행 {kept:,}건 저장: {args.output}")
    print(f"요약·원본 해시 저장: {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
