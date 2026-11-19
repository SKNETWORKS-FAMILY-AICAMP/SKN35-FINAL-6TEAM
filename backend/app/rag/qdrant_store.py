"""Store cited passages and query their dense and lexical vectors in Qdrant."""

import hashlib
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from uuid import uuid5

from qdrant_client import QdrantClient, models
from qdrant_client.http.exceptions import UnexpectedResponse

from app.rag.embeddings import DIMENSION, MODEL_NAME, MODEL_REVISION, TOKEN_LIMIT
from app.rag.points import POINT_NAMESPACE, Point, unit_vector
from app.rag.search import _FILTER_FIELDS, _RRF_K, _normalize, _tokens

DEFAULT_COLLECTION = "buildwise_rag"
_DENSE = "dense"
_SPARSE = "lexical"
_FILTER = "_filters"
_SCHEMA = {
    "schema_version": 1,
    "embedding_model": MODEL_NAME,
    "embedding_revision": MODEL_REVISION,
    "token_limit": TOKEN_LIMIT,
}


def _sparse_vector(text: str, *, document: bool) -> models.SparseVector:
    # Sparse dimensions must be uint32 and stable across Python processes.
    counts = Counter(
        int.from_bytes(hashlib.blake2s(term.encode(), digest_size=4).digest(), "big")
        for term in _tokens(text)
    )
    indices = sorted(counts)
    # BM25 term-frequency saturation (k1=1.2, b=0). Qdrant supplies live corpus IDF.
    values = (
        [2.2 * counts[i] / (1.2 + counts[i]) for i in indices] if document else [1.0] * len(indices)
    )
    return models.SparseVector(indices=indices, values=values)


def _dense_vector(vector: Iterable[float]) -> list[float]:
    values = unit_vector(vector)
    if len(values) != DIMENSION:
        raise ValueError(f"Expected a dense embedding with {DIMENSION} dimensions")
    return [float(value) for value in values]


def _query_filter(filters: Mapping[str, str | Sequence[str]] | None) -> models.Filter | None:
    conditions = []
    for key, value in (filters or {}).items():
        if key not in _FILTER_FIELDS:
            raise ValueError(f"Unknown search filter: {key}")
        choices = [value] if isinstance(value, str) else value
        normalized = [_normalize(choice) for choice in choices]
        conditions.append(
            models.FieldCondition(key=f"{_FILTER}.{key}", match=models.MatchAny(any=normalized))
        )
    return models.Filter(must=conditions) if conditions else None


class QdrantStore:
    """Use a caller-owned local or server client and one model-specific collection."""

    def __init__(self, client: QdrantClient, collection: str = DEFAULT_COLLECTION):
        self.client = client
        self.collection = collection

    def _check_collection(self) -> None:
        config = self.client.get_collection(self.collection).config
        vectors = config.params.vectors
        dense = vectors.get(_DENSE) if isinstance(vectors, dict) else None
        sparse = (config.params.sparse_vectors or {}).get(_SPARSE)
        if (
            dense is None
            or dense.size != DIMENSION
            or dense.distance != models.Distance.COSINE
            or sparse is None
            or sparse.modifier != models.Modifier.IDF
            or (config.metadata or {}).get("buildwise") != _SCHEMA
        ):
            raise ValueError(
                f"Incompatible model or vector configuration in collection {self.collection!r}"
            )

    def _ensure_collection(self) -> None:
        if not self.client.collection_exists(self.collection):
            try:
                self.client.create_collection(
                    self.collection,
                    vectors_config={
                        _DENSE: models.VectorParams(size=DIMENSION, distance=models.Distance.COSINE)
                    },
                    sparse_vectors_config={
                        _SPARSE: models.SparseVectorParams(modifier=models.Modifier.IDF)
                    },
                    metadata={"buildwise": _SCHEMA},
                )
            except ValueError, UnexpectedResponse:
                # A concurrent indexer may have just created it. Validate its schema below.
                if not self.client.collection_exists(self.collection):
                    raise
        self._check_collection()

    def upsert(self, points: Iterable[Point], vectors: Iterable[Iterable[float]]) -> int:
        """Validate the paired batch, upsert it with stable chunk IDs, return the exact count."""
        batch = []
        for point, vector in zip(points, vectors, strict=True):
            payload = point.payload
            if point.id != uuid5(POINT_NAMESPACE, payload["chunk_key"]):
                raise ValueError(f"Point ID does not match chunk key {payload['chunk_key']}")
            tags = {}
            for field, key in _FILTER_FIELDS.items():
                value = payload[key]
                tags[field] = [
                    _normalize(tag) for tag in ([value] if isinstance(value, str) else value)
                ]
            fields = [
                payload["chunk_text"],
                payload["target"],
                payload["source_title"],
                *payload["topics"],
                *payload["brands"],
                *payload["categories"],
            ]
            batch.append(
                models.PointStruct(
                    id=str(point.id),
                    vector={
                        _DENSE: _dense_vector(vector),
                        _SPARSE: _sparse_vector(" ".join(fields), document=True),
                    },
                    payload={**payload, _FILTER: tags},
                )
            )
        self._ensure_collection()
        if batch:
            self.client.upsert(self.collection, batch, wait=True)
        return self.client.count(self.collection, exact=True).count

    def search(
        self,
        query: str,
        query_vector: Iterable[float],
        *,
        mode: str = "hybrid",
        filters: Mapping[str, str | Sequence[str]] | None = None,
        limit: int = 5,
    ) -> list[models.ScoredPoint]:
        """Apply the same payload restrictions to each retrieval branch before fusion."""
        if mode not in {"hybrid", "vector"} or limit < 0:
            raise ValueError("Use mode 'hybrid' or 'vector' and a nonnegative limit")
        self._check_collection()
        condition = _query_filter(filters)
        dense = _dense_vector(query_vector)
        if limit == 0:
            return []
        lexical = _sparse_vector(query, document=False) if mode == "hybrid" else None
        # Return the original payload fields, including the exact URL captured at crawl time.
        payload = models.PayloadSelectorExclude(exclude=[_FILTER])
        if lexical is None or not lexical.indices:
            return self.client.query_points(
                self.collection,
                query=dense,
                using=_DENSE,
                query_filter=condition,
                limit=limit,
                with_payload=payload,
            ).points

        window = max(32, limit * 4)
        return self.client.query_points(
            self.collection,
            prefetch=[
                models.Prefetch(query=dense, using=_DENSE, filter=condition, limit=window),
                models.Prefetch(query=lexical, using=_SPARSE, filter=condition, limit=window),
            ],
            # Qdrant's position in the RRF denominator is zero-based.
            query=models.RrfQuery(rrf=models.Rrf(k=_RRF_K + 1)),
            query_filter=condition,
            limit=limit,
            with_payload=payload,
        ).points
