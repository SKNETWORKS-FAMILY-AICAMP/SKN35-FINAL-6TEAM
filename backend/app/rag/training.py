"""Prepare passage-keyed supervision and a separate BM25 queue for label review."""

import json
from itertools import batched
from pathlib import Path

from app.rag.loader import RELEASES_DIR, Corpus
from app.rag.points import build_points
from app.rag.search import _normalize, search

TRAINING_PILOT = RELEASES_DIR.parent / "training" / "consultation_pilot.jsonl"


def read_questions(path: Path, *, allow_empty_gold: bool = False) -> list[dict]:
    rows = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict) or not all(
            isinstance(row.get(k), str) and row[k].strip() for k in ("id", "question")
        ):
            raise ValueError(f"{path.name}:{line_no} 질문 ID와 원문이 필요합니다.")
        gold = row.get("gold")
        if (
            not isinstance(gold, list)
            or not all(isinstance(key, str) and key.strip() for key in gold)
            or len(set(gold)) != len(gold)
            or (not gold and not allow_empty_gold)
        ):
            raise ValueError(f"{path.name}:{line_no} 정답 문단 키 목록을 확인하세요.")
        rows.append(row)
    if not rows:
        raise ValueError(f"{path.name} 질문표가 비어 있습니다.")
    return rows


def _text_key(text: str) -> str:
    return "".join(_normalize(text).split())


def training_pool(corpus: Corpus, reserved: list[dict]) -> dict:
    """Exclude evaluation sources and copies before tokenizer fitting, MLM or DPR training."""
    payloads = {p.payload["chunk_key"]: p for p in build_points(corpus)}
    held = [payloads[key].payload for row in reserved for key in row["gold"]]
    source_ids = {p["source_key"] for p in held}
    urls = {p["canonical_source_url"] for p in held}
    bodies = {_text_key(p["chunk_text"]) for p in held}
    return {
        key: p
        for key, p in payloads.items()
        if p.payload["source_key"] not in source_ids
        and p.payload["canonical_source_url"] not in urls
        and _text_key(p.payload["chunk_text"]) not in bodies
    }


def prepare_training(corpus: Corpus, train: Path, evaluation: Path, batch_size: int) -> dict:
    if batch_size < 1:
        raise ValueError("배치 크기는 1 이상이어야 합니다.")
    rows = read_questions(train)
    reserved = read_questions(evaluation, allow_empty_gold=True)
    seen_ids = set()
    seen_text = set()
    for row in [*reserved, *rows]:
        question = _text_key(row["question"])
        if question in seen_text or row["id"] in seen_ids:
            raise ValueError(f"중복된 질문 또는 ID: {row['id']}")
        seen_text.add(question)
        seen_ids.add(row["id"])
        if missing := set(row["gold"]).difference(corpus.chunks):
            raise ValueError(f"{row['id']} 알 수 없는 문단: {sorted(missing)}")

    pool = training_pool(corpus, reserved)
    batches, review = [], []
    for batch in batched(rows, batch_size, strict=False):
        keys = list(dict.fromkeys(key for row in batch for key in row["gold"]))
        if overlap := set(keys).difference(pool):
            raise ValueError(f"평가 자료와 겹치는 학습 문단: {sorted(overlap)}")
        positions = {key: i for i, key in enumerate(keys)}
        batches.append(
            {
                "passages": [
                    {"chunk_key": key, "text": pool[key].payload["chunk_text"]} for key in keys
                ],
                "questions": [
                    {
                        "id": row["id"],
                        "text": row["question"],
                        "positive_indices": [positions[key] for key in row["gold"]],
                    }
                    for row in batch
                ],
            }
        )
        for row in batch:
            # Rank over the same eligible corpus; remove positives after computing IDF.
            hits = search(pool.values(), row["question"], limit=len(pool))
            candidates = [
                {"chunk_key": h.point.payload["chunk_key"], "bm25_rank": h.keyword_rank}
                for h in hits
                if h.point.payload["chunk_key"] not in row["gold"]
            ]
            review.append({"id": row["id"], "candidates": candidates[:3]})
    return {
        "label_status": "pilot_pending_human_review",
        "training_questions": len(rows),
        "reserved_questions": len(reserved),
        "eligible_documents": len(pool),
        "batches": batches,
        "bm25_candidates_for_review": review,
    }
