"""Train and reload local BERT question/passage encoders without a model hub."""

import copy
import hashlib
import json
from dataclasses import asdict
from itertools import batched

import numpy as np

from app.rag.dpr_bert import Adam, BertConfig, BertEncoder, softmax
from app.rag.korean_tokenizer import BYTE_START, MASK, KoreanTokenizer


def pretrain_mlm(model, tokenizer, texts, rng, steps, *, encoded_batches=None, lr=0.001):
    width = model.config.width
    head = {
        "mlm_weight": rng.normal(0, 0.02, (width, tokenizer.vocab_size)).astype(np.float32),
        "mlm_bias": np.zeros(tokenizer.vocab_size, np.float32),
    }
    optimizer = Adam(lr)
    params = model.params | head
    losses = []

    def sampled_batches():
        for _ in range(steps):
            chosen = rng.choice(len(texts), size=min(8, len(texts)), replace=False)
            yield tokenizer.batch((texts[i] for i in chosen), model.config.token_limit)

    for ids in sampled_batches() if encoded_batches is None else encoded_batches:
        positions = (ids >= BYTE_START) & (rng.random(ids.shape) < 0.15)
        if not positions.any():
            positions.flat[np.flatnonzero(ids >= BYTE_START)[0]] = True
        target = ids[positions].copy()
        # BERT masking: 80% MASK, 10% random vocabulary token, 10% original.
        draw = rng.random(ids.shape)
        ids[positions & (draw < 0.8)] = MASK
        replace = positions & (draw >= 0.8) & (draw < 0.9)
        ids[replace] = rng.integers(BYTE_START, tokenizer.vocab_size, replace.sum())
        hidden, cache = model.forward(ids)
        features = hidden[positions]
        probs = softmax(features @ head["mlm_weight"] + head["mlm_bias"])
        indices = np.arange(len(target))
        losses.append(float(-np.log(probs[indices, target]).mean()))
        if not np.isfinite(losses[-1]):
            raise ValueError("Nonfinite MLM training loss")
        probs[indices, target] -= 1
        probs /= len(target)
        dh = np.zeros_like(hidden)
        dh[positions] = probs @ head["mlm_weight"].T
        grads = model.backward(dh, cache)
        grads.update(mlm_weight=features.T @ probs, mlm_bias=probs.sum(axis=0))
        optimizer.update(params, grads)
    return losses


def contrastive_loss(queries, passages, positives, temperature=0.08, *, negative_indices=None):
    """Negative log of the total probability assigned to each question's valid passages."""
    n_base = positives.shape[1]
    scores = (queries @ passages[:n_base].T) / temperature
    if negative_indices is not None:
        # One additional competitor per query. Repeated in-batch passages receive
        # one extra slot only for their reviewed query, never for another query.
        extra = (queries * passages[negative_indices]).sum(axis=1) / temperature
        scores = np.column_stack((scores, extra))
        positives = np.pad(positives, ((0, 0), (0, 1)))
    all_probs = softmax(scores)
    pos_probs = softmax(np.where(positives, scores, -np.inf))
    loss = -np.log(np.where(positives, all_probs, 0).sum(axis=1)).mean()
    grad = (all_probs - pos_probs) / (len(queries) * temperature)
    dq = grad[:, :n_base] @ passages[:n_base]
    dp = np.zeros_like(passages)
    dp[:n_base] = grad[:, :n_base].T @ queries
    if negative_indices is not None:
        dq += grad[:, -1:] * passages[negative_indices]
        np.add.at(dp, negative_indices, grad[:, -1:] * queries)
    return float(loss), dq, dp


