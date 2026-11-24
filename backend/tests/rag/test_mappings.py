"""Offline checks for item-scoped reviews and exact catalog identities."""

import json
from dataclasses import replace
from unittest.mock import MagicMock, patch

import pytest

from app.domains.hardware.ingestion.docyx import REVISION
from app.rag.loader import load_corpus
from app.rag.mappings import (
    MAPPINGS_PATH,
    ReviewedLink,
    _original_source_urls,
    load_reviewed_links,
    resolve_links,
    verify_mysql_links,
)


@pytest.fixture(scope="module")
def corpus():
    return load_corpus()


@pytest.fixture(scope="module")
def reviewed(corpus):
    return load_reviewed_links(corpus)


def catalog_row(part, part_id):
    return {
        "part_id": part_id,
        **{field: part[field] for field in ("category", "brand", "name", "model_number")},
        "specs": {
            **part["match_specs"],
            "_provenance": {
                "source_key": part["part_source_key"],
                "source": "docyx",
                "raw_name": part["name"],
                "revision": REVISION,
            },
        },
    }


def test_reviews_apply_only_to_explicit_items_and_models(corpus, reviewed):
    by_chunk = {link.item_key: link for link in reviewed}
    assert len(by_chunk) == 9
    assert not corpus.facts.keys() & by_chunk.keys()
    assert {part["name"] for part in by_chunk["BW20261119:CHK-HW19-020"].parts} == {
        "Noctua NH-D15 G2"
    }
    assert len(by_chunk["BW20261119:CHK-HW19-021"].parts) == 2
    # The ROG STRIX Z590-A GAMING WIFI II text cannot be linked to the WIFI board.
    assert "BW20261119:CHK-HW19-016" not in by_chunk
    assert "BW20261119:CHK-HW19-017" not in by_chunk
    assert all(not link.compatibilities for link in reviewed)
    assert sum(len(link.parts) for link in reviewed) == 17

    link = by_chunk["BW20261119:CHK-HW19-006"]
    part = link.parts[0]
    report = resolve_links([link], [catalog_row(part, 15)])
    assert report.confirmed == {
        link.item_key: {
            "parts": [{"part_id": 15, "part_source_key": part["part_source_key"]}],
            "compatibilities": [],
        }
    }
    # The next chunk uses this same SOURCE ID but received no link in the resolver input.
    assert corpus.chunks["BW20261119:CHK-HW19-007"]["source_key"] == link.source_key
    assert "BW20261119:CHK-HW19-007" not in report.confirmed


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        ("document_key_in_place_of_part_key", "missing"),
        ("duplicate_provenance", "ambiguous"),
        ("model", "identity_mismatch"),
        ("name", "identity_mismatch"),
        ("specs", "identity_mismatch"),
    ],
)
def test_withholds_unresolved_catalog_id(reviewed, mutation, reason):
    link = reviewed[0]
    part = link.parts[0]
    row = catalog_row(part, 10)
    rows = [row]
    if mutation == "document_key_in_place_of_part_key":
        row["specs"]["_provenance"]["source_key"] = link.source_key
    elif mutation == "duplicate_provenance":
        rows.append(dict(row, part_id=11))
    elif mutation == "model":
        row["model_number"] += " WIFI II"
    elif mutation == "name":
        row["name"] += " WIFI II"
    else:
        row["specs"]["ram_type"] = "DDR5"
    report = resolve_links([link], rows)
    assert not report.confirmed
    assert report.unresolved == [
        {"item_key": link.item_key, "part_source_key": part["part_source_key"], "reason": reason}
    ]


def test_null_model_number_requires_the_reviewed_variant_specs(reviewed):
    link = next(link for link in reviewed if link.item_key.endswith("020"))
    row = catalog_row(link.parts[0], 12)
    assert row["model_number"] is None
    assert resolve_links([link], [row]).confirmed
    row["specs"]["color"] = "Black"
    assert not resolve_links([link], [row]).confirmed


def test_model_review_rejects_a_real_but_different_board(corpus, tmp_path):
    manifest = json.loads(MAPPINGS_PATH.read_text(encoding="utf-8"))
    msi, asus = (manifest["links"][index] for index in (0, 2))
    msi["part_source_keys"] = asus["part_source_keys"]
    path = tmp_path / "wrong-existing-board.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="청크 모델"):
        load_reviewed_links(corpus, path)


def test_official_compatibility_urls_use_original_case_and_item_scope(corpus):
    chunk = "test:chunk"
    source = "test:source"
    original = "https://example.test/Board?model=TUF"
    same_source = "https://example.test/OTHER"
    sample = replace(
        corpus,
        chunks={chunk: {"source_key": source}},
        crawls={
            "a": {"source_key": source, "공식 URL": original},
            "b": {"source_key": source, "공식 URL": same_source},
            "c": {"source_key": "other", "공식 URL": original.lower()},
        },
        crawl_chunk_links=({"chunk_key": chunk, "crawl_id": "a"},),
    )
    assert _original_source_urls(sample, chunk, source) == {original}
    assert _original_source_urls(sample, "test:fact", source) == {original, same_source}


