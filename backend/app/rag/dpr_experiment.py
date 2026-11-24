"""Offline pilot: python -m app.rag.dpr_experiment [--output NEW_DIRECTORY]."""

import argparse
import hashlib
import json
import tempfile
from collections import defaultdict
from contextlib import closing
from pathlib import Path
from time import perf_counter

import numpy as np
from qdrant_client import QdrantClient

from app.rag.embeddings import MODEL_REVISION, LocalEmbedder
from app.rag.evaluate import QUESTIONS
from app.rag.loader import load_corpus
from app.rag.local_dpr import LocalDPR, train_pilot
from app.rag.points import build_points
from app.rag.qdrant_store import QdrantStore
from app.rag.routing import routed_search
from app.rag.search import search
from app.rag.training import TRAINING_PILOT, prepare_training, read_questions, training_pool


def compare(points, rows, dpr, revision):
    models = {"minilm": LocalEmbedder(local_files_only=True), "dpr": dpr}
    detail = []
    metrics = defaultdict(dict)
    with closing(QdrantClient(":memory:")) as client:
        stores = {}
        for name, encoder in models.items():
            schema = (
                None
                if name == "minilm"
                else {
                    "schema_version": 1,
                    "embedding_model": "buildwise-local-dpr",
                    "embedding_revision": revision,
                    "token_limit": dpr.query.config.token_limit,
                }
            )
            store = QdrantStore(client, name, model_schema=schema)
            store.upsert(points, encoder.embed_documents(p.payload["chunk_text"] for p in points))
            stores[name] = store
        for row in rows:
            question = row["question"]
            result = {"bm25": [h.point.payload["chunk_key"] for h in search(points, question)]}
            for name, encoder in models.items():
                store = stores[name]
                vector = encoder.embed_query(question)
                for mode in ("vector", "hybrid"):
                    hits = store.search(question, vector, mode=mode, limit=5)
                    result[f"{name}_{mode}"] = [h.payload["chunk_key"] for h in hits]
                routed = routed_search(store, question, encoder.embed_query)
                result[f"{name}_auto"] = [p["chunk_key"] for p in routed["results"]]
            ranks = {}
            for method, keys in result.items():
                rank = next((i for i, key in enumerate(keys, 1) if key in row["gold"]), None)
                ranks[method] = rank
                m = metrics[method].setdefault(
                    row["type"],
                    {
                        "questions": 0,
                        "hit1": 0,
                        "hit5": 0,
                        "rr_sum": 0.0,
                        "empty": 0,
                    },
                )
                m["questions"] += 1
                m["hit1"] += int(rank == 1)
                m["hit5"] += int(rank is not None)
                m["rr_sum"] += 1 / rank if rank else 0
                m["empty"] += int(not keys)
            detail.append({**row, "ranks": ranks, "top5": result})
    return {"metrics": dict(metrics), "questions": detail}


def run(output, seed=20261124, mlm_steps=80, dpr_steps=60):
    corpus = load_corpus()
    rows = read_questions(QUESTIONS, allow_empty_gold=True)
    train = read_questions(TRAINING_PILOT)
    prepared = prepare_training(corpus, TRAINING_PILOT, QUESTIONS, len(train))
    pool = training_pool(corpus, rows)
    texts = [p.payload["chunk_text"] for p in pool.values()]
    start = perf_counter()
    model, history = train_pilot(
        texts, prepared["batches"][0], seed=seed, mlm_steps=mlm_steps, dpr_steps=dpr_steps
    )
    history["training_seconds"] = round(perf_counter() - start, 2)
    checkpoint = output / "local_dpr.npz"
    model.save(checkpoint)
    revision = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    history["training_pool_keys"] = sorted(pool)
    history["mlm_steps"], history["dpr_steps"] = mlm_steps, dpr_steps
    history["numpy_version"] = np.__version__
    (output / "training.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    # Evaluate the persisted model so both tokenization and encoder reload are exercised.
    result = compare(build_points(corpus), rows, LocalDPR.load(checkpoint), revision)
    result.update(
        documents=len(corpus.chunks),
        minilm_revision=MODEL_REVISION,
        dpr_sha256=revision,
        seed=seed,
        train_sha256=hashlib.sha256(TRAINING_PILOT.read_bytes()).hexdigest(),
        evaluation_sha256=hashlib.sha256(QUESTIONS.read_bytes()).hexdigest(),
    )
    (output / "comparison.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, help="New run directory; existing runs are preserved"
    )
    args = parser.parse_args()
    if args.output:
        output = args.output.resolve()
        output.mkdir(parents=True, exist_ok=False)
    else:
        root = Path(__file__).resolve().parents[2] / ".cache" / "rag-evaluations"
        root.mkdir(parents=True, exist_ok=True)
        output = Path(tempfile.mkdtemp(prefix="local-dpr-", dir=root))
    print(f"Run directory: {output}", flush=True)
    result = run(output)
    print(json.dumps(result["metrics"], indent=2))


if __name__ == "__main__":
    main()
