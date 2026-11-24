"""Route indexed consultations using exact identifiers and hybrid passage retrieval."""

import re
from collections.abc import Callable, Iterable, Mapping, Sequence

from app.rag.points import Point
from app.rag.qdrant_store import QdrantStore
from app.rag.search import _normalize, search

_CODE = re.compile(r"[a-z0-9]+(?:[._+-][a-z0-9]+)*")
# Only neutral lookup wording can suppress semantic retrieval. Any remaining intent
# (including a symptom, comparison, exclusion or generation) uses hybrid search.
_LOOKUP = re.compile(
    r"(?:(?:의|을|를|에\s*대한|모델명?|품번|제품|부품|검증|목록|자료|문서|정보|"
    r"조회|검색|확인|(?:보여|해|알려)\s*(?:줘요?|주세요)|"
    r"부탁(?:합니다|해요)?|주세요)|[\s?!.:,‘’“”`'\"])*"
)


def _literal(value: str) -> re.Pattern:
    # Keep code punctuation inside identifiers but allow Korean particles or a final period.
    return re.compile(
        r"(?<![a-z0-9])(?<![a-z0-9][._+\-])" + re.escape(value) + r"(?![a-z0-9]|[._+\-][a-z0-9])"
    )


def _identifiers(query: str, points: list[Point]) -> tuple[list[str], bool]:
    aliases = set()
    for point in points:
        meta = point.payload["metadata"]
        aliases.update(meta.get("part_numbers", []))
        aliases.update([meta.get("model", ""), point.payload["target"]])
    # Catalog model names may contain spaces. Keep the longest matching name intact.
    candidates = {_normalize(alias) for alias in aliases if alias}
    for alias in tuple(candidates):
        candidates.update(
            token
            for token in _CODE.findall(alias)
            if len(token) >= 4 and token[0].isalpha() and any(c.isdigit() for c in token)
        )
    # Keep an unfamiliar part number too, so a typo cannot silently retrieve a nearby SKU.
    for token in _CODE.findall(query):
        if (
            (len(token) >= 6 or (token[0].isalpha() and len(token) >= 3))
            and any(c.isalpha() for c in token)
            and any(c.isdigit() for c in token)
        ):
            candidates.add(token)
    remainder = query
    identifiers = []
    for candidate in sorted(candidates, key=lambda value: (-len(value), value)):
        remainder, count = _literal(candidate).subn(" ", remainder)
        if count:
            identifiers.append(candidate)
    return identifiers, bool(identifiers and _LOOKUP.fullmatch(remainder))


def routed_search(
    store: QdrantStore,
    query: str,
    embed_query: Callable[[str], Iterable[float]],
    *,
    filters: Mapping[str, str | Sequence[str]] | None = None,
    limit: int = 5,
) -> dict:
    """Keep product-specific evidence distinct from the general guidance in hybrid hits."""
    text = _normalize(query)
    if not text or limit < 0:
        raise ValueError("검색어를 입력하고 결과 수를 0 이상으로 지정하세요.")
    points = store.evidence_points(filters)
    identifiers, lookup = _identifiers(text, points)
    exact = []
    if identifiers:
        patterns = [_literal(value) for value in identifiers]
        eligible = []
        for point in points:
            payload = point.payload
            meta = payload["metadata"]
            fields = [
                payload["chunk_text"],
                payload["source_title"],
                payload["target"],
                meta.get("model", ""),
                *meta.get("part_numbers", []),
            ]
            fields = [_normalize(field) for field in fields]
            if all(any(pattern.search(field) for field in fields) for pattern in patterns):
                eligible.append(point)
        # Some identifiers appear only in structured metadata. Retain those after BM25 hits.
        ranked = search(eligible, query, limit=limit)
        seen = {hit.point.id for hit in ranked}
        ordered = [hit.point for hit in ranked] + sorted(
            (point for point in eligible if point.id not in seen),
            key=lambda point: point.payload["chunk_key"],
        )
        exact = [point.payload for point in ordered[:limit]]
    if lookup:
        return {"mode": "exact", "identifiers": identifiers, "results": exact}
    hits = store.search(query, embed_query(query), filters=filters, limit=limit) if limit else []
    return {
        "mode": "hybrid",
        "identifiers": identifiers,
        "identifier_evidence": exact,
        "results": [dict(hit.payload, score=hit.score) for hit in hits],
    }
