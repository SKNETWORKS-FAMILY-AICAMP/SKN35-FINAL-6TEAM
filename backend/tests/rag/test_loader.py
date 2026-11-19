"""Exercise the real releases and corrupt only temporary copies of normalized rows."""

import json
import shutil
from zipfile import ZipFile

import pytest

from app.rag.loader import BASE_ZIP, RELEASES_DIR, CorpusIntegrityError, load_corpus


def test_release_counts_and_global_provenance():
    corpus = load_corpus()
    assert (len(corpus.chunks), len(corpus.sources), len(corpus.facts)) == (85, 102, 50)
    assert (len(corpus.crawls), len(corpus.crawl_chunk_links)) == (166, 138)
    assert len({row["source_key"] for row in corpus.chunks.values()}) == 64
    first, copied = (corpus.crawls[key] for key in ("CRAWL-001", "CRAWL-063"))
    assert first["original_crawl_id"] == copied["original_crawl_id"]
    assert first["crawl_key"] != copied["crawl_key"]
    assert corpus.chunks["BW20261119:CHK-HW19-001"]["source_key"] == "SOURCE-084"


def test_default_cli_validates_points_and_searches_without_mysql(monkeypatch, capsys):
    from app.rag import __main__ as cli

    def unexpected_db_call(*_args):
        pytest.fail("Offline CLI attempted MySQL verification")

    monkeypatch.setattr(cli, "verify_mysql_links", unexpected_db_call)
    assert cli.main(["validate"]) == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["unique_points"] == summary["chunks"] == 85
    assert summary["mysql"]["status"] == "not_requested"

    assert cli.main(["search", "M2_1", "--brand", "MSI", "--limit", "1"]) == 0
    response = json.loads(capsys.readouterr().out)
    assert response["mode"] == "keyword"
    (hit,) = response["results"]
    assert hit["source_key"] == "SOURCE-088"
    assert hit["source_url"].startswith("https://")


def test_explicit_mysql_validation_signals_unresolved_links(monkeypatch, capsys):
    from app.rag import __main__ as cli
    from app.rag.mappings import MappingReport

    # This exercises the CLI's exit status without opening a connection.
    report = MappingReport(confirmed={}, unresolved=[{"reason": "missing part"}])
    monkeypatch.setattr(cli, "verify_mysql_links", lambda _: report)
    assert cli.main(["validate", "--mysql"]) == 1
    assert json.loads(capsys.readouterr().out)["mysql"]["status"] == "unresolved"


@pytest.fixture
def releases(tmp_path):
    # Copy only the runtime inputs, leaving the original releases untouched.
    base = tmp_path / "2026-11-18"
    base.mkdir()
    shutil.copyfile(RELEASES_DIR / base.name / BASE_ZIP, base / BASE_ZIP)
    shutil.copytree(
        RELEASES_DIR / "2026-11-19" / "normalized", tmp_path / "2026-11-19" / "normalized"
    )
    return tmp_path


@pytest.mark.parametrize(
    ("table", "field", "value", "error"),
    [
        ("source_master", "source_key", "SOURCE-001", "duplicate source_key"),
        ("rag_chunks_normalized", "chunk_key", "JINBONG:CHK-FW-001", "duplicate chunk_key"),
        ("rag_chunks_normalized", "source_key", "absent", "unknown source_key"),
        ("rag_chunks_normalized", "source_id", "SOURCE-001", "source_id and source_key disagree"),
        ("rag_chunks_normalized", "chunk_text", " ", "empty chunk_text"),
        ("rag_chunks_normalized", "metadata", {"category": 1}, r"metadata\.category"),
        ("source_master", "정규 URL", "", "empty 정규 URL"),
        ("crawl_records_normalized", "crawl_id", "CRAWL-001", "duplicate crawl_id"),
        ("crawl_records_normalized", "source_key", "SOURCE-085", "different source_key"),
        ("crawl_chunk_map", "crawl_id", "absent", "unknown crawl_id"),
        ("crawl_chunk_map", "chunk_key", "absent", "unknown chunk_key"),
    ],
)
def test_corrupt_increment_is_rejected(releases, table, field, value, error):
    path = releases / "2026-11-19" / "normalized" / f"{table}.jsonl"
    lines = path.read_text(encoding="utf-8").splitlines()
    row = json.loads(lines[0])
    row[field] = value
    lines[0] = json.dumps(row, ensure_ascii=False)
    path.write_text("\n".join(lines), encoding="utf-8")
    with pytest.raises(CorpusIntegrityError, match=error):
        load_corpus(releases)


def test_missing_link_declared_by_crawl_is_rejected(releases):
    path = releases / "2026-11-19" / "normalized" / "crawl_chunk_map.jsonl"
    path.write_text("\n".join(path.read_text(encoding="utf-8").splitlines()[1:]), encoding="utf-8")
    with pytest.raises(CorpusIntegrityError, match="linked_chunk_ids disagree"):
        load_corpus(releases)


def test_malformed_json_reports_source_file_and_line(releases):
    path = releases / "2026-11-19" / "normalized" / "source_master.jsonl"
    with path.open("a", encoding="utf-8") as stream:
        stream.write("\n{broken JSON}\n")
    with pytest.raises(CorpusIntegrityError, match=r"source_master\.jsonl:\d+: invalid JSON"):
        load_corpus(releases)


@pytest.mark.parametrize(
    ("table", "field", "bad_value", "error"),
    [
        ("rag_facts_normalized", "source_key", "missing-document", "unknown source_key"),
        ("brand_scope_source_map", "scope_key", "missing-scope", "unknown scope_key"),
        ("brand_scope_normalized", "canonical_source_keys", "SOURCE-001", "canonical_source_keys"),
        ("brand_scope_source_map", "mapping_status", "CONFLICT", "inconsistent source alias"),
        ("crawl_id_crosswalk", "duplicate_of_global_id", "missing-crawl", "unknown duplicate_of"),
        ("crawl_id_crosswalk", None, None, "crosswalk missing rows"),
    ],
)
def test_base_release_foreign_keys_are_checked(releases, table, field, bad_value, error):
    member = f"데이터화/normalized/{table}.jsonl"
    with (
        ZipFile(RELEASES_DIR / "2026-11-18" / BASE_ZIP) as original,
        ZipFile(releases / "2026-11-18" / BASE_ZIP, "w") as corrupt,
    ):
        for name in original.namelist():
            if "/normalized/" not in name or not name.endswith(".jsonl"):
                continue
            content = original.read(name)
            if name == member:
                rest = content.splitlines()
                if field is None:
                    del rest[0]
                else:
                    first = json.loads(rest[0])
                    first[field] = bad_value
                    rest[0] = json.dumps(first).encode()
                content = b"\n".join(rest)
            corrupt.writestr(name, content)
    with pytest.raises(CorpusIntegrityError, match=error):
        load_corpus(releases)
