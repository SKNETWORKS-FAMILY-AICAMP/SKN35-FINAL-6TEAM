"""Full KorQuAD v1 DPR epoch on the local NumPy BERT.

From backend: python -m app.rag.korquad --data .cache/korquad-v1
Download the official train/dev JSONs from https://korquad.github.io/category/1.0_KOR.html
"""

import argparse
import copy
import hashlib
import json
import re
import tempfile
from bisect import bisect_left, bisect_right
from dataclasses import asdict, dataclass
from itertools import batched, chain
from pathlib import Path
from time import perf_counter

import numpy as np

from app.rag.dpr_bert import Adam, BertConfig, BertEncoder
from app.rag.korean_tokenizer import CLS, PAD, SEP, KoreanTokenizer
from app.rag.local_dpr import LocalDPR, contrastive_loss, pretrain_mlm

SEED = 20261124
BATCH_SIZE = 24


@dataclass
class Example:
    qid: str
    text: str
    parent: int
    answer_start: int
    answer_end: int


@dataclass
class Split:
    contexts: list[str]
    examples: list[Example]
    sha256: str


def load_split(path):
    raw = path.read_bytes()
    dataset = json.loads(raw)
    contexts, examples, seen = {}, [], set()
    for article in dataset["data"]:
        for paragraph in article["paragraphs"]:
            text = paragraph["context"]
            parent = contexts.setdefault(text, len(contexts))
            for qa in paragraph["qas"]:
                qid = qa["id"]
                if qid in seen:
                    raise ValueError(f"Duplicate question ID: {qid}")
                seen.add(qid)
                for answer in qa["answers"]:
                    start = answer["answer_start"]
                    end = start + len(answer["text"])
                    if start >= 0 and end > start and text[start:end] == answer["text"]:
                        examples.append(Example(qid, qa["question"], parent, start, end))
                        break
                else:
                    raise ValueError(f"No valid answer span: {qid}")
    return Split(list(contexts), examples, hashlib.sha256(raw).hexdigest())


def passage_tokens(tokenizer, text):
    ids, starts, ends = [], [], []
    for word in re.finditer(r"\S+", text):
        tokens = tokenizer.tokens(word.group())
        ids.extend(tokens)
        starts.extend([word.start()] * len(tokens))
        ends.extend([word.end()] * len(tokens))
    return ids, starts, ends


def pad(rows):
    output = np.full((len(rows), max(map(len, rows))), PAD, dtype=np.int32)
    for i, row in enumerate(rows):
        output[i, : len(row)] = row
    return output


def window(ids, start, width):
    return [CLS, *ids[start : start + width], SEP]


