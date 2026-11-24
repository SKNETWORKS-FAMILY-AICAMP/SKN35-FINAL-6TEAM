"""Select domain DPR settings internally, then benchmark frozen models on both question sets."""

import argparse
import hashlib
import json
import tempfile
from collections import defaultdict
from contextlib import closing
from dataclasses import asdict
from pathlib import Path

import numpy as np
from qdrant_client import QdrantClient

from app.rag.domain_finetune import (
    NEGATIVES,
    TRAIN,
    Settings,
    finetune,
    from_scratch,
    load_domain,
    source_split,
)
from app.rag.embeddings import MODEL_REVISION, LocalEmbedder
from app.rag.evaluate import QUESTIONS
from app.rag.hard_negative_experiment import PROBES
from app.rag.loader import BASE_ZIP, RELEASES_DIR, load_corpus
from app.rag.local_dpr import LocalDPR, train_pilot
from app.rag.points import build_points
from app.rag.qdrant_store import QdrantStore
from app.rag.routing import routed_search
from app.rag.search import search
from app.rag.training import TRAINING_PILOT, prepare_training, read_questions

ROOT = Path(__file__).resolve().parents[2] / ".cache" / "rag-evaluations"
SEED = 20261124
# Declared before accessing evaluation outcomes. Ties prefer the earlier recipe.
RECIPES = (
    Settings(),
    Settings(epochs=12),
    Settings(epochs=12, lr=0.0002),
    Settings(epochs=12, mlm_steps=8),
)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(directory, name, value):
    (directory / name).write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )


def internal_mrr(model, candidates, rows):
    keys = sorted(candidates)
    docs = np.array(list(model.embed_documents(candidates[k] for k in keys)))
    rr = []
    for row in rows:
        scores = docs @ model.embed_query(row["question"])
        ranked = np.argsort(-scores, kind="stable")
        rank = next(i for i, idx in enumerate(ranked, 1) if keys[idx] in row["gold"])
        rr.append(1 / rank)
    return float(np.mean(rr))


def train_domains(pretrained, pool, rows, output):
    split, fit, dev = source_split(pool, rows, SEED)
    texts = {k: p.payload["chunk_text"] for k, p in pool.items()}
    train_texts = {k: texts[k] for k in split}
    history = {
        "selection_metric": "dense MRR on held-out source questions against all 50 candidates",
        "seed": SEED,
        "internal_train_keys": sorted(split),
        "internal_dev_keys": sorted(pool.keys() - split.keys()),
        "internal_fit_ids": [r["id"] for r in fit],
        "internal_dev_ids": [r["id"] for r in dev],
        "runs": {},
    }
    for name in ("dpr_domain_only", "dpr_korquad_domain"):

        def initial(documents, questions, model_name=name):
            if model_name == "dpr_domain_only":
                return from_scratch(documents, questions, pretrained.query.config, SEED)
            return pretrained

        base = initial(train_texts, fit)
        trials = []
        for recipe in RECIPES:
            model, _ = finetune(base, train_texts, fit, seed=SEED, settings=recipe)
            score = internal_mrr(model, texts, dev)
            trials.append({"settings": asdict(recipe), "dev_mrr": score})
        best = max(range(len(trials)), key=lambda i: trials[i]["dev_mrr"])
        model, final = finetune(
            initial(texts, rows), texts, rows, seed=SEED, settings=RECIPES[best]
        )
        model.save(output / f"{name}.npz")
        history["runs"][name] = {"trials": trials, "chosen": best, "full_fit": final}
        print(
            f"{name}: selected {asdict(RECIPES[best])}, internal MRR {trials[best]['dev_mrr']:.4f}",
            flush=True,
        )
    save(output, "training.json", history)


def ranked_result(keys, row):
    ranks = {k: i for i, k in enumerate(keys, 1)}
    rank = min((ranks[k] for k in row["gold"] if k in ranks), default=None)
    result = {"gold_rank": rank, "empty": not keys, "top5": keys[:5]}
    if "foil" in row:
        foil = ranks.get(row["foil"])
        result.update(foil_rank=foil, win=rank is not None and (foil is None or rank < foil))
    return result


def metrics(results):
    n = len(results)
    ranks = [r["gold_rank"] for r in results]
    report = {
        "n": n,
        "hit1": sum(r == 1 for r in ranks),
        "hit5": sum(r is not None and r <= 5 for r in ranks),
        "mrr": sum(1 / r for r in ranks if r) / n,
        "empty_rate": sum(r["empty"] for r in results) / n,
    }
    if "win" in results[0]:
        report["wins"] = sum(r["win"] for r in results)
        report["win_rate"] = report["wins"] / n
    return report


