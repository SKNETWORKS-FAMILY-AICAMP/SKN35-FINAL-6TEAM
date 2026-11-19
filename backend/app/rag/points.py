"""Build retrieval points from evidence chunks without a database or model dependency."""

import math
from collections.abc import Callable, Iterable, Mapping
from copy import deepcopy
from dataclasses import dataclass
from numbers import Real
from uuid import UUID, uuid5

from app.rag.loader import Corpus

# Permanent namespace: changing it would allocate new IDs for existing chunks.
POINT_NAMESPACE = UUID("3430d8cd-237e-4d77-9164-2ba19978e203")


def unit_vector(values: Iterable[float]) -> tuple[float, ...]:
    """Validate and normalize a cosine vector, including very small/large magnitudes."""
    components = tuple(values)
    if not components or any(
        isinstance(x, bool) or not isinstance(x, Real) or not math.isfinite(x) for x in components
    ):
        raise ValueError("A vector must have finite numeric components and a positive dimension")
    scale = max(abs(x) for x in components)
    if not scale:
        raise ValueError("A zero vector has no cosine similarity")
    scaled = tuple(x / scale for x in components)
    length = math.hypot(*scaled)
    return tuple(x / length for x in scaled)


@dataclass(frozen=True)
class Point:
    id: UUID
    payload: dict
    vector: tuple[float, ...] | None

    def __post_init__(self) -> None:
        if self.vector is not None:
            object.__setattr__(self, "vector", unit_vector(self.vector))


def _tags(*values: str | None) -> list[str]:
    return list(dict.fromkeys(value.strip() for value in values if value and value.strip()))


def build_payload(
    chunk: dict, source: dict, links: dict | None = None, *, citation_url: str | None = None
) -> dict:
    """Keep source attribution, document tags, and verified database links distinct."""
    if source["source_key"] != chunk["source_key"]:
        raise ValueError(f"Source mismatch for {chunk['chunk_key']}")
    metadata = chunk["metadata"]
    return {
        "chunk_key": chunk["chunk_key"],
        "source_key": source["source_key"],
        "chunk_text": chunk["chunk_text"],
        "source_title": source["문서명"],
        "source_url": citation_url or source["정규 URL"],
        "canonical_source_url": source["정규 URL"],
        "publisher": source["발행처"],
        "document_type": chunk["document_type"],
        "target": chunk["대상"],
        "brands": _tags(metadata.get("vendor")),
        "categories": _tags(metadata.get("category"), metadata.get("component")),
        "topics": _tags(chunk["주제"], metadata.get("topic")),
        "verification_status": chunk["검증 상태"],
        "metadata": deepcopy(metadata),
        "links": deepcopy(links) if links is not None else {"parts": [], "compatibilities": []},
    }


def _citation_urls(corpus: Corpus) -> dict[str, str]:
    """Keep the original case of URL paths and query values in citations."""
    urls = {}
    for link in corpus.crawl_chunk_links:
        key = link["chunk_key"]
        crawl = corpus.crawls[link["crawl_id"]]
        if crawl["source_key"] != corpus.chunks[key]["source_key"]:
            raise ValueError(f"Source mismatch for citation {key}")
        url = crawl.get("공식 URL")
        if not isinstance(url, str) or not url.strip():
            raise ValueError(f"Missing original citation URL for {key}")
        if urls.setdefault(key, url) != url:
            raise ValueError(f"Conflicting original citation URLs for {key}")
    return urls


def build_points(
    corpus: Corpus,
    *,
    embed: Callable[[str], Iterable[float]] | None = None,
    resolved_links: Mapping[str, dict] | None = None,
) -> list[Point]:
    """Use one UUID per full chunk key; only chunk_text is passed to the encoder."""
    points = []
    dimension = None
    urls = _citation_urls(corpus)
    for chunk_key, chunk in corpus.chunks.items():
        links = resolved_links.get(chunk_key) if resolved_links is not None else None
        payload = build_payload(
            chunk, corpus.sources[chunk["source_key"]], links, citation_url=urls.get(chunk_key)
        )
        vector = tuple(embed(payload["chunk_text"])) if embed is not None else None
        point = Point(uuid5(POINT_NAMESPACE, chunk_key), payload, vector)
        if point.vector is not None:
            if dimension is not None and len(point.vector) != dimension:
                raise ValueError(f"Inconsistent embedding dimension for {chunk_key}")
            dimension = len(point.vector)
        points.append(point)
    return points
