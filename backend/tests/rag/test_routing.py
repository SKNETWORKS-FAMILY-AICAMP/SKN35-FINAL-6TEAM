import json
from collections import Counter
from contextlib import closing

import pytest
from qdrant_client import QdrantClient

from app.rag import __main__ as cli
from app.rag.embeddings import DIMENSION
from app.rag.evaluate import QUESTIONS
from app.rag.loader import load_corpus
from app.rag.points import build_points
from app.rag.qdrant_store import QdrantStore
from app.rag.routing import routed_search


@pytest.fixture
def index(tmp_path):
    points = build_points(load_corpus())
    vector = [1.0] + [0.0] * (DIMENSION - 1)
    with closing(QdrantClient(path=str(tmp_path))) as client:
        QdrantStore(client).upsert(points, [vector] * len(points))
    return tmp_path


def test_exact_lookup_cli_skips_encoder_and_uses_filtered_index(index, capsys, monkeypatch):
    monkeypatch.setattr(cli, "_embedder", lambda _: pytest.fail("Unexpected encoder"))
    for query, brand, expected in (
        ("ｍ425r1gb4bb0-cwm 검증 목록 보여줘", "Framework", ["JINBONG:CHK-FW16-002"]),
        ("M425R1GB4BB0-CW", "Framework", []),
        ("M425R1GB4BB0-CWM", "MSI", []),
        ("M425R1GB4BB0-CWM-V2", "Framework", []),
        ("WD18 조회", "Dell", []),
    ):
        assert cli.main(["search", query, "--path", str(index), "--brand", brand]) == 0
        response = json.loads(capsys.readouterr().out)
        assert response["mode"] == "exact"
        assert [p["chunk_key"] for p in response["results"]] == expected


def test_symptoms_keep_full_query_and_separate_identifier_evidence(index):
    seen = []

    def encode(query):
        seen.append(query)
        return [1.0] + [0.0] * (DIMENSION - 1)

    with closing(QdrantClient(path=str(index))) as client:
        store = QdrantStore(client)
        for query, keys in (
            ("갑자기 화면이 안 떠요", []),
            ("M425R1GB4BB0-CWM으로 바꿨더니 화면이 안 떠요", ["JINBONG:CHK-FW16-002"]),
            ("M425R1GB4BB0-CWZ으로 바꿨더니 화면이 안 떠요", []),
        ):
            response = routed_search(store, query, encode, limit=2)
            assert response["mode"] == "hybrid"
            assert len(response["results"]) == 2
            assert seen[-1] == query
            assert [p["chunk_key"] for p in response["identifier_evidence"]] == keys
        assert len(seen) == 3
        with pytest.raises(ValueError):
            routed_search(store, "  ", encode)


def test_pilot_labels_reference_released_passages():
    rows = [json.loads(line) for line in QUESTIONS.read_text(encoding="utf-8").splitlines()]
    corpus = load_corpus()
    assert len({r["id"] for r in rows}) == len({r["question"] for r in rows}) == 40
    assert Counter(r["type"] for r in rows) == dict.fromkeys(
        ("identifier", "symptom", "constraints", "insufficient"), 10
    )
    for row in rows:
        assert set(row["gold"]) <= corpus.chunks.keys()
        if row["type"] == "insufficient":
            assert not row["gold"] and row["needs"]
        else:
            assert row["gold"]