@pytest.mark.parametrize(
    "mutation",
    ["wrong_source", "changed_text", "duplicate", "unknown_part", "missing_field", "wrong_type"],
)
def test_stale_or_ambiguous_review_manifest_is_rejected(corpus, tmp_path, mutation):
    manifest = json.loads(MAPPINGS_PATH.read_text(encoding="utf-8"))
    first = manifest["links"][0]
    if mutation == "wrong_source":
        first["source_key"] = "SOURCE-001"
    elif mutation == "changed_text":
        first["reviewed_text_sha256"] = "0" * 64
    elif mutation == "duplicate":
        manifest["links"].append(first)
    elif mutation == "missing_field":
        del first["source_key"]
    elif mutation == "wrong_type":
        manifest["links"] = {}
    else:
        first["part_source_keys"] = [first["source_key"]]
    path = tmp_path / "reviews.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match=r"reviews\.json"):
        load_reviewed_links(corpus, path)


def test_fact_links_are_resolved_under_the_fact_key(corpus, reviewed, tmp_path):
    # Example input represents a test-only fact having its own explicit human review.
    manifest = json.loads(MAPPINGS_PATH.read_text(encoding="utf-8"))
    link = reviewed[0]
    fact_key = "test:fact"
    facts = {
        fact_key: {
            "source_key": link.source_key,
            "공식 문서 확인 내용": corpus.chunks[link.item_key]["chunk_text"],
        }
    }
    entry = manifest["links"][0]
    del entry["chunk_key"]
    del entry["require_model_match"]
    manifest["links"] = [dict(entry, fact_key=fact_key)]
    path = tmp_path / "fact-review.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    fact_links = load_reviewed_links(replace(corpus, facts=facts), path)
    result = resolve_links(fact_links, [catalog_row(link.parts[0], 12)])
    assert result.confirmed.keys() == {fact_key}


def test_compatibility_needs_both_parts_conditions_and_source(reviewed):
    # Synthetic, unrelated to the real manifest. Verify conservative pair-link semantics.
    board = reviewed[0].parts[0]
    ram = {
        "category": "ram",
        "brand": "Test",
        "name": "Test RAM",
        "model_number": "T-RAM",
        "part_source_key": "test-ram",
        "match_specs": {},
    }
    record = {
        "record_key": "test-board-and-ram",
        "part_a_key": board["part_source_key"],
        "part_b_key": ram["part_source_key"],
        "check_type": "MEMORY_QVL",
        "support_status": "CONDITIONAL",
        "bios_scope": "NOT_SPECIFIED",
        "min_bios_version": None,
        "source_url": "https://example.test/qvl",
        "source_publisher": "Test",
        "conditions": {"ram_model_number": "T-RAM", "cpu_family": "Test Family"},
    }
    link = ReviewedLink("test:chunk", "test:document", (board, ram), (record,))
    parts = [catalog_row(board, 1), catalog_row(ram, 2)]
    condition_values = {**record["conditions"], "_record_key": record["record_key"]}
    evidence = {
        **record,
        "conditions": condition_values,
        "compatibility_id": 82,
        "part_a_id": 1,
        "part_b_id": 2,
    }
    assert resolve_links([link], parts, [evidence]).confirmed[link.item_key]["compatibilities"] == [
        {"compatibility_id": 82, "record_key": record["record_key"]}
    ]
    for field, wrong in [
        ("part_b_id", 1),
        ("bios_scope", "ALL"),
        ("source_url", "https://example.test/another"),
        ("conditions", {**condition_values, "cpu_family": "Different"}),
        ("conditions", {**condition_values, "validated_pcb": "1.2 only"}),
    ]:
        result = resolve_links([link], parts, [{**evidence, field: wrong}])
        assert result.confirmed[link.item_key]["compatibilities"] == []
        assert result.unresolved[-1]["reason"] == "evidence_mismatch"
    result = resolve_links([link], parts[:1], [evidence])
    assert result.unresolved[-1]["reason"] == "unresolved_endpoint"


@pytest.mark.parametrize("read_fails", [False, True])
def test_opt_in_mysql_owns_and_rolls_back_its_snapshot(reviewed, read_fails):
    conn = MagicMock(server_info="MySQL 8.4")
    link = reviewed[0]
    row = catalog_row(link.parts[0], 5)
    with (
        patch("app.db.connection.get_connection", return_value=conn),
        patch("app.db.catalog.list_parts", return_value=[row]) as read,
        patch("app.db.catalog.list_compatibility") as evidence,
    ):
        if read_fails:
            read.side_effect = RuntimeError("read failed")
            with pytest.raises(RuntimeError, match="read failed"):
                verify_mysql_links([link])
        else:
            assert verify_mysql_links([link]).confirmed[link.item_key]["parts"][0]["part_id"] == 5
    read.assert_called_once_with(conn, category=link.parts[0]["category"])
    evidence.assert_not_called()
    conn.start_transaction.assert_called_once_with(consistent_snapshot=True, readonly=True)
    conn.rollback.assert_called_once()
    conn.close.assert_called_once()
    conn.commit.assert_not_called()
