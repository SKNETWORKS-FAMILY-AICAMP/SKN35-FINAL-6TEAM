from itertools import product

import numpy as np
import pytest

from app.rag.dual_adapter_benchmark import source_folds
from app.rag.dual_adapter_dpr import (
    AdamW,
    AdapterSettings,
    BackboneCache,
    DualAdapterDPR,
    ResidualAdapter,
    train_adapter,
    unit_features,
)
from app.rag.embeddings import DIMENSION
from app.rag.local_dpr import contrastive_loss


class SyntheticEmbedder:
    """Fixed synthetic features, deliberately unnormalized like the local ONNX model."""

    def __init__(self):
        rng = np.random.default_rng(31)
        self.values = {
            key: rng.normal(size=DIMENSION) for key in ("A", "B", "C", "a", "b", "c", "aa")
        }

    def embed_query(self, text):
        return self.values[text]

    def embed_documents(self, texts):
        return (self.values[t] for t in texts)


def examples():
    return [
        {"id": q, "question": q, "gold": [g], "negative": n}
        for q, g, n in (("a", "A", "B"), ("aa", "A", "C"), ("b", "B", "A"), ("c", "C", "B"))
    ]


def test_zero_residual_identity_then_two_stage_gradient():
    embedder = SyntheticEmbedder()
    model = DualAdapterDPR(embedder, AdapterSettings(), 7)
    np.testing.assert_allclose(
        model.embed_query("a"), unit_features([embedder.values["a"]])[0], atol=1e-6
    )
    np.testing.assert_allclose(
        list(model.embed_documents(["B", "C"])),
        unit_features([embedder.values[k] for k in ("B", "C")]),
        atol=1e-6,
    )
    head = model.query_adapter
    x = unit_features([embedder.values["a"]])
    dy = np.ones_like(x)
    _, cache = head.forward(x)
    grad = head.backward(dy, cache)
    assert not grad["W1"].any() and not grad["b1"].any() and grad["W2"].any()
    AdamW(0.001, 0.01).update(head.params, grad)
    _, cache = head.forward(x)
    grad = head.backward(dy, cache)
    assert grad["W1"].any() and grad["b1"].any()


def test_gradients_through_two_heads_and_reviewed_negative():
    rng = np.random.default_rng(5)
    heads = [ResidualAdapter(5, 3, rng, alpha=0.7) for _ in range(2)]
    for head in heads:
        head.params["W2"][:] = rng.normal(0, 0.2, (3, 5))
    qx, px = rng.normal(size=(2, 5)), rng.normal(size=(3, 5))
    mask = np.array([[True, False], [True, True]])

    def evaluate():
        # A fixed inverted-dropout mask makes finite differences meaningful.
        q, qc = heads[0].forward(qx, dropout=0.25, rng=np.random.default_rng(11))
        p, pc = heads[1].forward(px)
        loss, dq, dp = contrastive_loss(
            q, p, mask, temperature=0.5, negative_indices=np.array([1, 2])
        )
        return loss, (heads[0].backward(dq, qc), heads[1].backward(dp, pc))

    _, grads = evaluate()
    for head, grad in zip(heads, grads, strict=True):
        for name, params in head.params.items():
            for idx in np.ndindex(params.shape):
                old = params[idx]
                eps = 1e-6
                params[idx] = old + eps
                plus = evaluate()[0]
                params[idx] = old - eps
                minus = evaluate()[0]
                params[idx] = old
                assert grad[name][idx] == pytest.approx((plus - minus) / (2 * eps), abs=2e-8)


@pytest.mark.parametrize("query_only,dropout", [(False, 0.0), (True, 0.2)])
def test_synthetic_fit_reproducibility_and_checkpoint(tmp_path, query_only, dropout):
    embedder, rows = SyntheticEmbedder(), examples()
    cache = BackboneCache.encode(embedder, rows, {k: k for k in ("A", "B", "C")})
    settings = AdapterSettings(rank=8, dropout=dropout, epochs=8, lr=0.0003, query_only=query_only)
    model, losses = train_adapter(embedder, cache, rows, settings, 123)
    same, repeated = train_adapter(embedder, cache, rows, settings, 123)
    assert losses == repeated and losses[-1] < losses[0]
    if not dropout:
        assert np.all(np.diff(losses) < 0)
    assert bool(model.passage_adapter.params["W2"].any()) != query_only
    path = tmp_path / "adapter.npz"
    model.save(path)
    restored = DualAdapterDPR.load(path, embedder=embedder)
    for role, name in product(("query_adapter", "passage_adapter"), ("W1", "W2", "b1", "b2")):
        value = getattr(model, role).params[name]
        for other in (restored, same):
            np.testing.assert_array_equal(value, getattr(other, role).params[name])
    assert model.embed_query("b") == restored.embed_query("b")
    assert list(model.embed_documents(["A", "B"])) == list(restored.embed_documents(["A", "B"]))
    cache.queries["a"][0] = np.nan
    with pytest.raises(ValueError, match="Nonfinite"):
        train_adapter(embedder, cache, rows, settings, 123)


def test_five_folds_keep_entire_sources_and_reviewed_negatives_out_of_fit():
    sources = {i: i // 2 for i in range(14)}
    rows = [{"id": i, "gold": [i], "negative": (i + 3) % 14} for i in sources]
    folds = list(source_folds(sources, rows, 7))
    assert len(folds) == 5
    assert sorted(k for held, _, _ in folds for k in held) == sorted(set(sources.values()))
    assert sorted(r["id"] for _, _, dev in folds for r in dev) == sorted(sources)
    for held, fit, dev in folds:
        assert all(sources[k] not in held for r in fit for k in [*r["gold"], r["negative"]])
        assert all(sources[k] in held for r in dev for k in r["gold"])
