#!/usr/bin/env python3
"""기존 성능 원자료를 ERD 미리보기로 바꾸고 benchmark 전용 참조 모델을 연결한다."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

OUTPUT = Path(__file__).resolve().parents[2] / "data" / "collection" / "runs" / "2026-11-17" / "output"
DEFAULT_PARTS = OUTPUT / "normalized" / "pc-part-dataset_c52a04ca" / "parts_import_preview.csv"
OPEN_GPU_DIR = OUTPUT / "raw" / "opengpubenchmarks_48310db"
BLENDER_DIR = OUTPUT / "raw" / "blender_open_data_cc0_20261116"
LLMSPEED_DIR = OUTPUT / "raw" / "llmspeed_llm_inference_benchmarks_20261116_460d03927e5e8b68"

RUN_COLUMNS = [
    "run_id", "domain", "benchmark_name", "benchmark_version", "software_version",
    "workload", "score_metrics", "system_snapshot", "source_record_id", "source_url",
    "license_id", "measured_at",
]
LINK_COLUMNS = ["run_id", "part_id", "component_role", "match_status", "match_evidence"]
UNMATCHED_COLUMNS = ["source_id", "source_record_id", "component_role", "hardware_name", "reason"]
UNMATCHED_SUMMARY_COLUMNS = ["source_id", "component_role", "hardware_name", "occurrences", "reason"]
PART_COLUMNS = ["part_id", "category", "brand", "name", "model_number", "specs", "source_url", "verified_at", "current_price", "currency"]


def load_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return default


def stable_bigint(text: str) -> int:
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:15], 16)


def norm_name(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.casefold())


def cpu_model_key(text: str) -> str:
    patterns = (
        r"(?i)ryzen\s+threadripper\s+(?:pro\s+)?\d{4,5}[a-z0-9]{0,4}(?![a-z0-9])",
        r"(?i)ryzen\s+[3579]\s+\d{4,5}[a-z0-9]{0,4}(?![a-z0-9])",
        r"(?i)core\s+ultra\s+[3579]\s+\d{3}[a-z0-9]{0,4}(?![a-z0-9])",
        r"(?i)core\s+i[3579]\s*-?\s*\d{3,5}[a-z0-9]{0,4}(?![a-z0-9])",
        r"(?i)\bi[3579]\s*-\s*\d{3,5}[a-z0-9]{0,4}(?![a-z0-9])",
        r"(?i)xeon\s+(?:cpu\s+)?[a-z]{1,2}\s*-?\s*\d{3,5}(?:\s*v\d+)?(?![a-z0-9])",
        r"(?i)intel\s+n\d{2,3}\b",
        r"(?i)fx-\d{3,4}\b",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            key = norm_name(match.group())
            # Vendors/platform prefixes are omitted where the part number is unique;
            # product family and suffix stay in the key (e.g. 7950X vs 7950X3D).
            if key.startswith("amdryzen"):
                key = key[len("amd"):]
            elif key.startswith("intel") and re.match(r"(?i)intel\s+n", match.group()):
                key = key[len("intel"):]
            return key
    return ""


def gpu_model_identity(text: str) -> tuple[str, str, str, str] | None:
    """Return (identity key, brand, canonical display name, model number) only for identifiable GPU models."""
    value = " ".join(text.replace("(TM)", "").replace("(R)", "").split())
    low = value.casefold()

    apple = re.search(r"(?i)\b(?:apple\s+)?m([1-9])\s*(pro|max|ultra)?\b", value)
    if apple and ("gpu" in low or "apple" in low or re.match(r"(?i)^m[1-9]\b", value)):
        cores = re.search(r"(?i)(\d+)\s*[- ]?core(?:s)?\s*(?:gpu)?|gpu\s*[-–:]\s*(\d+)\s*cores?", value)
        core_count = next((part for part in (cores.groups() if cores else ()) if part), "")
        family = f"M{apple.group(1)}{(' ' + apple.group(2).title()) if apple.group(2) else ''}"
        model_number = f"{family} GPU{(' ' + core_count + '-core') if core_count else ''}"
        canonical = f"Apple {model_number}"
        return norm_name(canonical), "Apple", canonical, model_number

    nvidia = re.search(r"(?i)\b(rtx|gtx)\s*(a\d{3,4}|\d{3,4})\s*(ti|super)?\b", value)
    if nvidia:
        family, number, suffix = nvidia.groups()
        ada = bool(re.search(r"(?i)\bada(?:\s+generation)?\b", value))
        laptop = bool(re.search(r"(?i)\blaptop\s+gpu\b", value))
        model_number = f"{family.upper()} {number.upper()}{(' ' + suffix.upper()) if suffix else ''}{' Ada' if ada else ''}{' Laptop GPU' if laptop else ''}"
        canonical = f"NVIDIA GeForce {model_number}"
        return norm_name(canonical), "NVIDIA", canonical, model_number
    quadro = re.search(r"(?i)\bquadro\s+(?:rtx\s*)?([kpt]\d{3,4})\b", value)
    if quadro:
        model_number = f"Quadro {quadro.group(1).upper()}"
        canonical = f"NVIDIA {model_number}"
        return norm_name(canonical), "NVIDIA", canonical, model_number
    titan = re.search(r"(?i)\btitan\s+(rtx|v|x)\b", value)
    if titan:
        model_number = f"TITAN {titan.group(1).upper()}"
        canonical = f"NVIDIA {model_number}"
        return norm_name(canonical), "NVIDIA", canonical, model_number

    amd = re.search(r"(?i)\bradeon\s*(?:\(tm\)\s*)?rx\s*(\d{3,4})\s*(xtx|xt|gre|m)?\b", value)
    if amd:
        number, suffix = amd.groups()
        model_number = f"Radeon RX {number}{(' ' + suffix.upper()) if suffix else ''}"
        canonical = f"AMD {model_number}"
        return norm_name(canonical), "AMD", canonical, model_number
    amd_pro = re.search(r"(?i)\bradeon\s+pro\s+(wx\s*\d{3,4})\b", value)
    if amd_pro:
        model_number = f"Radeon Pro {amd_pro.group(1).replace(' ', '').upper()}"
        canonical = f"AMD {model_number}"
        return norm_name(canonical), "AMD", canonical, model_number

    intel_arc = re.search(r"(?i)\barc\s+([ab]\d{3,4})\b", value)
    if intel_arc:
        model_number = f"Arc {intel_arc.group(1).upper()}"
        canonical = f"Intel {model_number}"
        return norm_name(canonical), "Intel", canonical, model_number
    intel_integrated = re.search(r"(?i)\b(uhd|iris\s+xe|hd)\s+graphics\s*(\d{3,4})\b", value)
    if intel_integrated:
        model_number = f"Intel {intel_integrated.group(1).title()} Graphics {intel_integrated.group(2)}"
        canonical = model_number
        return norm_name(canonical), "Intel", canonical, model_number
    return None


def collect_gpu_reference_inputs(args: argparse.Namespace) -> dict[str, dict[str, Any]]:
    references: dict[str, dict[str, Any]] = {}

    def add(name: str, source_id: str, source_url: str) -> None:
        identity = gpu_model_identity(name)
        if identity is None:
            return
        key, brand, canonical, model_number = identity
        record = references.setdefault(key, {
            "brand": brand,
            "name": canonical,
            "model_number": model_number,
            "observed_device_names": set(),
            "source_ids": set(),
            "source_urls": set(),
        })
        record["observed_device_names"].add(name.strip())
        record["source_ids"].add(source_id)
        if source_url:
            record["source_urls"].add(source_url)

    if "blender" in args.sources:
        source_id = "blender_open_data_v4plus_20261116"
        summary = load_json(BLENDER_DIR / "blender_open_data_v4plus.summary.json", {})
        source_url = summary.get("source", "https://opendata.blender.org/")
        with (BLENDER_DIR / "blender_open_data_v4plus.csv").open("r", encoding="utf-8-sig", newline="") as stream:
            for row_number, row in enumerate(csv.DictReader(stream), 1):
                if not args.all and row_number > args.limit:
                    break
                if (row.get("device_type") or "").upper() != "CPU":
                    add(row.get("device_names") or "", source_id, source_url)

    if "llmspeed" in args.sources:
        source_id = "llmspeed_llm_inference_benchmarks_20261116"
        metadata = load_json(LLMSPEED_DIR / "runs.csv.metadata.json", {})
        source_url = metadata.get("license", {}).get("source_url", "")
        with (LLMSPEED_DIR / "runs.csv").open("r", encoding="utf-8-sig", newline="") as stream:
            for row_number, row in enumerate(csv.DictReader(stream), 1):
                if not args.all and row_number > args.limit:
                    break
                for role, name in classify_llm_components(row.get("accelerator_summary", "")):
                    if role == "gpu":
                        add(name, source_id, source_url)
    return references


def create_reference_parts(base_parts_file: Path, output_path: Path,
                           references: dict[str, dict[str, Any]]) -> tuple[int, int]:
    existing: list[dict[str, str]] = []
    existing_names: dict[str, set[str]] = defaultdict(set)
    existing_ids: set[str] = set()
    existing_reference_keys: set[str] = set()
    with base_parts_file.open("r", encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            existing.append(row)
            existing_ids.add(row["part_id"])
            existing_names[norm_name(row.get("name", ""))].add(row["part_id"])
            try:
                existing_specs = json.loads(row.get("specs") or "{}")
            except json.JSONDecodeError:
                existing_specs = {}
            if existing_specs.get("record_kind") == "benchmark_reference_model":
                existing_reference_keys.add(existing_specs.get("model_identity_key", ""))

    reference_rows: list[dict[str, str]] = []
    for key, record in sorted(references.items()):
        if key in existing_reference_keys:
            continue
        part_id = stable_bigint(f"benchmark-reference:gpu:{key}")
        if str(part_id) in existing_ids:
            raise ValueError(f"참조 GPU part_id 충돌: {record['name']}")
        specs = {
            "record_kind": "benchmark_reference_model",
            "reference_only": True,
            "quote_eligible": False,
            "purchase_eligible": False,
            "not_retail_sku": True,
            "model_identity_key": key,
            "identity_basis": "공개 벤치마크가 보고한 GPU 장치명에서 식별한 모델. 제조사 사양 미검증.",
            "observed_device_names": sorted(record["observed_device_names"]),
            "source_ids": sorted(record["source_ids"]),
            "source_urls": sorted(record["source_urls"]),
        }
        reference_rows.append({
            "part_id": str(part_id), "category": "gpu", "brand": record["brand"],
            "name": record["name"], "model_number": record["model_number"],
            "specs": json.dumps(specs, ensure_ascii=False, separators=(",", ":")),
            "source_url": sorted(record["source_urls"])[0] if record["source_urls"] else "",
            "verified_at": "", "current_price": "", "currency": "",
        })
        existing_ids.add(str(part_id))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=PART_COLUMNS)
        writer.writeheader()
        writer.writerows(existing)
        writer.writerows(reference_rows)
    return len(reference_rows), len(existing) + len(reference_rows)


def read_parts_lookup(path: Path) -> tuple[dict[str, tuple[int | None, str]], dict[str, list[tuple[int, str]]], dict[str, list[tuple[int, str]]]]:
    collected: dict[str, list[tuple[int, str]]] = defaultdict(list)
    cpu_models: dict[str, list[tuple[int, str]]] = defaultdict(list)
    gpu_reference_models: dict[str, list[tuple[int, str]]] = defaultdict(list)
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            name = (row.get("name") or "").strip()
            key = norm_name(name)
            try:
                specs = json.loads(row.get("specs") or "{}")
            except json.JSONDecodeError:
                specs = {}
            is_reference_model = specs.get("record_kind") == "benchmark_reference_model"
            if key and not is_reference_model:
                collected[key].append((int(row["part_id"]), name))
            if row.get("category") == "cpu":
                model_key = cpu_model_key(name)
                if model_key:
                    cpu_models[model_key].append((int(row["part_id"]), name))
            if row.get("category") == "gpu":
                if is_reference_model:
                    model_key = specs.get("model_identity_key")
                    if model_key:
                        gpu_reference_models[model_key].append((int(row["part_id"]), name))
    result: dict[str, tuple[int | None, str]] = {}
    for key, entries in collected.items():
        unique_ids = {entry[0] for entry in entries}
        result[key] = (entries[0][0], entries[0][1]) if len(unique_ids) == 1 else (None, entries[0][1])
    return result, cpu_models, gpu_reference_models


def scalar(value: str) -> Any:
    value = value.strip()
    if not value:
        return None
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    if value.lower() in {"true", "false"}:
        return value.lower() == "true"
    try:
        number = float(value)
        return int(number) if number.is_integer() else number
    except ValueError:
        return value


def read_open_gpu(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Read the scalar fields required from the known public YAML export without a YAML dependency."""
    headers: dict[str, Any] = {}
    runs: list[dict[str, Any]] = []
    active: dict[str, Any] | None = None
    allowed = {
        "resolution", "time", "graphics_preset", "avg_fps", "p1_low", "p5_low",
        "duration", "frame_count", "worst_frame_ms", "render_width", "render_height",
        "warmup_s", "timing_method",
    }
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if line.startswith("  - resolution:"):
            if active is not None:
                runs.append(active)
            active = {"resolution": scalar(line.split(":", 1)[1])}
            continue
        if active is not None and line.startswith("    ") and not line.startswith("      "):
            key, sep, value = line.strip().partition(":")
            if sep and key in allowed:
                active[key] = scalar(value)
        elif active is None and ":" in line and not line.lstrip().startswith("#") and not line.startswith(" "):
            key, _, value = line.partition(":")
            headers[key.strip()] = scalar(value)
    if active is not None:
        runs.append(active)
    if not runs:
        raise ValueError(f"Open GPU YAML의 result 행을 읽지 못했습니다: {path}")
    return headers, runs


