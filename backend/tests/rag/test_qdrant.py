"""Exercise local Qdrant; the Korean retrieval checks use the pinned model offline.

Provision the model with the index CLI first. RUN_RAG_MODEL_TESTS=1 makes a
missing snapshot an error. BUILDWISE_RAG_MODEL_CACHE can select its location.
"""

import os
from contextlib import closing
from dataclasses import replace

import pytest
from qdrant_client import QdrantClient

from app.rag.embeddings import DIMENSION, TOKEN_LIMIT, LocalEmbedder
from app.rag.loader import load_corpus
from app.rag.points import build_points
from app.rag.qdrant_store import QdrantStore

# New consultation phrasings. Labels were assigned from the passage bodies
# before running retrieval. These probes are a regression set for this corpus.
KOREAN_QUESTIONS = (
    (
        "llama.cpp로 돌릴 모델이 그래픽 메모리보다 큰데 CPU도 나눠 쓸 수 있나요?",
        "JINBONG:CHK-LLM-002",
    ),
    (
        "MAG B550 TOMAHAWK에 길이 110mm인 SATA SSD를 꽂으려면 어느 소켓을 써야 해요?",
        "BW20261119:CHK-HW19-006",
    ),
    (
        "Dell WD19에서 4K 화면이 30Hz까지만 떠요. 노트북과 도크 사이 대역폭 때문인가요?",
        "BW20261119:CHK-HW19-030",
    ),
    (
        "CB16GU4800과 CB16GS4800이 둘 다 DDR5 16GB라는데 노트북에 들어가는 건 어느 쪽인가요?",
        "BW20261119:CHK-HW19-014",
    ),
    (
        "맥에서 Plugable DisplayLink Manager를 켰는데도 화면이 안 나와요. 어떤 접근 권한을 줘야 하나요?",
        "BW20261119:CHK-HW19-032",
    ),
    (
        "Framework Laptop 13 AMD 7040에 램을 교체하고 XMP로 설정했더니 부팅이 안 돼요.",
        "JINBONG:CHK-FW-001",
    ),
)


@pytest.fixture(scope="module")
def corpus():
    return load_corpus()


@pytest.fixture(scope="module")
def points(corpus):
    return build_points(corpus)


@pytest.fixture(scope="module")
def fixture_vectors(points):
    # Each real document gets a different unit vector to make filtering and
    # idempotence reproducible without model files or network access.
    vectors = []
    for index in range(len(points)):
        vector = [0.0] * DIMENSION
        vector[index] = 1.0
        vectors.append(vector)
    return vectors


def test_repeated_upsert_updates_existing_85_ids_and_reopens(tmp_path, points, fixture_vectors):
    collection = "local_idempotence"
    path = str(tmp_path / "index")
    expected_ids = {point.id for point in points}
    with closing(QdrantClient(path=path)) as client:
        store = QdrantStore(client, collection=collection)
        assert store.upsert(points, fixture_vectors) == len(expected_ids) == 85
        changed = replace(points[0], payload={**points[0].payload, "test_revision": "second"})
        assert store.upsert([changed, *points[1:]], fixture_vectors) == 85
        assert client.count(collection, exact=True).count == 85

    with closing(QdrantClient(path=path)) as reopened:
        records = reopened.retrieve(collection, list(expected_ids), with_payload=True)
        assert {str(record.id) for record in records} == {str(key) for key in expected_ids}
        updated = next(record for record in records if str(record.id) == str(points[0].id))
        assert updated.payload["test_revision"] == "second"
        assert updated.payload["source_url"] == points[0].payload["source_url"]


@pytest.mark.parametrize("mode", ["vector", "hybrid"])
def test_filters_apply_to_search_in_qdrant(mode, points, fixture_vectors):
    with closing(QdrantClient(":memory:")) as client:
        store = QdrantStore(client)
        store.upsert(points, fixture_vectors)
        target = next(p for p in points if p.payload["chunk_key"] == "BW20261119:CHK-HW19-006")
        filters = {
            "brand": ["absent brand", "msi"],
            "category": "메인보드·저장장치",
            "topic": target.payload["topics"][0],
            "verification_status": "verified",
        }
        # Both the dense vector and the text favor a different, ineligible point.
        text, vector = points[0].payload["chunk_text"], fixture_vectors[0]
        hits = store.search(text, vector, mode=mode, filters=filters, limit=1)
        assert [str(hit.id) for hit in hits] == [str(target.id)]
        assert hits[0].payload["source_url"] == target.payload["source_url"]
        for field in filters:
            assert (
                store.search(text, vector, mode=mode, filters={**filters, field: "missing"}) == []
            )


def test_lexical_model_number_changes_the_dense_ranking(points, fixture_vectors):
    by_key = {point.payload["chunk_key"]: point for point in points}
    decoy = by_key["JINBONG:CHK-LLM-002"]
    target = by_key["BW20261119:CHK-HW19-014"]
    with closing(QdrantClient(":memory:")) as client:
        store = QdrantStore(client)
        store.upsert([decoy, target], fixture_vectors[:2])
        query = "CB16GS4800"
        dense = store.search(query, fixture_vectors[0], mode="vector", limit=1)
        hybrid = store.search(query, fixture_vectors[0], mode="hybrid", limit=1)
        assert str(dense[0].id) == str(decoy.id)
        assert str(hybrid[0].id) == str(target.id)


@pytest.fixture(scope="module")
def model():
    try:
        return LocalEmbedder(
            cache_dir=os.getenv("BUILDWISE_RAG_MODEL_CACHE"), local_files_only=True
        )
    except FileNotFoundError:
        if os.getenv("RUN_RAG_MODEL_TESTS") == "1":
            raise
        pytest.skip("Pinned embedding model is not cached; provision it with the RAG CLI")


def test_token_report_counts_special_tokens_and_the_128_token_boundary(model):
    # 'a' is one token in this snapshot; the model adds beginning/end tokens.
    rows = {
        "fits": {"chunk_text": " ".join(["a"] * 126)},
        "truncated": {"chunk_text": " ".join(["a"] * 127)},
    }
    report = model.token_report(rows)
    assert TOKEN_LIMIT == report["token_limit"] == 128
    assert report["min_tokens"] == 128
    assert report["max_tokens"] == 129
    assert report["truncated_count"] == 1
    assert report["truncated"] == [{"chunk_key": "truncated", "tokens": 129, "tokens_dropped": 1}]
    # Same visible prefix, different tails: the actual ONNX inputs stop at the boundary.
    prefix = rows["fits"]["chunk_text"]
    first, second = model.embed_documents([prefix + " 모니터", prefix + " CPU"])
    assert len(first) == len(second) == DIMENSION == 384
    assert first == pytest.approx(second, abs=1e-6)


def test_korean_questions_retrieve_reviewed_evidence_in_top_three(model, points):
    with closing(QdrantClient(":memory:")) as client:
        store = QdrantStore(client)
        vectors = model.embed_documents([point.payload["chunk_text"] for point in points])
        assert store.upsert(points, vectors) == 85

        misses = {}
        for question, expected in KOREAN_QUESTIONS:
            hits = store.search(question, model.embed_query(question), mode="hybrid", limit=3)
            keys = [hit.payload["chunk_key"] for hit in hits]
            if expected not in keys:
                misses[expected] = keys
            for hit in hits:
                assert hit.payload["source_url"].startswith("https://")
        assert len(KOREAN_QUESTIONS) - len(misses) >= 5, f"Hit@3 missed {misses}"
