"""Frozen MiniLM cosine features with trainable asymmetric residual retrieval heads."""

import json
from dataclasses import asdict, dataclass
from itertools import batched

import numpy as np

from app.rag.dpr_bert import Adam
from app.rag.embeddings import DIMENSION, MODEL_NAME, MODEL_REVISION, TOKEN_LIMIT, LocalEmbedder
from app.rag.local_dpr import contrastive_loss


def unit_features(values):
    x = np.asarray(values, dtype=np.float64)
    if x.ndim != 2 or x.shape[1] != DIMENSION or not np.isfinite(x).all():
        raise ValueError("Expected a finite matrix of MiniLM features")
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    if (norms <= 1e-12).any():
        raise ValueError("Backbone returned a zero vector")
    return x / norms


@dataclass(frozen=True)
class AdapterSettings:
    rank: int = 32
    alpha: float = 1.0
    dropout: float = 0.1
    lr: float = 0.001
    weight_decay: float = 0.02
    epochs: int = 6
    temperature: float = 0.08
    batch_size: int = 16
    query_only: bool = False

    def __post_init__(self):
        if not 1 <= self.rank <= DIMENSION or min(self.epochs, self.batch_size) < 1:
            raise ValueError("Invalid adapter rank, epochs or batch size")
        if not all(np.isfinite(v) and v > 0 for v in (self.alpha, self.lr, self.temperature)):
            raise ValueError("Expected finite positive scale, learning rate and temperature")
        if not 0 <= self.dropout < 1 or not 0 <= self.lr * self.weight_decay < 1:
            raise ValueError("Invalid dropout or weight decay")


class ResidualAdapter:
    def __init__(self, dim, rank, rng, *, alpha=1.0):
        self.alpha = alpha
        self.params = {
            "W1": rng.normal(0, np.sqrt(2 / (dim + rank)), size=(dim, rank)),
            "b1": np.zeros(rank),
            "W2": np.zeros((rank, dim)),
            "b2": np.zeros(dim),
        }

    def forward(self, x, *, dropout=0.0, rng=None):
        p = self.params
        z = x @ p["W1"] + p["b1"]
        tanh = np.tanh(0.79788456 * (z + 0.044715 * z**3))
        h = 0.5 * z * (1 + tanh)
        mask = None
        if dropout:
            mask = (rng.random(h.shape) >= dropout) / (1 - dropout)
            h *= mask
        raw = x + self.alpha * (h @ p["W2"] + p["b2"])
        norm = np.linalg.norm(raw, axis=1, keepdims=True)
        y = raw / np.maximum(norm, 1e-12)
        return y, (x, z, tanh, mask, h, y, norm)

    def backward(self, dy, cache):
        x, z, tanh, mask, h, y, norm = cache
        projection = y * (dy * y).sum(axis=1, keepdims=True)
        du = (dy - np.where(norm > 1e-12, projection, 0)) / np.maximum(norm, 1e-12)
        residual_grad = self.alpha * du
        dh = residual_grad @ self.params["W2"].T
        if mask is not None:
            dh *= mask
        dz = dh * (
            0.5 * (1 + tanh) + 0.5 * z * (1 - tanh**2) * 0.79788456 * (1 + 3 * 0.044715 * z**2)
        )
        return {
            "W1": x.T @ dz,
            "b1": dz.sum(axis=0),
            "W2": h.T @ residual_grad,
            "b2": residual_grad.sum(axis=0),
        }


class AdamW(Adam):
    def __init__(self, lr, weight_decay):
        super().__init__(lr)
        self.decay_factor = 1 - lr * weight_decay

    def update(self, params, grads):
        for value in params.values():
            value *= self.decay_factor
        super().update(params, grads)


