"""Resolve manually reviewed document links against a read-only catalog snapshot."""

import hashlib
import json
from collections import defaultdict
from collections.abc import Iterable
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from app.domains.hardware.ingestion.docyx import BRANDS, REVISION
from app.domains.hardware.ingestion.paths import DATA, REPO_ROOT

if TYPE_CHECKING:
    from app.rag.loader import Corpus

MAPPINGS_PATH = REPO_ROOT / "data/rag/mappings/reviewed_links.json"


@dataclass(frozen=True)
class ReviewedLink:
    item_key: str
    source_key: str
    parts: tuple[dict, ...]
    compatibilities: tuple[dict, ...]


@dataclass
class MappingReport:
    confirmed: dict[str, dict]
    unresolved: list[dict]


def _by_key(rows: list, key: str) -> dict:
    if not isinstance(rows, list):
        raise ValueError(f"{key}: 레코드 목록이 필요합니다.")
    indexed = {}
    for row in rows:
        value = row.get(key) if isinstance(row, dict) else None
        if not isinstance(value, str) or not value.strip() or value in indexed:
            raise ValueError(f"잘못되거나 중복된 {key}: {value!r}")
        indexed[value] = row
    return indexed


def _review_targets(keys: list, index: dict, item_key: str) -> tuple[dict, ...]:
    if (
        not isinstance(keys, list)
        or not all(isinstance(key, str) for key in keys)
        or len(set(keys)) != len(keys)
    ):
        raise ValueError(f"{item_key}: 연결 키 목록이 잘못되거나 중복됐습니다.")
    for key in keys:
        if key not in index:
            raise ValueError(f"{item_key}: 검토 원본에서 연결 키를 찾지 못했습니다: {key}")
    return tuple(index[key] for key in keys)


def _validate_parts(parts: dict, hardware: dict) -> None:
    boards_and_parts = _by_key(hardware["parts"], "source_key")
    power = json.loads((DATA / "reviewed_power_specs.json").read_text(encoding="utf-8"))
    if power["catalog_revision"] != REVISION:
        raise ValueError("전력 검토 자료와 카탈로그의 리비전이 다릅니다.")
    power_parts = _by_key(power["records"], "source_key")
    for key, part in parts.items():
        if part["review_file"] == "docyx_compatibility.json" and key in boards_and_parts:
            review = boards_and_parts[key]
            name = review["raw_name"]
            brand = next(
                (b for b in BRANDS if name.casefold().startswith(b.casefold() + " ")), None
            )
            model = review["model_number"]
            specs = {**review.get("match_specs", {}), **review["specs"]}
        elif part["review_file"] == "reviewed_power_specs.json" and key in power_parts:
            review = power_parts[key]
            name, brand = review["raw_name"], review["catalog_brand"]
            model, specs = review["catalog_model_number"], review["match_specs"]
            if part["match_specs"] != specs:
                raise ValueError(f"{key}: 제조사 검토에 사용한 규격이 다릅니다.")
        else:
            raise ValueError(f"{key}: 지정된 부품 검토 파일에서 키를 찾지 못했습니다.")
        identity = (part["category"], part["brand"], part["name"], part["model_number"])
        if identity != (review["category"], brand, name, model) or not brand:
            raise ValueError(f"{key}: 검토 파일과 부품의 식별 정보가 다릅니다.")
        match_specs = part["match_specs"]
        if not isinstance(match_specs, dict) or (not model and not match_specs):
            raise ValueError(f"{key}: 정확한 품번 또는 검토 규격이 필요합니다.")
        if not all(k in specs and specs[k] == v for k, v in match_specs.items()):
            raise ValueError(f"{key}: 부품 규격이 검토 원본과 다릅니다.")


def load_reviewed_links(corpus: Corpus, path: Path | None = None) -> list[ReviewedLink]:
    """Check each curated chunk/fact and target against its original evidence, offline."""
    path = path or MAPPINGS_PATH
    try:
        manifest = json.loads(path.read_text(encoding="utf-8-sig"))
        return _read_manifest(corpus, manifest)
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        raise ValueError(f"{path}: 검토 연결 파일을 확인하세요: {error}") from error