class LocalDPR:
    def __init__(self, tokenizer, query, passage):
        self.tokenizer = tokenizer
        self.query = query
        self.passage = passage

    def embed_query(self, text):
        ids = self.tokenizer.batch([text], self.query.config.token_limit)
        return self.query.vectors(ids)[0][0].tolist()

    def embed_documents(self, texts):
        for group in batched(texts, 8, strict=False):
            ids = self.tokenizer.batch(group, self.passage.config.token_limit)
            yield from self.passage.vectors(ids)[0].tolist()

    def save(self, path):
        meta = {"format": 1, "config": asdict(self.query.config), "merges": self.tokenizer.merges}
        arrays = {
            f"{role}.{name}": param
            for role, model in (("query", self.query), ("passage", self.passage))
            for name, param in model.params.items()
        }
        np.savez_compressed(path, metadata=json.dumps(meta), **arrays)

    @classmethod
    def load(cls, path):
        with np.load(path, allow_pickle=False) as saved:
            meta = json.loads(saved["metadata"].item())
            if meta["format"] != 1:
                raise ValueError("Unknown DPR checkpoint format")
            tokenizer = KoreanTokenizer(meta["merges"])
            models = []
            for role in ("query", "passage"):
                model = BertEncoder(
                    tokenizer.vocab_size, BertConfig(**meta["config"]), np.random.default_rng(0)
                )
                for name, param in model.params.items():
                    value = saved[f"{role}.{name}"]
                    if value.shape != param.shape or not np.isfinite(value).all():
                        raise ValueError(f"Invalid checkpoint parameter: {role}.{name}")
                    param[:] = value
                models.append(model)
        return cls(tokenizer, *models)


def train_pilot(texts, batch, *, seed, mlm_steps, dpr_steps, hard_negatives=None):
    """One full contrastive batch keeps all labelled positives visible to each question."""
    rng = np.random.default_rng(seed)
    questions = batch["questions"]
    passages = batch["passages"]
    train_text = [*texts, *(row["text"] for row in questions)]
    tokenizer = KoreanTokenizer.fit(train_text)
    config = BertConfig()
    query = BertEncoder(tokenizer.vocab_size, config, rng)
    mlm_losses = pretrain_mlm(query, tokenizer, train_text, rng, mlm_steps)
    initial_hash = hashlib.sha256(b"".join(v.tobytes() for v in query.params.values())).hexdigest()
    passage = copy.deepcopy(query)
    qids = tokenizer.batch((q["text"] for q in questions), config.token_limit)
    docs = {p["chunk_key"]: p["text"] for p in passages}
    negative_indices = None
    if hard_negatives is not None:
        if set(hard_negatives) != {row["id"] for row in questions}:
            raise ValueError("Every training query needs one reviewed negative")
        selected = []
        for row in questions:
            key, text = hard_negatives[row["id"]]
            if key in {passages[i]["chunk_key"] for i in row["positive_indices"]}:
                raise ValueError("A reviewed negative is labelled positive for this query")
            docs.setdefault(key, text)
            selected.append(key)
        indices = {key: i for i, key in enumerate(docs)}
        negative_indices = np.array([indices[key] for key in selected])
    pids = tokenizer.batch(docs.values(), config.token_limit)
    positives = np.zeros((len(questions), len(passages)), dtype=bool)
    for i, row in enumerate(questions):
        positives[i, row["positive_indices"]] = True
    qopt, popt = Adam(0.0005), Adam(0.0005)
    losses = []
    for step in range(dpr_steps + 1):
        q, qc = query.vectors(qids)
        p, pc = passage.vectors(pids)
        loss, dq, dp = contrastive_loss(q, p, positives, negative_indices=negative_indices)
        if not np.isfinite(loss):
            raise ValueError("Nonfinite DPR training loss")
        losses.append(loss)
        if step < dpr_steps:
            qopt.update(query.params, query.vector_grad(dq, qc))
            popt.update(passage.params, passage.vector_grad(dp, pc))
    history = {
        "seed": seed,
        "config": asdict(config),
        "vocabulary": tokenizer.vocab_size,
        "mlm_documents": len(texts),
        "questions": len(questions),
        "positive_documents": len(passages),
        "mlm_losses": mlm_losses,
        "dpr_losses": losses,
        "initial_weights_sha256": initial_hash,
        "training_top1": int(
            positives[np.arange(len(q)), (q @ p[: len(passages)].T).argmax(axis=1)].sum()
        ),
    }
    return LocalDPR(tokenizer, query, passage), history