def measure(points, rows, name, encoder, revision):
    groups = defaultdict(lambda: defaultdict(list))
    details = {}
    depth = len(points)
    with closing(QdrantClient(":memory:")) as client:
        if encoder is not None:
            schema = (
                None
                if name == "minilm"
                else {
                    "schema_version": 1,
                    "embedding_model": name,
                    "embedding_revision": revision,
                    "token_limit": encoder.query.config.token_limit
                    if isinstance(encoder, LocalDPR)
                    else encoder.token_limit,
                }
            )
            store = QdrantStore(client, name, model_schema=schema)
            store.upsert(points, encoder.embed_documents(p.payload["chunk_text"] for p in points))
        for row in rows:
            question = row["question"]
            if encoder is None:
                rankings = {
                    "keyword": [
                        h.point.payload["chunk_key"] for h in search(points, question, limit=depth)
                    ]
                }
            else:
                vec = encoder.embed_query(question)
                rankings = {
                    mode: [
                        h.payload["chunk_key"]
                        for h in store.search(question, vec, mode=mode, limit=depth)
                    ]
                    for mode in ("vector", "hybrid")
                }
                if "type" in row:
                    routed = routed_search(
                        store, question, lambda _, vector=vec: vector, limit=depth
                    )
                    rankings["auto"] = [p["chunk_key"] for p in routed["results"]]
            item = {mode: ranked_result(keys, row) for mode, keys in rankings.items()}
            details[row["id"]] = {**row, "results": item}
            if "group" in row:
                labels = [row["group"], "contrast_all"]
            else:
                labels = [row["type"]] + (["answerable"] if row["gold"] else [])
            for label in labels:
                for mode, result in item.items():
                    groups[label][mode].append(result)
    return {
        "metrics": {
            g: {m: metrics(items) for m, items in modes.items()} for g, modes in groups.items()
        },
        "questions": details,
    }


def run(pretrained_path, output):
    corpus = load_corpus()
    pool, rows = load_domain(corpus)
    pretrained = LocalDPR.load(pretrained_path)
    train_domains(pretrained, pool, rows, output)
    # Reproduce the original 10-question pilot recipe, independent of old cache directories.
    pilot_rows = read_questions(TRAINING_PILOT)
    prepared = prepare_training(corpus, TRAINING_PILOT, QUESTIONS, len(pilot_rows))
    pilot, history = train_pilot(
        [p.payload["chunk_text"] for p in pool.values()],
        prepared["batches"][0],
        seed=SEED,
        mlm_steps=80,
        dpr_steps=60,
    )
    pilot_path = output / "dpr_pilot10.npz"
    pilot.save(pilot_path)
    save(output, "pilot_training.json", history)
    inputs = [
        TRAIN,
        NEGATIVES,
        QUESTIONS,
        PROBES,
        TRAINING_PILOT,
        RELEASES_DIR / "2026-11-18" / BASE_ZIP,
        *sorted((RELEASES_DIR / "2026-11-19" / "normalized").glob("*.jsonl")),
    ]
    points = build_points(corpus)
    result = {
        "documents": len(points),
        "depth": len(points),
        "seed": SEED,
        "files_sha256": {p.name: digest(p) for p in inputs},
        "models": {},
    }
    evaluation = read_questions(QUESTIONS, allow_empty_gold=True) + read_questions(PROBES)
    encoders = {
        "bm25": (None, None),
        "minilm": (LocalEmbedder(local_files_only=True), MODEL_REVISION),
    }
    for name, path in (
        ("dpr_pilot10", pilot_path),
        ("dpr_korquad_only", pretrained_path),
        *((n, output / f"{n}.npz") for n in ("dpr_domain_only", "dpr_korquad_domain")),
    ):
        encoders[name] = LocalDPR.load(path), digest(path)
    for name, (encoder, revision) in encoders.items():
        record = measure(points, evaluation, name, encoder, revision)
        record["revision"] = revision
        if isinstance(encoder, LocalDPR):
            record["passage_token_lengths"] = {
                p.payload["chunk_key"]: len(encoder.tokenizer.tokens(p.payload["chunk_text"])) + 2
                for p in points
            }
        result["models"][name] = record
    save(output, "comparison.json", result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pretrained", type=Path, required=True, help="KorQuAD local_dpr.npz 체크포인트"
    )
    args = parser.parse_args()
    if not args.pretrained.is_file():
        parser.error(f"체크포인트 파일을 찾을 수 없습니다: {args.pretrained}")
    ROOT.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="domain-dpr-", dir=ROOT))
    print(output, flush=True)
    run(args.pretrained, output)


if __name__ == "__main__":
    main()