def positive_window(ids, starts, ends, example, width):
    # Character offsets refer to the original JSON, before Unicode normalization.
    left = bisect_right(ends, example.answer_start)
    right = bisect_left(starts, example.answer_end)
    if right <= left:
        raise ValueError(f"Answer span has no tokens: {example.qid}")
    start = max(0, min(left, (left + right - width) // 2, len(ids) - width))
    return window(ids, start, width), right - left <= width


def log(message):
    print(message, flush=True)


def train(split, tokenizer, output):
    rng = np.random.default_rng(SEED)
    cfg = BertConfig()
    width = cfg.token_limit - 2
    inputs = [passage_tokens(tokenizer, text) for text in split.contexts]
    qrows, prows, covered = [], [], 0
    for ex in split.examples:
        qrows.append(tokenizer.encode(ex.text, cfg.token_limit))
        row, fits = positive_window(*inputs[ex.parent], ex, width)
        prows.append(row)
        covered += fits
    # Non-overlapping windows cover every training passage token once for MLM.
    mlm_windows = [
        (pid, offset)
        for pid, (ids, _, _) in enumerate(inputs)
        for offset in range(0, len(ids), width)
    ]
    rng.shuffle(mlm_windows)
    query = BertEncoder(tokenizer.vocab_size, cfg, rng)

    def mlm_batches():
        for step, block in enumerate(batched(mlm_windows, BATCH_SIZE, strict=False), 1):
            yield pad([window(inputs[pid][0], offset, width) for pid, offset in block])
            if step % 250 == 0:
                log(f"MLM {min(step * BATCH_SIZE, len(mlm_windows))}/{len(mlm_windows)} windows")

    log(f"MLM start: {len(mlm_windows)} windows, {len(inputs)} distinct paragraphs")
    mlm = pretrain_mlm(query, tokenizer, (), rng, 0, encoded_batches=mlm_batches())
    inputs.clear()
    passage = copy.deepcopy(query)
    qopt, popt = Adam(0.0003), Adam(0.0003)
    order = rng.permutation(len(qrows))
    parents = np.array([ex.parent for ex in split.examples])
    gold_by_question = {}
    for ex in split.examples:
        gold_by_question.setdefault(ex.text, set()).add(ex.parent)
    count = 0
    losses = []
    log(f"DPR start: {len(order)} questions")
    for step, group in enumerate(batched(order, BATCH_SIZE, strict=False), 1):
        q, qc = query.vectors(pad([qrows[i] for i in group]))
        p, pc = passage.vectors(pad([prows[i] for i in group]))
        batch_parents = parents[list(group)]
        positives = np.array(
            [
                [pid in gold_by_question[split.examples[i].text] for pid in batch_parents]
                for i in group
            ]
        )
        loss, dq, dp = contrastive_loss(q, p, positives)
        if not np.isfinite(loss):
            raise ValueError(f"Nonfinite DPR loss at batch {step}")
        qopt.update(query.params, query.vector_grad(dq, qc))
        popt.update(passage.params, passage.vector_grad(dp, pc))
        count += len(group)
        losses.append(loss)
        if step % 250 == 0:
            log(f"DPR {count}/{len(order)} questions, recent loss {np.mean(losses[-100:]):.4f}")
    if count != len(split.examples):
        raise ValueError("Incomplete epoch")
    model = LocalDPR(tokenizer, query, passage)
    model.save(output / "local_dpr.npz")
    return {
        "config": asdict(cfg),
        "seed": SEED,
        "batch_size": BATCH_SIZE,
        "questions_trained": count,
        "unique_paragraphs": len(split.contexts),
        "answer_windows_fit": covered,
        "vocabulary": tokenizer.vocab_size,
        "mlm_windows": len(mlm_windows),
        "mlm_losses": mlm,
        "dpr_losses": losses,
    }


def evaluate_dev(model, dev, training_contexts):
    width = model.passage.config.token_limit - 2
    starts, segments = [], []
    for text in dev.contexts:
        ids = model.tokenizer.tokens(text)
        starts.append(len(segments))
        # Index answer-independent overlapping windows of the entire dev corpus.
        last = max(0, len(ids) - width)
        offsets = [*range(0, last, width // 2), last]
        segments.extend(window(ids, i, width) for i in offsets)
    matrix = np.concatenate(
        [model.passage.vectors(pad(group))[0] for group in batched(segments, 24, strict=False)]
    )
    ranks, novel_ranks = [], []
    for group in batched(dev.examples, 32, strict=False):
        qids = model.tokenizer.batch((ex.text for ex in group), model.query.config.token_limit)
        vectors = model.query.vectors(qids)[0]
        scores = np.maximum.reduceat(vectors @ matrix.T, starts, axis=1)
        ordered = np.argsort(-scores, axis=1, kind="stable")
        for ex, row in zip(group, ordered, strict=True):
            rank = int(np.flatnonzero(row == ex.parent)[0]) + 1
            ranks.append(rank)
            if dev.contexts[ex.parent] not in training_contexts:
                novel_ranks.append(rank)

    def metrics(values):
        return {
            "questions": len(values),
            "hit1": sum(r == 1 for r in values),
            "hit5": sum(r <= 5 for r in values),
            "mrr10": sum(1 / r for r in values if r <= 10) / len(values) if values else None,
        }

    return {
        "paragraphs": len(starts),
        "windows": len(segments),
        "all": metrics(ranks),
        "without_train_context_overlap": metrics(novel_ranks),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument(
        "--tokenizer", type=Path, help="Reuse a vocabulary fitted on this train JSON"
    )
    args = parser.parse_args()
    train_set = load_split(args.data / "KorQuAD_v1.0_train.json")
    dev = load_split(args.data / "KorQuAD_v1.0_dev.json")
    if (len(train_set.examples), len(dev.examples)) != (60407, 5774):
        raise ValueError("Expected the complete KorQuAD 1.0 train and dev splits")
    root = Path(__file__).resolve().parents[2] / ".cache" / "rag-evaluations"
    root.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="korquad-epoch-", dir=root))
    log(f"Run directory: {output}")
    start = perf_counter()
    if args.tokenizer:
        meta = json.loads(args.tokenizer.read_text(encoding="utf-8"))
        if meta["train_sha256"] != train_set.sha256:
            raise ValueError("Tokenizer belongs to a different training split")
        tokenizer = KoreanTokenizer(meta["merges"])
    else:
        tokenizer = KoreanTokenizer.fit(
            chain(train_set.contexts, (e.text for e in train_set.examples)), 2048
        )
    history = train(train_set, tokenizer, output)
    history.update(
        train_sha256=train_set.sha256,
        dev_sha256=dev.sha256,
        seconds_until_checkpoint=round(perf_counter() - start, 2),
        source="https://korquad.github.io/category/1.0_KOR.html",
        license="CC BY-ND 2.0 KR",
    )

    def save(name, data):
        (output / name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    save("training.json", history)
    path = output / "local_dpr.npz"
    model = LocalDPR.load(path)
    log("DPR checkpoint saved. Evaluating KorQuAD dev.")
    result = evaluate_dev(model, dev, set(train_set.contexts))
    save("korquad_dev.json", result)
    log(result)
    from app.rag.dpr_experiment import compare
    from app.rag.evaluate import QUESTIONS
    from app.rag.loader import load_corpus
    from app.rag.points import build_points
    from app.rag.training import read_questions

    revision = hashlib.sha256(path.read_bytes()).hexdigest()
    transfer = compare(
        build_points(load_corpus()),
        read_questions(QUESTIONS, allow_empty_gold=True),
        model,
        revision,
    )
    transfer["dpr_sha256"] = revision
    save("comparison.json", transfer)
    log("BUILDWISE comparison complete")


if __name__ == "__main__":
    main()
