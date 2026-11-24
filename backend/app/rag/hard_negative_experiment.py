"""Paired offline DPR experiment: python -m app.rag.hard_negative_experiment"""

import hashlib
import json
import tempfile
from contextlib import closing
from pathlib import Path

from qdrant_client import QdrantClient

from app.rag.evaluate import QUESTIONS
from app.rag.loader import load_corpus
from app.rag.local_dpr import LocalDPR, train_pilot
from app.rag.points import build_points
from app.rag.qdrant_store import QdrantStore
from app.rag.training import TRAINING_PILOT, prepare_training, read_questions, training_pool

LABELS = TRAINING_PILOT.with_name("consultation_negatives.jsonl")
PROBES = QUESTIONS.with_name("contrast_20.jsonl")


def measure(model, revision, points, rows):
    scores = {}
    schema = {
        "schema_version": 1,
        "embedding_model": "buildwise-local-dpr",
        "embedding_revision": revision,
        "token_limit": model.query.config.token_limit,
    }
    with closing(QdrantClient(":memory:")) as client:
        store = QdrantStore(client, "paired_dpr", model_schema=schema)
        store.upsert(points, model.embed_documents(p.payload["chunk_text"] for p in points))
        for row in rows:
            question = row["question"]
            vector = model.embed_query(question)
            dense = store.search(question, vector, mode="vector", limit=len(points))
            ranks = {h.payload["chunk_key"]: i for i, h in enumerate(dense, 1)}
            hybrid = store.search(question, vector, mode="hybrid", limit=5)
            scores[row["id"]] = {
                "gold_rank": min((ranks[k] for k in row["gold"]), default=None),
                "foil_rank": ranks[row["foil"]] if "foil" in row else None,
                "hybrid_rank_at5": next(
                    (i for i, h in enumerate(hybrid, 1) if h.payload["chunk_key"] in row["gold"]),
                    None,
                ),
            }
    return scores


def run(output):
    corpus = load_corpus()
    train = read_questions(TRAINING_PILOT)
    original = read_questions(QUESTIONS, allow_empty_gold=True)
    probes = read_questions(PROBES)
    prepared = prepare_training(corpus, TRAINING_PILOT, QUESTIONS, len(train))
    pool = training_pool(corpus, original)
    labels = [json.loads(line) for line in LABELS.read_text(encoding="utf-8").splitlines()]
    if len(labels) != len(train) or {r["id"] for r in labels} != {r["id"] for r in train}:
        raise ValueError("Negative label IDs must match training questions once each")
    proposed = {
        r["id"]: {c["chunk_key"]: c["bm25_rank"] for c in r["candidates"]}
        for r in prepared["bm25_candidates_for_review"]
    }
    negatives = {}
    for row in labels:
        key = row["negative"]
        if not row["reason"] or proposed[row["id"]].get(key) != row["bm25_rank"]:
            raise ValueError(f"Invalid reviewed candidate: {row['id']}")
        negatives[row["id"]] = (key, pool[key].payload["chunk_text"])
    all_rows = train + original + probes
    if len({r["question"].strip().casefold() for r in all_rows}) != len(all_rows) or len(
        {r["id"] for r in all_rows}
    ) != len(all_rows):
        raise ValueError("Duplicate probe ID or question")
    for row in probes:
        keys = {*row["gold"], row["foil"]}
        if row["foil"] in row["gold"] or not keys <= corpus.chunks.keys():
            raise ValueError(f"Invalid contrast labels: {row['id']}")
        if row["group"] == "heldout_passage" and keys.intersection(pool):
            raise ValueError(f"Held-out passage included in training pool: {row['id']}")
    result = {
        "files_sha256": {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (TRAINING_PILOT, QUESTIONS, LABELS, PROBES)
        },
        "documents": len(corpus.chunks),
        "runs": {},
    }
    points = build_points(corpus)
    for name, extra in (("A", None), ("B", negatives)):
        model, history = train_pilot(
            [p.payload["chunk_text"] for p in pool.values()],
            prepared["batches"][0],
            seed=20261124,
            mlm_steps=80,
            dpr_steps=60,
            hard_negatives=extra,
        )
        path = output / f"{name}.npz"
        model.save(path)
        revision = hashlib.sha256(path.read_bytes()).hexdigest()
        result["runs"][name] = {
            "history": history,
            "sha256": revision,
            "scores": measure(LocalDPR.load(path), revision, points, original + probes),
        }
    a, b = (result["runs"][name]["history"] for name in ("A", "B"))
    if (
        a["initial_weights_sha256"] != b["initial_weights_sha256"]
        or a["mlm_losses"] != b["mlm_losses"]
    ):
        raise ValueError("Paired runs started from different encoders")
    (output / "paired.json").write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2] / ".cache" / "rag-evaluations"
    root.mkdir(exist_ok=True, parents=True)
    output = Path(tempfile.mkdtemp(prefix="hard-negatives-", dir=root))
    print(output, flush=True)
    run(output)
