"""Validate the evidence releases, inspect model inputs, and search the local index.

From backend/:
    python -m app.rag validate
    python -m app.rag validate --mysql
    python -m app.rag prepare-dpr --batch-size 4
    python -m app.rag search "MAG B550 TOMAHAWK" --brand MSI
    python -m app.rag tokens
    python -m app.rag index
    python -m app.rag search "M425R1GB4BB0-CWM 검증 목록 보여줘" --mode auto
    python -m app.rag search "램을 바꾼 뒤 부팅이 안 돼요" --mode hybrid
"""

import argparse
import json
import sys
from contextlib import closing
from pathlib import Path

from app.rag.loader import load_corpus
from app.rag.mappings import load_reviewed_links, verify_mysql_links
from app.rag.points import build_points
from app.rag.search import search

DEFAULT_INDEX_PATH = Path(__file__).resolve().parents[2] / ".cache" / "qdrant"


def _verify_mysql(reviewed):
    from mysql.connector import Error

    try:
        return verify_mysql_links(reviewed)
    except Error as exc:
        raise ValueError(
            f"MySQL 검증 실패 (오류 번호 {exc.errno}). 연결 설정을 확인하세요."
        ) from exc


def validate(mysql: bool) -> tuple[dict, int]:
    corpus = load_corpus()
    reviewed = load_reviewed_links(corpus)
    verified = _verify_mysql(reviewed) if mysql else None

    points = build_points(
        corpus, resolved_links=verified.confirmed if verified is not None else None
    )
    point_ids = {point.id for point in points}
    if len(point_ids) != len(points) or len(points) != len(corpus.chunks):
        raise ValueError("청크마다 고유한 Point ID가 필요합니다.")
    summary = {
        "chunks": len(corpus.chunks),
        "sources": len(corpus.sources),
        "cited_sources": len({chunk["source_key"] for chunk in corpus.chunks.values()}),
        "facts": len(corpus.facts),
        "crawl_records": len(corpus.crawls),
        "crawl_chunk_links": len(corpus.crawl_chunk_links),
        "unique_points": len(point_ids),
        "reviewed_candidates": {
            "chunks": sum(link.item_key in corpus.chunks for link in reviewed),
            "facts": sum(link.item_key in corpus.facts for link in reviewed),
            "part_references": sum(len(link.parts) for link in reviewed),
            "distinct_parts": len(
                {part["part_source_key"] for link in reviewed for part in link.parts}
            ),
            "compatibility_references": sum(len(link.compatibilities) for link in reviewed),
        },
        "mysql": {"status": "not_requested"},
    }
    if verified is not None:
        summary["mysql"] = {
            "status": "unresolved" if verified.unresolved else "verified",
            "confirmed": verified.confirmed,
            "unresolved": verified.unresolved,
        }
    return summary, int(verified is not None and bool(verified.unresolved))


def _embedder(args, *, offline: bool = False):
    from app.rag.embeddings import LocalEmbedder

    return LocalEmbedder(
        cache_dir=args.model_cache, local_files_only=offline or args.local_files_only
    )


def _index(args) -> tuple[dict, int]:
    from qdrant_client import QdrantClient

    from app.rag.qdrant_store import DEFAULT_COLLECTION, QdrantStore

    corpus = load_corpus()
    reviewed = load_reviewed_links(corpus)
    verified = _verify_mysql(reviewed) if args.mysql else None
    if verified is not None and verified.unresolved:
        return {"status": "unresolved", "unresolved": verified.unresolved}, 1
    points = build_points(
        corpus, resolved_links=verified.confirmed if verified is not None else None
    )
    encoder = _embedder(args)
    vectors = encoder.embed_documents(point.payload["chunk_text"] for point in points)
    collection = args.collection or DEFAULT_COLLECTION
    path = args.path or DEFAULT_INDEX_PATH
    with closing(QdrantClient(path=str(path))) as client:
        count = QdrantStore(client, collection).upsert(points, vectors)
    return {
        "collection": collection,
        "path": str(path.resolve()),
        "upserted": len(points),
        "collection_points": count,
        "mysql": "verified" if args.mysql else "not_requested",
    }, 0


