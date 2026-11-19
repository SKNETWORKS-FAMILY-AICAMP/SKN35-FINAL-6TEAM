from dataclasses import replace
from uuid import UUID

import pytest

from app.rag.loader import Corpus, load_corpus
from app.rag.points import build_points
from app.rag.search import search


def test_real_points_keep_stable_ids_source_attribution_and_exact_chunk_links():
    corpus = load_corpus()
    chunk_key = "JINBONG:CHK-FW-001"
    chunk = corpus.chunks[chunk_key]
    source = corpus.sources[chunk["source_key"]]
    # Synthetic resolver output. Fact links must never appear on a same-source chunk.
    cited = {row["source_key"] for row in corpus.chunks.values()}
    fact = next(row for row in corpus.facts.values() if row["source_key"] in cited)
    links = {"parts": [{"part_source_key": "fixture-part", "part_id": 7}], "compatibilities": []}
    offline = build_points(corpus, resolved_links={fact["fact_key"]: links})
    by_key = {point.payload["chunk_key"]: point for point in offline}
    point = by_key[chunk_key]
    assert len({point.id for point in offline}) == 85
    assert point.id == UUID("c0e03a39-524e-5ef4-b1f9-03ec3adc2221")
    assert point.vector is None
    assert point.payload["source_key"] == chunk["source_key"]
    assert point.payload["canonical_source_url"] == source["정규 URL"]
    assert point.payload["canonical_source_url"].endswith("b1m60foth")
    assert point.payload["source_url"] == corpus.crawls["CRAWL-001"]["공식 URL"]
    assert point.payload["source_url"].endswith("B1M60foth")
    assert point.payload["source_title"] == source["문서명"]
    assert point.payload["publisher"] == source["발행처"]
    assert all(x.payload["links"] == {"parts": [], "compatibilities": []} for x in offline)
    assert point.payload["topics"] == ["memory_xmp", "xmp_boot"]
    assert point.payload["categories"] == []
    assert by_key["JINBONG:CHK-FW-003"].payload["categories"] == ["storage"]
    no_vendor = next(row for row in corpus.chunks.values() if not row["metadata"].get("vendor"))
    assert by_key[no_vendor["chunk_key"]].payload["brands"] == []

    embedded_texts = []

    def test_encoder(text):
        embedded_texts.append(text)
        return (0.0, 2.0)

    embedded = build_points(corpus, embed=test_encoder, resolved_links={chunk_key: links})
    assert embedded_texts == [row["chunk_text"] for row in corpus.chunks.values()]
    assert [x.id for x in embedded] == [x.id for x in offline]
    assert all(x.vector == (0.0, 1.0) for x in embedded)
    linked = [x for x in embedded if x.payload["links"]["parts"]]
    assert [(x.id, x.payload["links"]) for x in linked] == [(point.id, links)]


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"공식 URL": "https://example.org/alternate"}, "Conflicting original citation URLs"),
        ({"source_key": "test-other-document"}, "Source mismatch"),
    ],
)
def test_ambiguous_or_cross_source_citation_is_rejected(override, message):
    corpus = load_corpus()
    modified = dict(corpus.crawls)
    modified["CRAWL-001"] = {**modified["CRAWL-001"], **override}
    with pytest.raises(ValueError, match=message):
        build_points(replace(corpus, crawls=modified))


