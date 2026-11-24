"""Select a MiniLM residual adapter by grouped CV and compare the frozen winner offline."""

import argparse
import tempfile
from dataclasses import asdict
from pathlib import Path

import numpy as np

from app.rag.domain_dpr_benchmark import ROOT, SEED, digest, measure, save
from app.rag.domain_finetune import NEGATIVES, TRAIN, load_domain, read_domain_rows
from app.rag.dual_adapter_dpr import AdapterSettings, BackboneCache, DualAdapterDPR, train_adapter
from app.rag.embeddings import MODEL_NAME, MODEL_REVISION, LocalEmbedder
from app.rag.evaluate import QUESTIONS
from app.rag.hard_negative_experiment import PROBES
from app.rag.loader import load_corpus
from app.rag.local_dpr import LocalDPR
from app.rag.points import build_points
from app.rag.training import read_questions

SELECTION_METRIC = "Unweighted mean of five held-out-source dense MRRs over all 50 passages; first recipe wins ties."
RECIPES = (
    AdapterSettings(rank=16, lr=0.0005, epochs=4),
    AdapterSettings(),
    AdapterSettings(rank=64, lr=0.001, epochs=10, weight_decay=0.05),
    AdapterSettings(rank=32, lr=0.002, epochs=12, dropout=0.15, temperature=0.05),
    AdapterSettings(rank=32, lr=0.001, epochs=6, query_only=True),
)


def source_folds(sources, rows, seed):
    unique = sorted(set(sources.values()))
    if len(unique) < 5:
        raise ValueError("Need at least five distinct sources")
    for group in np.array_split(np.random.default_rng(seed).permutation(unique), 5):
        held = set(group.tolist())
        train_keys = {k for k, source in sources.items() if source not in held}
        dev_keys = sources.keys() - train_keys
        fit = [r for r in rows if {r["negative"], *r["gold"]} <= train_keys]
        dev = [r for r in rows if set(r["gold"]) <= dev_keys]
        if not fit or not dev:
            raise ValueError("Empty training or validation split")
        yield sorted(held), fit, dev


def dense_mrr(cache, rows, model=None):
    keys = sorted(cache.passages)
    docs = np.stack([cache.passages[k] for k in keys])
    queries = np.stack([cache.queries[r["id"]] for r in rows])
    if model is not None:
        docs = model.passage_adapter.forward(docs)[0]
        queries = model.query_adapter.forward(queries)[0]
    ranked = np.argsort(-(queries @ docs.T), axis=1, kind="stable")
    ranks = [
        next(i for i, j in enumerate(order, 1) if keys[j] in row["gold"])
        for order, row in zip(ranked, rows, strict=True)
    ]
    return float(np.mean(1.0 / np.array(ranks)))


def select_and_fit(embedder, pool, rows, output):
    texts = {k: point.payload["chunk_text"] for k, point in pool.items()}
    sources = {k: point.payload["source_key"] for k, point in pool.items()}
    cache = BackboneCache.encode(embedder, rows, texts)
    folds = list(source_folds(sources, rows, SEED))
    trials = []
    for settings in RECIPES:
        scores = []
        for _, fit, dev in folds:
            model, _ = train_adapter(embedder, cache, fit, settings, SEED)
            scores.append(dense_mrr(cache, dev, model))
        trials.append(
            {"settings": asdict(settings), "scores": scores, "mean": float(np.mean(scores))}
        )
    best = max(range(len(trials)), key=lambda i: trials[i]["mean"])
    baseline = [dense_mrr(cache, dev) for _, _, dev in folds]
    model, losses = train_adapter(embedder, cache, rows, RECIPES[best], SEED)
    checkpoint = output / "dpr_minilm_dual.npz"
    model.save(checkpoint)
    save(
        output,
        "training.json",
        {
            "selection_metric": SELECTION_METRIC,
            "seed": SEED,
            "model": MODEL_NAME,
            "revision": MODEL_REVISION,
            "files_sha256": {p.name: digest(p) for p in (TRAIN, NEGATIVES)},
            "folds": [
                {
                    "heldout_sources": held,
                    "fit_ids": [r["id"] for r in fit],
                    "dev_ids": [r["id"] for r in dev],
                }
                for held, fit, dev in folds
            ],
            "baseline": {"scores": baseline, "mean": float(np.mean(baseline))},
            "trials": trials,
            "chosen": best,
            "full_fit_questions": len(rows),
            "passages": len(pool),
            "sources": len(set(sources.values())),
            "losses": losses,
            "checkpoint_sha256": digest(checkpoint),
        },
    )
    return checkpoint


def run(prior, output):
    embedder = LocalEmbedder(local_files_only=True)
    previous = LocalDPR.load(prior)
    corpus = load_corpus()
    points = build_points(corpus)
    rows = read_domain_rows()
    labelled = {k for r in rows for k in r["gold"]}
    pool = {p.payload["chunk_key"]: p for p in points if p.payload["chunk_key"] in labelled}
    if len(rows) != 150 or len(pool) != 50 or pool.keys() != labelled:
        raise ValueError("Expected the complete reviewed 150-question, 50-passage dataset")
    # Up to and including checkpoint selection, only training labels have been read.
    checkpoint = select_and_fit(embedder, pool, rows, output)
    audited_pool, audited_rows = load_domain(corpus)
    if pool.keys() != audited_pool.keys() or rows != audited_rows:
        raise ValueError("Training inputs do not match the leakage-audited dataset")
    evaluation = read_questions(QUESTIONS, allow_empty_gold=True) + read_questions(PROBES)
    models = {
        "bm25": (None, None),
        "minilm": (embedder, MODEL_REVISION),
        "dpr_korquad_domain": (previous, digest(prior)),
        "dpr_minilm_dual": (DualAdapterDPR.load(checkpoint, embedder=embedder), digest(checkpoint)),
    }
    result = {
        "evaluation_scope": "Reused consultation_40 and contrast_20 for architecture comparison after source-grouped CV; only one selected adapter evaluated.",
        "seed": SEED,
        "documents": len(points),
        "depth": len(points),
        "models": {},
        "files_sha256": {p.name: digest(p) for p in (TRAIN, NEGATIVES, QUESTIONS, PROBES)},
    }
    for name, (encoder, revision) in models.items():
        report = measure(points, evaluation, name, encoder, revision)
        result["models"][name] = {**report, "revision": revision}
    save(output, "comparison.json", result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--korquad-domain",
        type=Path,
        required=True,
        help="Reviewed domain-tuned LocalDPR checkpoint",
    )
    args = parser.parse_args()
    if not args.korquad_domain.is_file():
        parser.error(f"Missing KorQuAD domain checkpoint: {args.korquad_domain}")
    ROOT.mkdir(exist_ok=True, parents=True)
    output = Path(tempfile.mkdtemp(prefix="dual-adapter-", dir=ROOT))
    print(output, flush=True)
    run(args.korquad_domain, output)


if __name__ == "__main__":
    main()
