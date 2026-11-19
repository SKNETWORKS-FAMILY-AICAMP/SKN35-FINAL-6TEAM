"""Read both published RAG releases and verify their document-level joins."""

import json
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

RELEASES_DIR = Path(__file__).resolve().parents[3] / "data" / "rag" / "releases"
BASE_ZIP = "BUILDWISE_RAG_통합데이터_최종본_2026-11-17.zip"
_BOTH = ("source_master", "rag_chunks_normalized", "crawl_records_normalized", "crawl_chunk_map")
_BASE_ONLY = (
    "rag_facts_normalized",
    "source_id_map",
    "crawl_id_crosswalk",
    "brand_scope_normalized",
    "brand_scope_source_map",
)
type Row = dict[str, Any]


class CorpusIntegrityError(ValueError):
    """A release file or a relationship between its records is invalid."""


@dataclass(frozen=True)
class Corpus:
    sources: dict[str, Row]
    chunks: dict[str, Row]
    facts: dict[str, Row]
    crawls: dict[str, Row]
    crawl_chunk_links: tuple[Row, ...]


def _read_rows(directory: Path | zipfile.Path, table: str) -> list[Row]:
    path = directory / f"{table}.jsonl"
    rows = []
    with path.open("r", encoding="utf-8-sig") as stream:
        for number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise CorpusIntegrityError(f"{path}:{number}: invalid JSON: {exc.msg}") from exc
            if not isinstance(row, dict):
                raise CorpusIntegrityError(f"{path}:{number}: expected a JSON object")
            rows.append(row)
    return rows


def _text(row: Row, field: str, location: str) -> str:
    value = row.get(field)
    if not isinstance(value, str) or not value.strip():
        raise CorpusIntegrityError(f"{location}: missing or empty {field}")
    return value


def _index(rows: list[Row], key: str) -> dict[str, Row]:
    result = {}
    for row in rows:
        value = _text(row, key, key)
        if value in result:
            raise CorpusIntegrityError(f"duplicate {key}: {value}")
        result[value] = row
    return result


def _related(row: Row, key: str, target: dict[str, Row], location: str) -> Row:
    value = _text(row, key, location)
    if value not in target:
        raise CorpusIntegrityError(f"{location}: unknown {key} {value}")
    return target[value]


def _check_documents(corpus: Corpus) -> None:
    for key, source in corpus.sources.items():
        for field in ("정규 URL", "발행처", "문서명"):
            _text(source, field, key)
    for table in (corpus.chunks, corpus.facts, corpus.crawls):
        for key, row in table.items():
            _related(row, "source_key", corpus.sources, key)
            if "source_id" in row and row["source_id"] != row["source_key"]:
                raise CorpusIntegrityError(f"{key}: source_id and source_key disagree")
            if row.get("source_mapping_status") != "MAPPED":
                raise CorpusIntegrityError(f"{key}: unresolved source_mapping_status")
    for key, chunk in corpus.chunks.items():
        for field in ("chunk_text", "chunk_id", "검증 상태", "대상", "주제", "document_type"):
            _text(chunk, field, key)
        if not isinstance(chunk.get("metadata"), dict):
            raise CorpusIntegrityError(f"{key}: metadata must be an object")
        for field in ("category", "vendor", "topic", "component"):
            value = chunk["metadata"].get(field)
            if value is not None and not isinstance(value, str):
                raise CorpusIntegrityError(f"{key}: metadata.{field} must be text")
    for key, fact in corpus.facts.items():
        _text(fact, "공식 문서 확인 내용", key)
    for key, crawl in corpus.crawls.items():
        _text(crawl, "crawl_key", key)


def _check_chunk_links(corpus: Corpus) -> None:
    pairs = set()
    original_ids: dict[str, set[str]] = defaultdict(set)
    for row in corpus.crawl_chunk_links:
        crawl = _related(row, "crawl_id", corpus.crawls, "crawl_chunk_map")
        chunk = _related(row, "chunk_key", corpus.chunks, "crawl_chunk_map")
        pair = (crawl["crawl_id"], chunk["chunk_key"])
        if pair in pairs:
            raise CorpusIntegrityError(f"duplicate crawl_chunk_map pair: {pair}")
        if crawl["source_key"] != chunk["source_key"]:
            raise CorpusIntegrityError(f"crawl_chunk_map {pair}: different source_key")
        if row.get("crawl_key") != crawl.get("crawl_key") or row.get(
            "original_chunk_id"
        ) != chunk.get("chunk_id"):
            raise CorpusIntegrityError(f"crawl_chunk_map {pair}: original keys disagree")
        pairs.add(pair)
        original_ids[crawl["crawl_id"]].add(row["original_chunk_id"])
    for key, crawl in corpus.crawls.items():
        linked = crawl.get("linked_chunk_ids") or ""
        if not isinstance(linked, str):
            raise CorpusIntegrityError(f"{key}: linked_chunk_ids must be text")
        declared = {item.strip() for item in linked.split(";") if item.strip()}
        if declared != original_ids[key]:
            raise CorpusIntegrityError(f"{key}: linked_chunk_ids disagree with crawl_chunk_map")
    orphan_chunks = corpus.chunks.keys() - {chunk_key for _, chunk_key in pairs}
    if orphan_chunks:
        raise CorpusIntegrityError(f"chunks missing crawl provenance: {sorted(orphan_chunks)}")


