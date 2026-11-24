"""Source-isolated domain adaptation for the local Korean DPR encoders."""

import copy
import json
from dataclasses import asdict, dataclass
from itertools import batched

import numpy as np

from app.rag.dpr_bert import Adam, BertConfig, BertEncoder
from app.rag.evaluate import QUESTIONS
from app.rag.hard_negative_experiment import PROBES
from app.rag.korean_tokenizer import KoreanTokenizer
from app.rag.local_dpr import LocalDPR, contrastive_loss, pretrain_mlm
from app.rag.training import TRAINING_PILOT, _text_key, read_questions, training_pool

TRAIN = TRAINING_PILOT.with_name("consultation_domain_train.jsonl")
NEGATIVES = TRAIN.with_name("consultation_domain_negatives.jsonl")


def load_domain(corpus):
    reserved = read_questions(QUESTIONS, allow_empty_gold=True)
    probes = read_questions(PROBES)
    pool = training_pool(corpus, reserved)
    held = [dict(gold=[*r["gold"], r["foil"]]) for r in probes if r["group"] == "heldout_passage"]
    if len(pool) != 50 or pool.keys() != training_pool(corpus, reserved + held).keys():
        raise ValueError("Expected 50 eligible passages isolated from both evaluations")
    rows = read_domain_rows()
    known = {_text_key(r["question"]) for r in reserved + probes}
    known_ids = {r["id"] for r in reserved + probes}
    for row in rows:
        if _text_key(row["question"]) in known or row["id"] in known_ids:
            raise ValueError(f"Question overlaps evaluation: {row['id']}")
        if not {row["negative"], *row["gold"]} <= pool.keys():
            raise ValueError(f"Invalid domain example {row['id']}")
    if {key for r in rows for key in r["gold"]} != pool.keys():
        raise ValueError("Incomplete domain pool coverage")
    return pool, rows


def read_domain_rows():
    """Read only the reviewed training pair files; no evaluation dependency."""
    rows = read_questions(TRAIN)
    labels = [json.loads(line) for line in NEGATIVES.read_text(encoding="utf-8").splitlines()]
    by_id = {r["id"]: r for r in labels}
    if (
        len(rows) != len(labels)
        or len(by_id) != len(labels)
        or by_id.keys() != {r["id"] for r in rows}
    ):
        raise ValueError("Expected one negative label per question ID")
    known = set()
    for row in rows:
        key = _text_key(row["question"])
        label = by_id[row["id"]]
        negative = label["negative"]
        if key in known or negative in row["gold"] or not label["reason"].strip():
            raise ValueError(f"Invalid domain example {row['id']}")
        known.add(key)
        row["negative"] = negative
    return rows


@dataclass(frozen=True)
class Settings:
    epochs: int = 4
    lr: float = 0.0001
    mlm_steps: int = 0
    batch_size: int = 12
    temperature: float = 0.08


def source_split(pool, rows, seed):
    sources = sorted({p.payload["source_key"] for p in pool.values()})
    dev_sources = set(
        np.random.default_rng(seed).permutation(sources)[: max(1, round(len(sources) / 5))]
    )
    train = {k: p for k, p in pool.items() if p.payload["source_key"] not in dev_sources}
    dev = pool.keys() - train.keys()
    # The negative passage is an input to training too. Omit cross-split triples.
    fit = [r for r in rows if {*r["gold"], r["negative"]} <= train.keys()]
    validation = [r for r in rows if set(r["gold"]) <= dev]
    return train, fit, validation


def from_scratch(texts, rows, config: BertConfig, seed):
    tokenizer = KoreanTokenizer.fit(
        [*texts.values(), *(r["question"] for r in rows)], max_merges=2048
    )
    query = BertEncoder(tokenizer.vocab_size, config, np.random.default_rng(seed))
    return LocalDPR(tokenizer, query, copy.deepcopy(query))


def finetune(pretrained, texts, rows, *, seed, settings):
    if not rows or settings.epochs < 1 or settings.batch_size < 1 or settings.mlm_steps < 0:
        raise ValueError("Expected nonempty data and valid training step counts")
    if not all(np.isfinite(v) and v > 0 for v in (settings.lr, settings.temperature)):
        raise ValueError("Expected finite positive learning rate and temperature")
    for row in rows:
        if (
            not row["gold"]
            or row["negative"] in row["gold"]
            or not {row["negative"], *row["gold"]} <= texts.keys()
        ):
            raise ValueError(f"Invalid passage labels for {row['id']}")

    tokenizer = pretrained.tokenizer
    query, passage = copy.deepcopy(pretrained.query), copy.deepcopy(pretrained.passage)
    rng = np.random.default_rng(seed)
    mlm = []
    if settings.mlm_steps:
        # Transfer only the query-side MLM update; retain the pretrained tower differences.
        mlm = pretrain_mlm(
            query, tokenizer, list(texts.values()), rng, settings.mlm_steps, lr=settings.lr
        )
        for name, value in passage.params.items():
            value += query.params[name] - pretrained.query.params[name]
    qopt, popt = Adam(settings.lr), Adam(settings.lr)
    history = []
    for _ in range(settings.epochs):
        losses = []
        for indices in batched(rng.permutation(len(rows)), settings.batch_size, strict=False):
            batch = [rows[i] for i in indices]
            gold = list(dict.fromkeys(k for r in batch for k in r["gold"]))
            keys = list(dict.fromkeys([*gold, *(r["negative"] for r in batch)]))
            positions = {k: i for i, k in enumerate(keys)}
            mask = np.array([[k in r["gold"] for k in gold] for r in batch])
            negatives = np.array([positions[r["negative"]] for r in batch])
            q, qc = query.vectors(
                tokenizer.batch((r["question"] for r in batch), query.config.token_limit)
            )
            p, pc = passage.vectors(
                tokenizer.batch((texts[k] for k in keys), passage.config.token_limit)
            )
            loss, dq, dp = contrastive_loss(
                q, p, mask, settings.temperature, negative_indices=negatives
            )
            if not np.isfinite(loss):
                raise ValueError("Nonfinite domain DPR loss")
            qopt.update(query.params, query.vector_grad(dq, qc))
            popt.update(passage.params, passage.vector_grad(dp, pc))
            losses.append(loss)
        history.append(losses)
    return LocalDPR(tokenizer, query, passage), {
        "settings": asdict(settings),
        "seed": seed,
        "questions": len(rows),
        "passages": len(texts),
        "mlm_losses": mlm,
        "epoch_losses": history,
    }