def classify_llm_components(summary: str) -> list[tuple[str, str]]:
    components = []
    for chunk in summary.split("+"):
        name = chunk.strip()
        low = name.casefold()
        if any(token in low for token in ("rtx", "geforce", "radeon", "arc ", "gpu")):
            role = "gpu"
        elif any(token in low for token in ("ryzen", "epyc", "xeon", "core ", "threadripper", "cpu")):
            role = "cpu"
        else:
            continue
        components.append((role, name))
    return components


def match_components(run_id: int, source_id: str, source_record_id: str,
                     components: Iterable[tuple[str, str]], lookup: dict[str, tuple[int | None, str]],
                     cpu_models: dict[str, list[tuple[int, str]]],
                     gpu_reference_models: dict[str, list[tuple[int, str]]],
                     links: csv.DictWriter, unmatched: dict[tuple[str, str, str, str], str]) -> int:
    matched = 0
    for role, raw_name in components:
        found = lookup.get(norm_name(raw_name))
        match_type = "exact_normalized_name"
        evidence = ""
        if role == "cpu":
            model_key = cpu_model_key(raw_name)
            model_matches = cpu_models.get(model_key, []) if model_key else []
            unique_parts = {part_id: name for part_id, name in model_matches}
            if len(unique_parts) == 1:
                part_id, part_name = next(iter(unique_parts.items()))
                found = (part_id, part_name)
                match_type = "exact_cpu_model_number"
                evidence = f"실행환경 접미사를 제외한 CPU 모델번호 일치: {model_key} → {part_name}"
            elif len(unique_parts) > 1:
                found = (None, next(iter(unique_parts.values())))
                evidence = f"동일 모델번호가 카탈로그에서 여러 part_id로 확인됨: {model_key}"
            else:
                found = None
                evidence = f"모델번호 {model_key or '미식별'}가 CPU 카탈로그에 없음"
        elif role == "gpu":
            identity = gpu_model_identity(raw_name)
            reference_matches = gpu_reference_models.get(identity[0], []) if identity else []
            unique_references = {part_id: name for part_id, name in reference_matches}
            exact_product = bool(re.search(r"(?i)\b(msi|asus|gigabyte|zotac|asrock|pny|powercolor|sapphire|xfx|founders edition)\b", raw_name))
            if exact_product and found is not None and found[0] is not None:
                pass
            elif len(unique_references) == 1:
                part_id, part_name = next(iter(unique_references.items()))
                found = (part_id, part_name)
                match_type = "benchmark_gpu_model_reference"
                evidence = f"벤치마크 장치명과 참조용 GPU 모델 식별자 일치: {identity[2]} (판매 SKU가 아닌 참조 모델)"
            elif len(unique_references) > 1:
                found = (None, next(iter(unique_references.values())))
                evidence = f"GPU 참조 모델 식별자에 여러 parts 행이 있음: {identity[2]}"
            elif found is None or found[0] is None:
                evidence = "GPU 이름에서 안정적인 모델 식별자를 추출하지 못해 참조 모델을 만들지 않음"
        if found is not None and found[0] is not None:
            links.writerow({
                "run_id": run_id,
                "part_id": found[0],
                "component_role": role,
                "match_status": match_type,
                "match_evidence": evidence or f"원본 하드웨어 이름과 parts.name의 정규화 문자열 일치: {found[1]}",
            })
            matched += 1
        else:
            reason = evidence or ("카탈로그에 정확 일치 없음" if found is None else "동일 이름 part_id가 여러 개라 모호함")
            unmatched[(source_id, source_record_id, role, raw_name)] = reason
    return matched