@pytest.fixture
def points():
    # Invented documents and vectors solely to exercise search ranking.
    bodies = {
        "A": ("XMP XMP XMP XMP", (-1, 0), "test brand"),
        "B": ("XMP and firmware", (10, 0), "test brand"),
        "C": ("부팅이 느립니다", (0, 1), "test brand"),
        "D": ("XMP XMP XMP XMP XMP", (1000, 0), "other brand"),
    }
    source = {
        "source_key": "fixture-document",
        "문서명": "Test guide",
        "정규 URL": "https://example.org/test",
        "발행처": "Fixture publisher",
    }
    chunks = {
        key: {
            "chunk_key": key,
            "source_key": source["source_key"],
            "chunk_text": text,
            "metadata": {"vendor": brand, "category": "test category", "topic": "alias topic"},
            "주제": "test topic",
            "대상": "test model",
            "검증 상태": "fixture",
            "document_type": "test",
        }
        for key, (text, _, brand) in bodies.items()
    }
    vectors = {text: vector for text, vector, _ in bodies.values()}
    corpus = Corpus({source["source_key"]: source}, chunks, {}, {}, ())
    return build_points(corpus, embed=vectors.__getitem__)


def test_hybrid_rrf_prefilters_both_rankings_and_limits_after_fusion(points):
    filters = {
        "brand": "TEST BRAND",
        "category": ["unused", "test category"],
        "topic": "alias topic",
        "verification_status": "fixture",
    }
    hits = search(points, "xmp", query_vector=(3, 0), filters=filters, limit=3)
    assert [hit.point.payload["chunk_key"] for hit in hits] == ["B", "A", "C"]
    assert [(hit.keyword_rank, hit.vector_rank) for hit in hits] == [(2, 1), (1, 3), (None, 2)]
    assert [hit.score for hit in hits] == pytest.approx([1 / 62 + 1 / 61, 1 / 61 + 1 / 63, 1 / 62])
    assert search(points, "xmp", query_vector=(3, 0), filters=filters, limit=1) == hits[:1]
    assert hits[0].point.payload["source_url"] == "https://example.org/test"
    for field in filters:
        assert search(points, "xmp", query_vector=(3, 0), filters={field: "absent"}) == []


def test_single_channel_search_empty_results_and_ties(points):
    assert [x.point.payload["chunk_key"] for x in search(points, "부팅")] == ["C"]
    assert search(points, "unseen-keyword") == []
    assert search(points, "") == []
    assert search(points, "xmp", limit=0) == []
    assert all(hit.keyword_rank is None for hit in search(points, query_vector=(0, 1)))
    # Duplicate upserts and reversed input order cannot change the equal-vector tie.
    repeated = list(reversed(points)) + points
    assert [x.point.payload["chunk_key"] for x in search(repeated, query_vector=(1, 0))] == [
        "B",
        "D",
        "C",
        "A",
    ]
    with pytest.raises(ValueError, match="filter"):
        search(points, "xmp", filters={"misspelling": "fixture"})
    with pytest.raises(ValueError, match="limit"):
        search(points, "xmp", limit=-1)


def test_exact_hyphenated_part_number_and_topic_alias_find_evidence():
    points = build_points(load_corpus())
    hits = search(points, "M425R1GB4BB0-CWM", filters={"brand": "framework"}, limit=1)
    assert hits[0].point.payload["chunk_key"] == "JINBONG:CHK-FW16-002"
    for topic in ("xmp_boot", "memory_xmp"):
        hits = search(points, "XMP", filters={"topic": topic})
        assert hits[0].point.payload["chunk_key"] == "JINBONG:CHK-FW-001"


@pytest.mark.parametrize("vector", [(), (0, 0), (float("nan"), 0), (0, float("inf")), (True, 0)])
def test_bad_vectors_are_rejected_at_ingestion_and_query(points, vector):
    with pytest.raises(ValueError):
        replace(points[0], vector=vector)
    with pytest.raises(ValueError):
        search(points, query_vector=vector)


def test_embedding_dimensions_are_consistent_and_missing_vectors_are_explicit(points):
    corpus = load_corpus()
    vectors = iter([(1,), (1, 0)])
    with pytest.raises(ValueError, match="dimension"):
        build_points(corpus, embed=lambda _text: next(vectors))
    with pytest.raises(ValueError, match="dimension"):
        search(points, query_vector=(1, 0, 0))
    with pytest.raises(ValueError, match="requires document embeddings"):
        search(build_points(corpus), query_vector=(1, 0))
