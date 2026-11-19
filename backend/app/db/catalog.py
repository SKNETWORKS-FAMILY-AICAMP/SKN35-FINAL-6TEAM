"""Read the shared catalog and its existing compatibility evidence from MySQL."""

import json
from collections.abc import Iterable
from typing import Any

from mysql.connector.abstracts import MySQLConnectionAbstract

from app.domains.hardware.ingestion.common import compatibility_sources


def list_parts(
    connection: MySQLConnectionAbstract,
    *,
    category: str | None = None,
    part_ids: Iterable[int] | None = None,
) -> list[dict[str, Any]]:
    """Return catalog rows, optionally narrowed by category and part IDs."""
    filters = []
    params: list[int | str] = []
    if category is not None:
        filters.append("category=%s")
        params.append(category)
    if part_ids is not None:
        ids = tuple(dict.fromkeys(part_ids))
        if not ids:
            return []
        placeholders = ",".join(["%s"] * len(ids))
        filters.append(f"part_id IN ({placeholders})")
        params.extend(ids)

    query = (
        "SELECT part_id,category,brand,name,model_number,specs,"
        "current_price,currency,price_checked_at,power_draw_w,image_url FROM parts"
    )
    if filters:
        query += " WHERE " + " AND ".join(filters)
    with connection.cursor(dictionary=True) as cursor:
        cursor.execute(query + " ORDER BY part_id", tuple(params))
        rows = cursor.fetchall()
    for row in rows:
        if isinstance(row["specs"], (str, bytes)):
            row["specs"] = json.loads(row["specs"])
    return rows


def list_compatibility(
    connection: MySQLConnectionAbstract, *, part_ids: Iterable[int]
) -> list[dict[str, Any]]:
    """Return evidence for the selected parts with metadata from the source file."""
    ids = tuple(dict.fromkeys(part_ids))
    if len(ids) < 2:
        return []
    placeholders = ",".join(["%s"] * len(ids))
    with connection.cursor(dictionary=True) as cursor:
        cursor.execute(
            "SELECT compatibility_id,part_a_id,part_b_id,check_type,support_status,bios_scope,"
            "min_bios_version,conditions "
            "FROM part_compatibility "
            f"WHERE part_a_id IN ({placeholders}) AND part_b_id IN ({placeholders}) "
            "ORDER BY compatibility_id",
            (*ids, *ids),
        )
        rows = cursor.fetchall()
    if not rows:
        return []
    sources = compatibility_sources()
    for row in rows:
        conditions = row["conditions"]
        if isinstance(conditions, (str, bytes)):
            conditions = row["conditions"] = json.loads(conditions)
        key = conditions.get("_record_key") if isinstance(conditions, dict) else None
        source = sources.get(key, {}) if isinstance(key, str) else {}
        row["source_url"] = source.get("source_url")
        row["source_publisher"] = source.get("source_publisher")
    return rows
