"""Read a UTF-8 JSON request from a file or stdin and print the pre-payment outcome.

From backend/: python -m app.domains.hardware.quote_graph request.json
Use "-" (the default) for stdin. Monetary amounts are exact decimal strings in JSON.
"""

import argparse
import json
import sys
from contextlib import nullcontext
from datetime import date
from decimal import Decimal
from pathlib import Path

from app.domains.hardware.quote_graph import build_graph
from app.domains.hardware.quote_graph.adapters import LocalServices, ServiceUnavailable
from app.rag.qdrant_store import DEFAULT_COLLECTION


def _encode(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, date):
        return value.isoformat()
    raise TypeError(f"Unsupported JSON value: {type(value).__name__}")


def main(argv=None, *, services=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request", nargs="?", default="-", help="요청 JSON 파일 또는 표준입력(-)")
    parser.add_argument("--path", type=Path, help="로컬 Qdrant 색인 경로")
    parser.add_argument("--collection", default=DEFAULT_COLLECTION)
    parser.add_argument("--model-cache", type=Path, help="오프라인 FastEmbed 캐시 경로")
    args = parser.parse_args(argv)
    try:
        raw = (
            getattr(sys.stdin, "buffer", sys.stdin).read()
            if args.request == "-"
            else Path(args.request).read_text(encoding="utf-8-sig")
        )
        request = json.loads(raw, parse_float=Decimal)
    except (ValueError, OSError) as exc:
        print(f"요청 JSON을 읽을 수 없습니다: {exc}", file=sys.stderr)
        return 2
    resources = (
        nullcontext(services)
        if services is not None
        else LocalServices(path=args.path, collection=args.collection, model_cache=args.model_cache)
    )
    try:
        with resources as active:
            state = build_graph(active).invoke({"request": request})
    except ServiceUnavailable as exc:
        print(f"견적 처리를 마칠 수 없습니다: {exc}", file=sys.stderr)
        return 1
    fields = (
        "status",
        "reason",
        "retry_count",
        "selection",
        "attempted_selections",
        "blocking_failures",
        "conditions",
        "citations",
        "quote_draft",
    )
    print(
        json.dumps(
            {field: state[field] for field in fields}, ensure_ascii=False, indent=2, default=_encode
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