def run(args: argparse.Namespace) -> dict[str, Any]:
    if not args.parts_file.is_file():
        raise FileNotFoundError(f"parts 미리보기가 없습니다: {args.parts_file}. 먼저 import-parts를 실행하세요.")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    reference_inputs = collect_gpu_reference_inputs(args)
    augmented_parts_path = args.output_dir / "parts_with_benchmark_references_preview.csv"
    reference_parts_added, augmented_parts_count = create_reference_parts(args.parts_file, augmented_parts_path, reference_inputs)
    lookup, cpu_models, gpu_reference_models = read_parts_lookup(augmented_parts_path)
    runs_path = args.output_dir / "benchmark_runs_preview.csv"
    links_path = args.output_dir / "benchmark_run_parts_preview.csv"
    unmatched_path = args.output_dir / "unmatched_hardware.csv"
    load_ready_path = args.output_dir / "benchmark_runs_load_ready.csv"
    unmatched: dict[tuple[str, str, str, str], str] = {}
    stats: dict[str, dict[str, int]] = {}

    with runs_path.open("w", encoding="utf-8-sig", newline="") as run_stream, \
            links_path.open("w", encoding="utf-8-sig", newline="") as link_stream:
        run_writer = csv.DictWriter(run_stream, fieldnames=RUN_COLUMNS)
        link_writer = csv.DictWriter(link_stream, fieldnames=LINK_COLUMNS)
        run_writer.writeheader()
        link_writer.writeheader()

        if "opengpu" in args.sources:
            source_id = "opengpubenchmarks_steam_machine_neon_flythrough_20261109"
            source_path = OPEN_GPU_DIR / "result_20261109_openbenchmarker_neon_flythrough.yaml"
            metadata = load_json(source_path.with_suffix(source_path.suffix + ".metadata.json"), {})
            headers, records = read_open_gpu(source_path)
            limit_records = records if args.all else records[:args.limit]
            count = matched_count = 0
            for i, item in enumerate(limit_records, 1):
                rid = stable_bigint(f"{source_id}:{i}")
                metrics = {key: item[key] for key in ("avg_fps", "p1_low", "p5_low", "worst_frame_ms", "duration") if key in item}
                metrics["fps_unit"] = "frames_per_second"
                snapshot = {key: headers.get(key) for key in ("gpu_id", "testbench_id", "frame_generation", "overclocked")}
                snapshot["system_scope"] = "단일 Steam Machine 측정; 개별 GPU SKU 성능으로 분해하지 않음"
                source_url = metadata.get("source", {}).get("immutable_file_url", "")
                run_writer.writerow({
                    "run_id": rid, "domain": "game", "benchmark_name": "OpenBenchmarker Neon Flythrough",
                    "benchmark_version": headers.get("version", ""), "software_version": "",
                    "workload": f"{headers.get('game_id','')} / {item.get('resolution','')} / {item.get('graphics_preset','')}",
                    "score_metrics": json.dumps(metrics, ensure_ascii=False, separators=(",", ":")),
                    "system_snapshot": json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
                    "source_record_id": f"result[{i}]", "source_url": source_url,
                    "license_id": metadata.get("source", {}).get("license", "CC BY 4.0"), "measured_at": headers.get("date", ""),
                })
                matched_count += match_components(rid, source_id, f"result[{i}]", [("gpu", str(headers.get("gpu_id", "")))], lookup, cpu_models, gpu_reference_models, link_writer, unmatched)
                count += 1
            stats[source_id] = {"rows": count, "matched_components": matched_count, "source_rows": len(records)}

        if "blender" in args.sources:
            source_id = "blender_open_data_v4plus_20261116"
            source_path = BLENDER_DIR / "blender_open_data_v4plus.csv"
            summary = load_json(BLENDER_DIR / "blender_open_data_v4plus.summary.json", {})
            count = matched_count = 0
            source_url = summary.get("source", "https://opendata.blender.org/")
            with source_path.open("r", encoding="utf-8-sig", newline="") as source_stream:
                for row_number, row in enumerate(csv.DictReader(source_stream), 1):
                    if not args.all and count >= args.limit:
                        break
                    record_id = row.get("record_id") or f"row-{row_number}"
                    source_record_id = f"{record_id}:line-{row_number}"
                    rid = stable_bigint(f"{source_id}:{source_record_id}")
                    device_type = (row.get("device_type") or "").upper()
                    role = "cpu" if device_type == "CPU" else "gpu"
                    raw_device = row.get("device_names") or ""
                    metrics = {
                        "render_time_seconds": scalar(row.get("render_time_seconds") or ""),
                        "render_time_no_sync_seconds": scalar(row.get("render_time_no_sync_seconds") or ""),
                        "device_peak_memory_mb": scalar(row.get("device_peak_memory_mb") or ""),
                    }
                    snapshot = {key: row.get(key) for key in ("device_type", "device_names", "system", "os_distribution", "cpu_cores", "cpu_threads")}
                    run_writer.writerow({
                        "run_id": rid, "domain": "3d_rendering", "benchmark_name": "Blender Open Data",
                        "benchmark_version": "", "software_version": row.get("blender_version", ""),
                        "workload": row.get("scene", ""),
                        "score_metrics": json.dumps(metrics, ensure_ascii=False, separators=(",", ":")),
                        "system_snapshot": json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
                        "source_record_id": source_record_id, "source_url": source_url,
                        "license_id": summary.get("license", "CC0 1.0 Universal"), "measured_at": row.get("timestamp", ""),
                    })
                    matched_count += match_components(rid, source_id, source_record_id, [(role, raw_device)], lookup, cpu_models, gpu_reference_models, link_writer, unmatched)
                    count += 1
            stats[source_id] = {"rows": count, "matched_components": matched_count, "source_rows": int(summary.get("derived_rows", count))}

        if "llmspeed" in args.sources:
            source_id = "llmspeed_llm_inference_benchmarks_20261116"
            source_path = LLMSPEED_DIR / "runs.csv"
            metadata = load_json(LLMSPEED_DIR / "runs.csv.metadata.json", {})
            count = matched_count = 0
            with source_path.open("r", encoding="utf-8-sig", newline="") as source_stream:
                for row_number, row in enumerate(csv.DictReader(source_stream), 1):
                    if not args.all and count >= args.limit:
                        break
                    source_record_id = row.get("id") or f"row-{row_number}"
                    rid = stable_bigint(f"{source_id}:{source_record_id}")
                    score = scalar(row.get("top_decode_tps") or "")
                    metrics = {"decode_tokens_per_second": score, "unit": "tokens/second"}
                    snapshot = {
                        "model": row.get("top_model_name", ""),
                        "backend": row.get("top_backend", ""),
                        "accelerator_summary": row.get("accelerator_summary", ""),
                    }
                    run_writer.writerow({
                        "run_id": rid, "domain": "local_ai", "benchmark_name": "llm-speed",
                        "benchmark_version": row.get("suite_version", ""), "software_version": row.get("top_backend", ""),
                        "workload": row.get("top_workload", ""),
                        "score_metrics": json.dumps(metrics, ensure_ascii=False, separators=(",", ":")),
                        "system_snapshot": json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
                        "source_record_id": source_record_id, "source_url": row.get("permalink", ""),
                        "license_id": metadata.get("license", {}).get("id", "CC-BY-4.0"), "measured_at": row.get("received_at", ""),
                    })
                    matched_count += match_components(rid, source_id, source_record_id, classify_llm_components(row.get("accelerator_summary", "")), lookup, cpu_models, gpu_reference_models, link_writer, unmatched)
                    count += 1
            stats[source_id] = {"rows": count, "matched_components": matched_count, "source_rows": 220}

    with unmatched_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=UNMATCHED_COLUMNS)
        writer.writeheader()
        for key, reason in sorted(unmatched.items()):
            writer.writerow(dict(zip(UNMATCHED_COLUMNS[:-1], key), reason=reason))

    unmatched_summary_path = args.output_dir / "unmatched_hardware_summary.csv"
    summary_counts: dict[tuple[str, str, str, str], int] = defaultdict(int)
    for (source_id, _, role, hardware_name), reason in unmatched.items():
        summary_counts[(source_id, role, hardware_name, reason)] += 1
    with unmatched_summary_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=UNMATCHED_SUMMARY_COLUMNS)
        writer.writeheader()
        for (source_id, role, hardware_name, reason), count in sorted(summary_counts.items()):
            writer.writerow({"source_id": source_id, "component_role": role, "hardware_name": hardware_name, "occurrences": count, "reason": reason})

    # 링크 파일을 FK·필수값 기준으로 정리한다. 중단/동시 실행 등으로
    # 헤더가 깨진 행이나 동일 연결 중복이 생기면 적재 후보에 들어가지 않게 한다.
    valid_part_ids: set[str] = set()
    with augmented_parts_path.open("r", encoding="utf-8-sig", newline="") as stream:
        valid_part_ids = {row["part_id"] for row in csv.DictReader(stream) if row.get("part_id", "").isdigit()}
    validated_links_path = links_path.with_suffix(".validated.tmp")
    matched_run_ids: set[str] = set()
    seen_links: set[tuple[str, str, str]] = set()
    invalid_link_rows = 0
    duplicate_link_rows = 0
    with links_path.open("r", encoding="utf-8-sig", newline="") as source_stream, \
            validated_links_path.open("w", encoding="utf-8-sig", newline="") as clean_stream:
        reader = csv.DictReader(source_stream)
        writer = csv.DictWriter(clean_stream, fieldnames=LINK_COLUMNS)
        writer.writeheader()
        for row in reader:
            run_id = row.get("run_id", "")
            part_id = row.get("part_id", "")
            role = row.get("component_role", "")
            if (not run_id.isdigit() or not part_id.isdigit() or part_id not in valid_part_ids
                    or role not in {"cpu", "gpu"} or not row.get("match_status") or not row.get("match_evidence")):
                invalid_link_rows += 1
                continue
            link_key = (run_id, part_id, role)
            if link_key in seen_links:
                duplicate_link_rows += 1
                continue
            seen_links.add(link_key)
            matched_run_ids.add(run_id)
            writer.writerow({column: row[column] for column in LINK_COLUMNS})
    validated_links_path.replace(links_path)

    # 실제 적재 후보는 검증된 부품 FK가 하나 이상 있는 run으로 제한한다.
    load_ready_count = 0
    loaded_run_ids: set[str] = set()
    with runs_path.open("r", encoding="utf-8-sig", newline="") as source_stream, \
            load_ready_path.open("w", encoding="utf-8-sig", newline="") as ready_stream:
        reader = csv.DictReader(source_stream)
        writer = csv.DictWriter(ready_stream, fieldnames=RUN_COLUMNS)
        writer.writeheader()
        for row in reader:
            if row["run_id"] in matched_run_ids:
                writer.writerow(row)
                load_ready_count += 1
                loaded_run_ids.add(row["run_id"])
    missing_run_ids = matched_run_ids - loaded_run_ids
    if missing_run_ids:
        raise ValueError(f"benchmark_run_parts에 존재하지만 전체 run 파일에서 찾지 못한 run_id가 {len(missing_run_ids)}개 있습니다.")

    manifest = {
        "source_parts_file": str(args.parts_file),
        "parts_file_with_references": str(augmented_parts_path),
        "reference_gpu_parts_added": reference_parts_added,
        "parts_with_references_rows": augmented_parts_count,
        "default_limit_per_source": args.limit,
        "all_rows": args.all,
        "matching_policy": "CPU links use exact standardized model numbers. Generic GPU benchmark names link to benchmark_reference_model rows marked reference_only and quote_eligible=false; only clearly named partner/Founders Edition GPU products may link to exact retail SKUs.",
        "sources": stats,
        "output_rows": {
            "benchmark_runs_all": sum(v["rows"] for v in stats.values()),
            "benchmark_runs_load_ready": load_ready_count,
            "benchmark_runs_waiting_for_part_match": sum(v["rows"] for v in stats.values()) - load_ready_count,
            "benchmark_run_parts": len(matched_run_ids),
            "benchmark_run_parts_duplicate_rows_removed": duplicate_link_rows,
            "invalid_benchmark_run_parts_rows_discarded": invalid_link_rows,
            "unmatched_hardware": len(unmatched),
            "distinct_unmatched_hardware": len(summary_counts),
        },
        "outputs": {
            "parts_with_benchmark_references": str(augmented_parts_path),
            "benchmark_runs_all": str(runs_path),
            "benchmark_runs_load_ready": str(load_ready_path),
            "benchmark_run_parts": str(links_path),
            "unmatched_hardware": str(unmatched_path),
            "unmatched_hardware_summary": str(unmatched_summary_path),
        },
    }
    manifest_path = args.output_dir / "benchmark_import_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="기존 성능 원자료를 ERD 벤치마크 테이블 미리보기로 변환")
    parser.add_argument("--parts-file", type=Path, default=DEFAULT_PARTS)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT / "normalized" / "benchmarks")
    parser.add_argument("--sources", nargs="+", choices=["opengpu", "blender", "llmspeed"], default=["opengpu", "blender", "llmspeed"])
    parser.add_argument("--limit", type=int, default=1000, help="출처별 최대 행 수; 0은 --all처럼 전체 처리")
    parser.add_argument("--all", action="store_true", help="선택한 원자료의 전체 행 처리 (Blender는 대용량)")
    args = parser.parse_args()
    if args.limit < 0:
        parser.error("--limit은 0 이상이어야 함")
    if args.limit == 0:
        args.all = True
    try:
        manifest = run(args)
    except (OSError, ValueError, csv.Error) as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 2
    print(f"전체 성능 측정 {manifest['output_rows']['benchmark_runs_all']:,}건 변환")
    print(f"참조 전용 GPU 모델 {manifest['reference_gpu_parts_added']:,}개 추가: {manifest['outputs']['parts_with_benchmark_references']}")
    print(f"부품 연결 확인 후 적재 후보 {manifest['output_rows']['benchmark_runs_load_ready']:,}건: {manifest['outputs']['benchmark_runs_load_ready']}")
    print(f"미매칭 하드웨어 {manifest['output_rows']['unmatched_hardware']:,}건: {manifest['outputs']['unmatched_hardware']}")
    print(f"결과: {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
