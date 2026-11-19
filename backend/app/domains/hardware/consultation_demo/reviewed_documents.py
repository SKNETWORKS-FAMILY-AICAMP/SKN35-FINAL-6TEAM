"""Manufacturer passages shared by the consultation search index and fit checks."""

import json
from functools import cache
from uuid import uuid5

from app.core.config import REPO_ROOT
from app.rag.points import POINT_NAMESPACE, Point, build_payload

_FOLDER = REPO_ROOT / "data" / "rag" / "consultation"
_FILES = ("assembly_power.json", "assembly_cooling.json", "assembly_memory.json")
_FIELDS = ("chunk_key", "title", "url", "text", "model", "publisher", "topic")
ORIGIN = "제조사 규격·지원 문서"


@cache
def _documents():
    rows = {}
    for filename in _FILES:
        for row in json.loads((_FOLDER / filename).read_text(encoding="utf-8-sig")):
            if not all(isinstance(row.get(k), str) and row[k].strip() for k in _FIELDS):
                raise ValueError(f"{filename}: 제조사 문단의 식별 정보와 출처를 확인해 주세요.")
            key = row["chunk_key"]
            if key in rows or not row["url"].startswith("https://"):
                raise ValueError(f"{filename}: 중복된 문단 키 또는 잘못된 출처 URL: {key}")
            rows[key] = row
    return rows


def document(key: str) -> dict:
    row = _documents()[key]
    return {k: row[k] for k in ("chunk_key", "title", "url", "text")} | {"origin": ORIGIN}


def manufacturer_points() -> list[Point]:
    points = []
    for key, row in _documents().items():
        source = {
            "source_key": row["url"],
            "정규 URL": row["url"],
            "문서명": row["title"],
            "발행처": row["publisher"],
        }
        chunk = {
            "chunk_key": key,
            "chunk_text": row["text"],
            "source_key": row["url"],
            "검증 상태": "verified",
            "주제": row["topic"],
            "대상": row["model"],
            "document_type": "consultation_manufacturer_spec",
            "metadata": {"model": row["model"], "vendor": row["publisher"]},
        }
        points.append(Point(uuid5(POINT_NAMESPACE, key), build_payload(chunk, source), None))
    return points