class DualAdapterDPR:
    token_limit = TOKEN_LIMIT

    def __init__(self, embedder, settings, seed):
        self.embedder = embedder
        self.settings = settings
        rng = np.random.default_rng(seed)
        self.query_adapter = ResidualAdapter(DIMENSION, settings.rank, rng, alpha=settings.alpha)
        self.passage_adapter = ResidualAdapter(DIMENSION, settings.rank, rng, alpha=settings.alpha)

    def embed_query(self, text):
        x = unit_features([self.embedder.embed_query(text)])
        return self.query_adapter.forward(x)[0][0].tolist()

    def embed_documents(self, texts):
        for group in batched(self.embedder.embed_documents(texts), 16, strict=False):
            y, _ = self.passage_adapter.forward(unit_features(group))
            yield from y.tolist()

    def save(self, path):
        meta = {
            "format": 1,
            "model": MODEL_NAME,
            "revision": MODEL_REVISION,
            "settings": asdict(self.settings),
            "token_limit": self.token_limit,
        }
        arrays = {
            f"{role}.{k}": v
            for role, head in (("query", self.query_adapter), ("passage", self.passage_adapter))
            for k, v in head.params.items()
        }
        np.savez_compressed(path, metadata=json.dumps(meta), **arrays)

    @classmethod
    def load(cls, path, *, embedder=None):
        with np.load(path, allow_pickle=False) as saved:
            meta = json.loads(saved["metadata"].item())
            if (meta["format"], meta["model"], meta["revision"], meta["token_limit"]) != (
                1,
                MODEL_NAME,
                MODEL_REVISION,
                TOKEN_LIMIT,
            ):
                raise ValueError("Incompatible adapter checkpoint or backbone revision")
            settings = AdapterSettings(**meta["settings"])
            model = cls(
                embedder if embedder is not None else LocalEmbedder(local_files_only=True),
                settings,
                0,
            )
            for role, head in (("query", model.query_adapter), ("passage", model.passage_adapter)):
                for k, dest in head.params.items():
                    value = saved[f"{role}.{k}"]
                    if value.shape != dest.shape or not np.isfinite(value).all():
                        raise ValueError(f"Invalid {role}.{k} weights")
                    dest[:] = value
        return model


@dataclass
class BackboneCache:
    queries: dict
    passages: dict

    @classmethod
    def encode(cls, embedder, rows, texts):
        keys = sorted(texts)
        passages = unit_features(list(embedder.embed_documents(texts[k] for k in keys)))
        queries = unit_features([embedder.embed_query(r["question"]) for r in rows])
        return cls(
            dict(zip((r["id"] for r in rows), queries, strict=True)),
            dict(zip(keys, passages, strict=True)),
        )


def train_adapter(embedder, cache, rows, settings, seed):
    if not rows:
        raise ValueError("Empty adapter training fold")
    for row in rows:
        if (
            not row["gold"]
            or row["negative"] in row["gold"]
            or not {row["negative"], *row["gold"]} <= cache.passages.keys()
        ):
            raise ValueError(f"Invalid passage labels for {row['id']}")
    model = DualAdapterDPR(embedder, settings, seed)
    rng = np.random.default_rng(seed)
    qopt, popt = (AdamW(settings.lr, settings.weight_decay) for _ in range(2))
    losses = []
    for _ in range(settings.epochs):
        for indices in batched(rng.permutation(len(rows)), settings.batch_size, strict=False):
            batch = [rows[i] for i in indices]
            gold = list(dict.fromkeys(k for row in batch for k in row["gold"]))
            keys = list(dict.fromkeys([*gold, *(row["negative"] for row in batch)]))
            pos = {k: i for i, k in enumerate(keys)}
            mask = np.array([[k in row["gold"] for k in gold] for row in batch])
            negatives = np.array([pos[row["negative"]] for row in batch])
            queries = np.stack([cache.queries[row["id"]] for row in batch])
            passages = np.stack([cache.passages[k] for k in keys])
            q, qc = model.query_adapter.forward(queries, dropout=settings.dropout, rng=rng)
            p, pc = model.passage_adapter.forward(
                passages, dropout=0 if settings.query_only else settings.dropout, rng=rng
            )
            loss, dq, dp = contrastive_loss(
                q, p, mask, settings.temperature, negative_indices=negatives
            )
            if not np.isfinite(loss):
                raise ValueError("Nonfinite adapter contrastive loss")
            losses.append(loss)
            qopt.update(model.query_adapter.params, model.query_adapter.backward(dq, qc))
            if not settings.query_only:
                popt.update(model.passage_adapter.params, model.passage_adapter.backward(dp, pc))
    return model, losses