def _check_base_maps(tables: dict[str, list[Row]]) -> None:
    sources = _index(tables["source_master"], "source_key")
    crawls = _index(tables["crawl_records_normalized"], "crawl_id")
    aliases = _index(tables["source_id_map"], "source_alias_key")
    for key, alias in aliases.items():
        _related(alias, "source_key", sources, key)
        if alias.get("mapping_status") != "MAPPED":
            raise CorpusIntegrityError(f"{key}: unresolved source alias")
    crosswalk = _index(tables["crawl_id_crosswalk"], "crawl_id")
    for key, row in crosswalk.items():
        crawl = _related(row, "crawl_id", crawls, "crawl_id_crosswalk")
        if any(row.get(field) != crawl.get(field) for field in ("crawl_key", "source_key")):
            raise CorpusIntegrityError(f"crawl_id_crosswalk {key}: provenance keys disagree")
        if row.get("duplicate_of_global_id"):
            _related(row, "duplicate_of_global_id", crawls, key)
    if missing := crawls.keys() - crosswalk.keys():
        raise CorpusIntegrityError(f"crawl_id_crosswalk missing rows: {sorted(missing)}")
    scopes = _index(tables["brand_scope_normalized"], "coverage_key")
    scope_aliases = set()
    scope_sources: dict[str, set[str]] = defaultdict(set)
    for row in tables["brand_scope_source_map"]:
        _related(row, "scope_key", scopes, "brand_scope_source_map")
        _related(row, "source_key", sources, "brand_scope_source_map")
        scope = row["scope_key"]
        original = _text(row, "original_source_id", "brand_scope_source_map")
        alias = (scope, original)
        if alias in scope_aliases:
            raise CorpusIntegrityError(f"duplicate brand_scope_source_map pair: {alias}")
        source_alias = aliases.get(f"{scope.partition(':')[0]}:{original}")
        if (
            row.get("mapping_status") != "MAPPED"
            or not source_alias
            or source_alias["source_key"] != row["source_key"]
        ):
            raise CorpusIntegrityError(
                f"{scope}: unresolved or inconsistent source alias {original}"
            )
        scope_aliases.add(alias)
        scope_sources[scope].add(row["source_key"])
    for key, scope in scopes.items():
        declared = _text(scope, "canonical_source_keys", key).split(";")
        if {value.strip() for value in declared} != scope_sources[key]:
            raise CorpusIntegrityError(
                f"{key}: canonical_source_keys disagree with brand_scope_source_map"
            )


def load_corpus(releases_dir: Path | None = None) -> Corpus:
    """Load the base ZIP in place and merge the 11/19 JSONL increment by global key."""
    root = RELEASES_DIR if releases_dir is None else Path(releases_dir)
    try:
        with zipfile.ZipFile(root / "2026-11-18" / BASE_ZIP) as archive:
            base = zipfile.Path(archive) / "데이터화" / "normalized"
            tables = {table: _read_rows(base, table) for table in (*_BOTH, *_BASE_ONLY)}
        _check_base_maps(tables)
        increment = root / "2026-11-19" / "normalized"
        for table in _BOTH:
            tables[table].extend(_read_rows(increment, table))
    except (OSError, UnicodeError, zipfile.BadZipFile) as exc:
        raise CorpusIntegrityError(f"cannot read RAG releases in {root}: {exc}") from exc

    corpus = Corpus(
        sources=_index(tables["source_master"], "source_key"),
        chunks=_index(tables["rag_chunks_normalized"], "chunk_key"),
        facts=_index(tables["rag_facts_normalized"], "fact_key"),
        crawls=_index(tables["crawl_records_normalized"], "crawl_id"),
        crawl_chunk_links=tuple(tables["crawl_chunk_map"]),
    )
    _check_documents(corpus)
    _check_chunk_links(corpus)
    return corpus
