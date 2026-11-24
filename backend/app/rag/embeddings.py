"""Encode passages and questions with the same pinned multilingual ONNX snapshot."""

from collections.abc import Iterable, Iterator, Mapping
from pathlib import Path

MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_REPOSITORY = "Qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q"
MODEL_REVISION = "faf4aa4225822f3bc6376869cb1164e8e3feedd0"
DIMENSION = 384
TOKEN_LIMIT = 128
DEFAULT_CACHE = Path(__file__).resolve().parents[2] / ".venv" / "rag-model-cache"
_FILES = (
    "model_optimized.onnx",
    "config.json",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
)


def _snapshot(cache_dir: Path, local_files_only: bool) -> Path:
    from huggingface_hub import snapshot_download
    from huggingface_hub.errors import LocalEntryNotFoundError

    # A commit-pinned, complete local snapshot needs no network request. The Hub
    # can return a partially populated snapshot when another download was interrupted.
    options = dict(
        repo_id=MODEL_REPOSITORY,
        revision=MODEL_REVISION,
        cache_dir=cache_dir,
        allow_patterns=list(_FILES),
    )
    try:
        cached = Path(snapshot_download(**options, local_files_only=True))
        if all((cached / name).is_file() for name in _FILES):
            return cached
    except LocalEntryNotFoundError:
        pass
    if local_files_only:
        raise FileNotFoundError(f"Model snapshot {MODEL_REVISION} is missing from {cache_dir}")
    snapshot = Path(snapshot_download(**options))
    missing = [name for name in _FILES if not (snapshot / name).is_file()]
    if missing:
        raise FileNotFoundError(f"Incomplete snapshot {MODEL_REVISION}: {', '.join(missing)}")
    return snapshot


class LocalEmbedder:
    """CPU FastEmbed encoder. Only the first uncached use downloads model files."""

    def __init__(self, cache_dir: Path | None = None, *, local_files_only: bool = False):
        from fastembed import TextEmbedding

        location = Path(cache_dir) if cache_dir is not None else DEFAULT_CACHE
        self._snapshot = _snapshot(location, local_files_only)
        self._model = TextEmbedding(
            model_name=MODEL_NAME,
            specific_model_path=str(self._snapshot),
            cache_dir=str(location),
            local_files_only=True,
            providers=["CPUExecutionProvider"],
            threads=4,
            lazy_load=True,
        )

    def embed_documents(self, texts: Iterable[str]) -> Iterator[tuple[float, ...]]:
        """Batch only the caller's passage texts, preserving input order."""
        for vector in self._model.passage_embed(texts, batch_size=16):
            yield tuple(vector.tolist())

    def embed_query(self, text: str) -> tuple[float, ...]:
        """Encode a single query in the passage vector space."""
        vector = next(iter(self._model.query_embed(text)))
        return tuple(vector.tolist())

    def token_report(self, chunks: Mapping[str, dict]) -> dict:
        """Measure input lengths including special tokens, before the model truncates."""
        from fastembed.common.preprocessor_utils import load_tokenizer

        # Use FastEmbed's preprocessing, including its registered special tokens.
        # A separate tokenizer lets the inference instance keep its original limits.
        tokenizer, _ = load_tokenizer(self._snapshot)
        if not tokenizer.truncation or tokenizer.truncation["max_length"] != TOKEN_LIMIT:
            raise ValueError(f"Unexpected tokenizer limit for {MODEL_REVISION}")
        tokenizer.no_truncation()
        tokenizer.no_padding()
        texts = [chunk["chunk_text"] for chunk in chunks.values()]
        lengths = [len(encoding.ids) for encoding in tokenizer.encode_batch(texts)]
        truncated = [
            {"chunk_key": key, "tokens": count, "tokens_dropped": count - TOKEN_LIMIT}
            for key, count in zip(chunks, lengths, strict=True)
            if count > TOKEN_LIMIT
        ]
        return {
            "chunks": len(chunks),
            "token_limit": TOKEN_LIMIT,
            "min_tokens": min(lengths, default=0),
            "max_tokens": max(lengths, default=0),
            "truncated_count": len(truncated),
            "truncated": truncated,
        }