def _original_source_urls(corpus: Corpus, key: str, source_key: str) -> set[str]:
    if key in corpus.chunks:
        crawls = (
            corpus.crawls[link["crawl_id"]]
            for link in corpus.crawl_chunk_links
            if link["chunk_key"] == key
        )
    else:
        # Facts identify their source document, without a direct fact-to-crawl relation.
        crawls = corpus.crawls.values()
    return {
        crawl["공식 URL"]
        for crawl in crawls
        if crawl["source_key"] == source_key and crawl.get("공식 URL")
    }


def _read_manifest(corpus: Corpus, manifest: dict) -> list[ReviewedLink]:
    parts = _by_key(manifest["parts"], "part_source_key")
    hardware = json.loads((DATA / "docyx_compatibility.json").read_text(encoding="utf-8"))
    _validate_parts(parts, hardware)
    records = _by_key(hardware["records"], "record_key")
    if not isinstance(manifest["links"], list):
        raise ValueError("links: 연결 행 목록이 필요합니다.")
    links = {}
    for entry in manifest["links"]:
        if ("chunk_key" in entry) == ("fact_key" in entry):
            raise ValueError("각 연결은 chunk_key 또는 fact_key 하나를 지정해야 합니다.")
        if "chunk_key" in entry:
            key, rows, text_field = entry["chunk_key"], corpus.chunks, "chunk_text"
        else:
            key, rows, text_field = entry["fact_key"], corpus.facts, "공식 문서 확인 내용"
        row = rows.get(key)
        if key in links or row is None or row["source_key"] != entry["source_key"]:
            raise ValueError(f"{key}: 문서 키가 중복됐거나 해당 항목의 출처가 다릅니다.")
        digest = hashlib.sha256(row[text_field].encode("utf-8")).hexdigest()
        if digest != entry["reviewed_text_sha256"] or not entry["review_note"].strip():
            raise ValueError(f"{key}: 본문 변경 또는 연결 근거 누락으로 재검토가 필요합니다.")
        targets = _review_targets(entry["part_source_keys"], parts, key)
        evidence = _review_targets(entry["compatibility_record_keys"], records, key)
        if not targets:
            raise ValueError(f"{key}: 연결할 검토 부품이 없습니다.")
        if "require_model_match" in entry:
            if (
                entry["require_model_match"] is not True
                or "chunk_key" not in entry
                or len(targets) != 1
            ):
                raise ValueError(f"{key}: require_model_match는 단일 부품 청크에만 지정합니다.")
            model = row["metadata"].get("model")
            if not model or model != targets[0]["model_number"]:
                raise ValueError(f"{key}: 청크 모델과 검토한 정확한 품번이 다릅니다.")
        for record in evidence:
            endpoints = {record["part_a_key"], record["part_b_key"]}
            if not endpoints.issubset(entry["part_source_keys"]):
                raise ValueError(f"{key}: 호환성 근거 양쪽 부품을 명시해야 합니다.")
            if record["source_url"] not in _original_source_urls(corpus, key, row["source_key"]):
                raise ValueError(f"{key}: 원본 호환성 근거의 공식 URL이 다릅니다.")
        links[key] = ReviewedLink(key, row["source_key"], targets, evidence)
    return list(links.values())


def _matches_part(row: dict, part: dict) -> bool:
    specs = row["specs"]
    provenance = specs.get("_provenance", {})
    names = {part["name"]}
    source_key = part["part_source_key"]
    if source_key.startswith("docyx:"):
        # prepare_parts suffixes a duplicated raw name with the snapshot identity's first 12 digits.
        names.add(f"{part['name'][:239]} [{source_key[6:18]}]")
    return (
        row["name"] in names
        and row["category"] == part["category"]
        and row["brand"] == part["brand"]
        and row["model_number"] == part["model_number"]
        and provenance.get("raw_name") == part["name"]
        and provenance.get("source") == "docyx"
        and provenance.get("revision") == REVISION
        and all(k in specs and specs[k] == v for k, v in part["match_specs"].items())
    )


