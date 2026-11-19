"""Offline keyword and cosine retrieval with reciprocal rank fusion."""

import math
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from app.rag.points import Point, unit_vector

_FILTER_FIELDS = {
    "brand": "brands",
    "category": "categories",
    "topic": "topics",
    "verification_status": "verification_status",
}
_TOKEN = re.compile(r"[a-z0-9]+(?:[-._+][a-z0-9]+)*|[가-힣]+|[^\W\d_]+")
_RRF_K = 60


@dataclass(frozen=True)
class SearchHit:
    point: Point
    score: float
    keyword_rank: int | None
    vector_rank: int | None


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text).strip().casefold()


def _tokens(text: str) -> Iterable[str]:
    for word in _TOKEN.findall(_normalize(text)):
        yield word
        if "가" <= word[0] <= "힣" and len(word) > 2:
            # Korean endings can differ between a question and its source paragraph.
            for index in range(len(word) - 1):
                yield word[index : index + 2]
        elif any(mark in word for mark in "-._+"):
            yield from re.split(r"[-._+]", word)


def _keyword_ranks(candidates: list[Point], terms: set[str]) -> dict[str, int]:
    """BM25 over the eligible documents, excluding documents with zero token overlap."""
    if not terms or not candidates:
        return {}
    documents = []
    document_frequency = Counter()
    for point in candidates:
        payload = point.payload
        fields = [payload["chunk_text"], payload["target"], payload["source_title"]]
        fields.extend(payload["topics"])
        fields.extend(payload["brands"])
        fields.extend(payload["categories"])
        counts = Counter(_tokens(" ".join(fields)))
        documents.append((payload["chunk_key"], counts, counts.total()))
        document_frequency.update(terms.intersection(counts))

    if not document_frequency:
        return {}
    size = len(documents)
    mean_length = sum(length for _, _, length in documents) / size
    weights = {
        term: math.log1p((size - freq + 0.5) / (freq + 0.5))
        for term, freq in document_frequency.items()
    }
    ranked = []
    k1, b = 1.2, 0.75
    for key, counts, length in documents:
        saturation = k1 * (1 - b + b * length / mean_length)
        score = math.fsum(
            weights[term] * tf * (k1 + 1) / (tf + saturation)
            for term in weights
            if (tf := counts[term])
        )
        if score > 0:
            ranked.append((-score, key))
    return {key: rank for rank, (_, key) in enumerate(sorted(ranked), start=1)}


def _vector_ranks(candidates: list[Point], query_vector: Iterable[float]) -> dict[str, int]:
    unit_query = unit_vector(query_vector)
    ranked = []
    for point in candidates:
        if point.vector is None:
            raise ValueError("Vector search requires document embeddings")
        if len(point.vector) != len(unit_query):
            raise ValueError("Query and document embedding dimensions differ")
        similarity = math.sumprod(unit_query, point.vector)
        ranked.append((-similarity, point.payload["chunk_key"]))
    return {key: rank for rank, (_, key) in enumerate(sorted(ranked), start=1)}


def _eligible(points: Iterable[Point], filters: Mapping[str, str | Sequence[str]]) -> list[Point]:
    """AND across fields and exact, case-insensitive OR within each field."""
    conditions = {}
    for field, value in filters.items():
        if field not in _FILTER_FIELDS:
            raise ValueError(f"Unknown search filter: {field}")
        choices = [value] if isinstance(value, str) else value
        conditions[_FILTER_FIELDS[field]] = {_normalize(choice) for choice in choices}
    candidates = []
    for point in points:
        for field, wanted in conditions.items():
            actual = point.payload[field]
            values = [actual] if isinstance(actual, str) else actual
            if wanted.isdisjoint(_normalize(value) for value in values):
                break
        else:
            candidates.append(point)
    return candidates


def search(
    points: Iterable[Point],
    query: str = "",
    *,
    query_vector: Iterable[float] | None = None,
    filters: Mapping[str, str | Sequence[str]] | None = None,
    limit: int = 5,
) -> list[SearchHit]:
    """Fuse filtered 1-based ranks; limit applies after fusion. Ties use chunk_key."""
    if limit < 0:
        raise ValueError("Result limit must be nonnegative")
    current = {point.id: point for point in points}
    candidates = _eligible(current.values(), filters or {})
    lexical = _keyword_ranks(candidates, set(_tokens(query)))
    dense = _vector_ranks(candidates, query_vector) if query_vector is not None else {}
    hits = []
    for point in candidates:
        key = point.payload["chunk_key"]
        keyword_rank, vector_rank = lexical.get(key), dense.get(key)
        score = sum(1 / (_RRF_K + rank) for rank in (keyword_rank, vector_rank) if rank is not None)
        if score:
            hits.append(SearchHit(point, score, keyword_rank, vector_rank))
    return sorted(hits, key=lambda hit: (-hit.score, hit.point.payload["chunk_key"]))[:limit]
