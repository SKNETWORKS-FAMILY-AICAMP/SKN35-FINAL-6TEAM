from collections import Counter

import numpy as np
import pytest

from app.rag.domain_dpr_benchmark import metrics, ranked_result
from app.rag.domain_finetune import Settings, finetune, from_scratch, load_domain, source_split
from app.rag.dpr_bert import BertConfig
from app.rag.evaluate import QUESTIONS
from app.rag.hard_negative_experiment import PROBES
from app.rag.loader import load_corpus
from app.rag.local_dpr import LocalDPR
from app.rag.points import build_points
from app.rag.training import _text_key, read_questions


def test_domain_labels_and_source_isolation():
    corpus = load_corpus()
    pool, rows = load_domain(corpus)
    assert len(pool) == 50
    assert 150 <= len(rows) <= 200
    counts = Counter(k for r in rows for k in r["gold"])
    assert set(counts) == set(pool) and set(counts.values()) <= {3, 4}
    assert len({_text_key(r["question"]) for r in rows}) == len(rows)
    assert all(r["question"].strip() and r["negative"] not in r["gold"] for r in rows)
    evaluation = read_questions(QUESTIONS, allow_empty_gold=True)
    held = {k for r in evaluation for k in r["gold"]}
    for r in read_questions(PROBES):
        if r["group"] == "heldout_passage":
            held.update([*r["gold"], r["foil"]])
    payloads = {p.payload["chunk_key"]: p.payload for p in build_points(corpus)}
    train, fit, dev = source_split(pool, rows, 20261124)
    assert fit and dev
    assert all({*r["gold"], r["negative"]} <= train.keys() for r in fit)
    assert all(set(r["gold"]).isdisjoint(train) for r in dev)
    for field in ("source_key", "canonical_source_url", "chunk_text"):

        def values(keys, field=field):
            return {_text_key(payloads[k][field]) for k in keys}

        assert values(pool).isdisjoint(values(held))
        assert values(train).isdisjoint(values(pool.keys() - train.keys()))


def test_finetune_checkpoint_minibatches_and_reproduction(tmp_path):
    texts = {"a": "빨강 단풍", "b": "파랑 바다", "c": "노랑 개나리"}
    rows = [
        {"id": str(i), "question": q, "gold": g, "negative": n}
        for i, (q, g, n) in enumerate(
            [
                ("단풍", ["a"], "b"),
                ("빨강 단풍", ["a"], "c"),
                ("파랑", ["b"], "a"),
                ("개나리", ["c"], "a"),
                ("파랑 바다", ["b"], "c"),
                ("가을 봄", ["a", "c"], "b"),
            ]
        )
    ]
    path = tmp_path / "base.npz"
    config = BertConfig(width=12, heads=3, layers=1, intermediate=20, token_limit=24, output=16)
    from_scratch(texts, rows, config, 42).save(path)
    base = LocalDPR.load(path)
    initial = base.embed_query("단풍")
    args = dict(seed=9, settings=Settings(epochs=24, lr=0.0002, mlm_steps=2, batch_size=3))
    first, history = finetune(base, texts, rows, **args)
    second, repeat = finetune(base, texts, rows, **args)
    assert first.embed_query("단풍") != initial == base.embed_query("단풍")
    assert history == repeat
    losses = history["epoch_losses"]
    assert len(losses) == 24 and all(len(epoch) == 2 for epoch in losses)
    assert np.mean(losses[-4:]) < np.mean(losses[:4])
    trained = tmp_path / "trained.npz"
    first.save(trained)
    restored = LocalDPR.load(trained)
    for role in ("query", "passage"):
        for k, weight in getattr(first, role).params.items():
            assert np.isfinite(weight).all()
            np.testing.assert_array_equal(weight, getattr(second, role).params[k])
            np.testing.assert_array_equal(weight, getattr(restored, role).params[k])
    assert list(restored.embed_documents(texts.values())) == list(
        first.embed_documents(texts.values())
    )
    base.query.params["word"].fill(np.nan)
    with pytest.raises(ValueError, match="Nonfinite"):
        finetune(base, texts, rows, seed=1, settings=Settings())


def test_benchmark_missing_foil_and_unretrieved_gold():
    row = {"gold": ["x", "y"], "foil": "z"}
    ranked = [ranked_result(keys, row) for keys in (["a", "y"], ["z", "x"], [])]
    scores = metrics(ranked)
    assert scores["wins"] == 1 and scores["empty_rate"] == pytest.approx(1 / 3)
    assert scores["hit5"] == 2 and scores["mrr"] == pytest.approx(1 / 3)