def _matches_compatibility(row: dict, record: dict, part_ids: dict) -> bool:
    fields = (
        "check_type",
        "support_status",
        "bios_scope",
        "min_bios_version",
        "source_url",
        "source_publisher",
    )
    import_metadata = {
        "_record_key",
        "evidence_checked_on",
        "evidence_kind",
        "source_date_precision",
    }
    conditions = {
        key: value for key, value in row["conditions"].items() if key not in import_metadata
    }
    return (
        row["part_a_id"] == part_ids[record["part_a_key"]]
        and row["part_b_id"] == part_ids[record["part_b_key"]]
        and all(row[field] == record[field] for field in fields)
        and conditions == record["conditions"]
    )


def _candidate_issue(rows: list) -> str | None:
    if not rows:
        return "missing"
    return "ambiguous" if len(rows) > 1 else None


def resolve_links(
    reviewed: Iterable[ReviewedLink], parts: Iterable[dict], compatibility: Iterable[dict] = ()
) -> MappingReport:
    """Match only explicit links. Facts and sibling chunks never inherit another item's IDs."""
    by_source = defaultdict(list)
    for row in parts:
        key = row["specs"].get("_provenance", {}).get("source_key")
        by_source[key].append(row)
    by_record = defaultdict(list)
    for row in compatibility:
        by_record[row["conditions"].get("_record_key")].append(row)

    report = MappingReport({}, [])
    for link in reviewed:
        part_ids = {}
        matched_parts, matched_evidence = [], []
        for part in link.parts:
            key = part["part_source_key"]
            matches = by_source[key]
            issue = _candidate_issue(matches)
            if issue is None and not _matches_part(matches[0], part):
                issue = "identity_mismatch"
            if issue:
                report.unresolved.append(
                    {"item_key": link.item_key, "part_source_key": key, "reason": issue}
                )
            else:
                part_ids[key] = matches[0]["part_id"]
                matched_parts.append({"part_id": part_ids[key], "part_source_key": key})
        for record in link.compatibilities:
            key = record["record_key"]
            matches = by_record[key]
            issue = _candidate_issue(matches)
            if not {record["part_a_key"], record["part_b_key"]}.issubset(part_ids):
                issue = "unresolved_endpoint"
            elif issue is None and not _matches_compatibility(matches[0], record, part_ids):
                issue = "evidence_mismatch"
            if issue:
                report.unresolved.append(
                    {"item_key": link.item_key, "record_key": key, "reason": issue}
                )
            else:
                matched_evidence.append(
                    {"compatibility_id": matches[0]["compatibility_id"], "record_key": key}
                )
        if matched_parts or matched_evidence:
            report.confirmed[link.item_key] = {
                "parts": matched_parts,
                "compatibilities": matched_evidence,
            }
    return report


def verify_mysql_links(reviewed: list[ReviewedLink]) -> MappingReport:
    """Explicit opt-in: issue only catalog SELECTs in one snapshot owned by this call."""
    from app.db.catalog import list_compatibility, list_parts
    from app.db.connection import get_connection

    categories = {part["category"] for link in reviewed for part in link.parts}
    endpoint_keys = {
        record[endpoint]
        for link in reviewed
        for record in link.compatibilities
        for endpoint in ("part_a_key", "part_b_key")
    }
    with closing(get_connection()) as connection:
        is_tidb = "tidb" in (connection.server_info or "").casefold()
        connection.start_transaction(consistent_snapshot=True, readonly=None if is_tidb else True)
        try:
            rows = [
                r
                for category in sorted(categories)
                for r in list_parts(connection, category=category)
            ]
            endpoints = [
                r["part_id"]
                for r in rows
                if r["specs"].get("_provenance", {}).get("source_key") in endpoint_keys
            ]
            evidence = list_compatibility(connection, part_ids=endpoints) if endpoints else []
            return resolve_links(reviewed, rows, evidence)
        finally:
            connection.rollback()
