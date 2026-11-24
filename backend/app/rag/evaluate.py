"""Run the 40-question consultation pilot offline: python -m app.rag.evaluate

Labels are passage-based development examples, pending independent human review.
Use this set for error analysis, never as the held-out DPR test set.
"""

import json
from collections import Counter
from contextlib import closing
from pathlib import Path

from qdrant_client import QdrantClient

from app.rag.embeddings import MODEL_NAME, MODEL_REVISION, LocalEmbedder
from app.rag.loader import load_corpus
from app.rag.points import build_points
from app.rag.qdrant_store import QdrantStore
from app.rag.routing import routed_search
from app.rag.search import search

QUESTIONS = Path(__file__).resolve().parents[3] / "data/rag/evaluation/consultation_40.jsonl"


def evaluate() -> dict:
    rows = [json.loads(line) for line in QUESTIONS.read_text(encoding="utf-8").splitlines()]
    points = build_points(load_corpus())
    keys = {point.payload["chunk_key"] for point in points}
    if any(set(row["gold"]) - keys for row in rows):
        raise ValueError("평가표의 정답 문단이 현재 배포본에 없습니다.")
    encoder = LocalEmbedder(local_files_only=True)
    hits = {method: Counter() for method in ("bm25", "minilm", "hybrid", "auto")}
    totals = Counter()
    details = []
    with closing(QdrantClient(":memory:")) as client:
        store = QdrantStore(client)
        store.upsert(points, encoder.embed_documents(p.payload["chunk_text"] for p in points))
        for row in rows:
            question = row["question"]
            vector = encoder.embed_query(question)
            auto = routed_search(store, question, encoder.embed_query)
            ranks = {
                "bm25": [h.point.payload for h in search(points, question)],
                "minilm": [h.payload for h in store.search(question, vector, mode="vector")],
                "hybrid": [h.payload for h in store.search(question, vector)],
                "auto": auto["results"],
            }
            first = {}
            group = row["type"]
            totals[group] += 1
            for method, results in ranks.items():
                rank = next(
                    (i for i, p in enumerate(results, 1) if p["chunk_key"] in row["gold"]), None
                )
                first[method] = rank
                if row["gold"]:
                    hits[method][f"{group}_hit5"] += int(rank is not None)
                    hits[method][f"{group}_hit1"] += int(rank == 1)
                else:
                    hits[method]["insufficient_empty"] += int(not results)
            details.append(
                {
                    "id": row["id"],
                    "route": auto["mode"],
                    "first_gold_rank": first,
                    "auto_keys": [p["chunk_key"] for p in auto["results"]],
                }
            )
    return {
        "encoder": MODEL_NAME,
        "revision": MODEL_REVISION,
        "documents": len(points),
        "questions_per_type": totals,
        "counts": hits,
        "per_question": details,
    }


if __name__ == "__main__":
    print(json.dumps(evaluate(), ensure_ascii=False, indent=2))