def _lookup(args) -> dict:
    filters = {
        key: getattr(args, key)
        for key in ("brand", "category", "topic", "verification_status")
        if getattr(args, key) is not None
    }
    mode = args.mode or ("auto" if args.path or args.collection else "keyword")
    if mode == "keyword":
        if args.path or args.collection:
            raise ValueError(
                "--path 및 --collection은 auto, hybrid 또는 vector 모드에서 사용하세요."
            )
        hits = search(build_points(load_corpus()), args.query, filters=filters, limit=args.limit)
        return {"mode": mode, "results": [hit.point.payload for hit in hits]}

    from qdrant_client import QdrantClient

    from app.rag.qdrant_store import DEFAULT_COLLECTION, QdrantStore

    path = args.path or DEFAULT_INDEX_PATH
    collection = args.collection or DEFAULT_COLLECTION
    if not path.is_dir():
        raise ValueError(f"Qdrant 색인이 없습니다. 먼저 index를 실행하세요: {path}")
    with closing(QdrantClient(path=str(path))) as client:
        if not client.collection_exists(collection):
            raise ValueError(f"Qdrant 컬렉션이 없습니다. 먼저 index를 실행하세요: {collection}")
        store = QdrantStore(client, collection)
        if mode == "auto":
            from app.rag.routing import routed_search

            return routed_search(
                store,
                args.query,
                lambda text: _embedder(args, offline=True).embed_query(text),
                filters=filters,
                limit=args.limit,
            )
        query_vector = _embedder(args).embed_query(args.query)
        hits = store.search(args.query, query_vector, mode=mode, filters=filters, limit=args.limit)
        return {"mode": mode, "results": [dict(hit.payload, score=hit.score) for hit in hits]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("validate", help="배포본, 검토 연결 및 Point 변환 검증")
    check.add_argument(
        "--mysql", action="store_true", help="설정된 MySQL에서 검토 연결을 읽기 전용으로 대조"
    )
    prepare = commands.add_parser("prepare-dpr", help="DPR 학습 배치와 BM25 오답 검토 후보 생성")
    prepare.add_argument("--train", type=Path, help="질문과 정답 문단 키를 담은 학습용 JSONL")
    prepare.add_argument("--batch-size", type=int, default=4)
    tokens = commands.add_parser("tokens", help="모델 토크나이저로 청크 입력 길이 및 잘림 확인")
    index = commands.add_parser("index", help="청크를 임베딩해 로컬 Qdrant에 저장")
    index.add_argument(
        "--mysql", action="store_true", help="부품 연결을 실제 DB에서 확인해 함께 색인"
    )
    lookup = commands.add_parser("search", help="키워드, 벡터 또는 하이브리드 검색")
    for command in (tokens, index, lookup):
        command.add_argument("--model-cache", type=Path, help="고정 모델 리비전의 캐시 디렉터리")
        command.add_argument(
            "--local-files-only", action="store_true", help="모델 다운로드 없이 캐시만 사용"
        )
    for command in (index, lookup):
        command.add_argument(
            "--path", type=Path, help=f"로컬 Qdrant 저장 위치 (기본 {DEFAULT_INDEX_PATH})"
        )
        command.add_argument("--collection", help="로컬 Qdrant 컬렉션 이름")
    lookup.add_argument("query")
    lookup.add_argument(
        "--mode",
        choices=("keyword", "vector", "hybrid", "auto"),
        help="auto는 품번 조회에 정확 일치, 상담에 하이브리드를 사용합니다. "
        "경로·컬렉션 지정 시 기본 auto, 생략 시 오프라인 keyword입니다.",
    )
    lookup.add_argument("--brand")
    lookup.add_argument("--category")
    lookup.add_argument("--topic")
    lookup.add_argument("--verification-status", "--status", help="원자료의 검증 상태")
    lookup.add_argument("--limit", type=int, default=5)
    args = parser.parse_args(argv)
    try:
        if args.command == "validate":
            result, exit_code = validate(args.mysql)
        elif args.command == "prepare-dpr":
            from app.rag.evaluate import QUESTIONS
            from app.rag.training import TRAINING_PILOT, prepare_training

            result = prepare_training(
                load_corpus(), args.train or TRAINING_PILOT, QUESTIONS, args.batch_size
            )
            exit_code = 0
        elif args.command == "tokens":
            result, exit_code = _embedder(args).token_report(load_corpus().chunks), 0
        elif args.command == "index":
            result, exit_code = _index(args)
        else:
            result = _lookup(args)
            exit_code = 0
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"RAG 작업 실패: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
