"""Read a consultation shortlist and its published compatibility records from MySQL."""

from contextlib import closing
from dataclasses import dataclass
from datetime import UTC
from re import sub

import mysql.connector

from app.db.catalog import list_compatibility
from app.db.connection import get_connection
from app.domains.hardware.ingestion.common import read_specs
from app.domains.hardware.power_planning import ESTIMATE_FIELD

from .catalog import CATEGORY_ORDER


class PartsCatalogError(RuntimeError):
    """The configured shop's catalog could not be read."""


@dataclass
class CatalogSnapshot:
    parts: list[dict]
    compatibility: list[dict]
    missing_color_count: int = 0


# This shared import is assigned to a single shop. Other shops have no access.
SHOP_COMPANY_ID = 1
SHOP_SOURCE = "docyx"
CANDIDATE_LIMIT = 64
_SPEC_KEYS = {"cores", "vram_gb", "capacity_gb"}
_SCOPED = """
    SELECT p.part_id, p.category, p.brand, p.name, p.model_number, p.specs,
           p.current_price, p.currency, p.price_checked_at, p.power_draw_w, p.image_url
    FROM parts p JOIN (SELECT %s AS company_id, %s AS source) shop
      ON p.specs->>'$._provenance.source'=shop.source
    WHERE shop.company_id=%s AND p.currency='KRW' AND p.current_price>0
      AND p.current_price=FLOOR(p.current_price) AND p.price_checked_at IS NOT NULL
"""


def _display_name(row, specs, source):
    name = source.get("raw_name") or sub(r" \[[0-9a-f]{12}\]$", "", row["name"])
    category = row["category"]
    if category in ("ram", "storage"):
        capacity = specs.get("capacity_gb")
        details = [f"{capacity} GB" if capacity else None]
        if category == "ram":
            details.append(row["model_number"])
        else:
            details.append(specs.get("interface"))
    elif category == "psu":
        watts = specs.get("wattage_w")
        details = [f"{watts} W" if watts else None]
    elif category == "case":
        details = [specs.get("color")]
    elif category == "gpu":
        details = [specs.get("chipset")]
    else:
        details = []
    for detail in details:
        if detail and detail.casefold() not in name.casefold():
            name += " · " + detail
    return name


def _part(row, company_id):
    specs = read_specs(row["specs"])
    source = specs["_provenance"]
    watts = row["power_draw_w"]
    return {
        "id": row["part_id"],
        "company_id": company_id,
        "category": row["category"],
        "brand": row["brand"],
        "name": _display_name(row, specs, source),
        "model_number": row["model_number"],
        "specs": {key: value for key, value in specs.items() if key != "_provenance"},
        "image_url": row.get("image_url"),
        "power_status": (specs.get(ESTIMATE_FIELD) or {}).get("status"),
        "power_draw_w": float(watts) if watts is not None else None,
        "price": int(row["current_price"]),
        "currency": row["currency"],
        "price_checked_at": row["price_checked_at"].replace(tzinfo=UTC).isoformat(),
        "price_basis": source.get("price_basis"),
        "price_status": source.get("price_status", "unconfirmed"),
        "data_status": source.get("data_status", "unverified"),
        "source_key": source["source_key"],
    }


def _evidence_order(category, rows, params):
    """Keep evidenced CPU/board/RAM pairs in the bounded page before sorting by price."""
    lookup = {
        "cpu": ("part_b_id", "CPU_SUPPORT", "motherboard", "part_a_id"),
        "motherboard": ("part_a_id", "CPU_SUPPORT", "cpu", "part_b_id"),
        "ram": ("part_b_id", "MEMORY_QVL", "motherboard", "part_a_id"),
    }.get(category)
    if not lookup:
        return ""
    end, check, other_role, other_end = lookup
    other = next((r for r in rows.values() if r["category"] == other_role), None)
    expression = (
        f"EXISTS (SELECT 1 FROM part_compatibility c JOIN parts peer ON peer.part_id=c.{other_end} "
        "AND peer.specs->>'$._provenance.source'=p.specs->>'$._provenance.source' "
        f"WHERE c.{end}=p.part_id AND c.check_type=%s AND c.support_status<>'UNSUPPORTED'"
    )
    params.append(check)
    if other is not None:
        expression += f" AND c.{other_end}=%s"
        params.append(other["part_id"])
    return expression + ") DESC, "


def _platform_filters(category, rows):
    """Remove known socket or memory conflicts before LIMIT; keep missing values for review."""
    requirements = {
        "motherboard": (("cpu", "socket"), ("ram", "ram_type"), ("ram", "ram_form_factor")),
        "cpu": (("motherboard", "socket"),),
        "ram": (("motherboard", "ram_type"), ("motherboard", "ram_form_factor")),
    }.get(category, ())
    selected = {row["category"]: read_specs(row["specs"]) for row in rows.values()}
    for other, field in requirements:
        value = selected.get(other, {}).get(field)
        if not isinstance(value, str) or not value.strip():
            continue
        column = f"p.specs->>'$.{field}'"
        yield (
            f"(COALESCE({column},'') IN ('','null') OR UPPER(REPLACE({column},' ',''))=%s)",
            value.upper().replace(" ", ""),
        )


def load_catalog(
    company_id: int,
    *,
    part_ids=(),
    category=None,
    query="",
    budget=None,
    floors=None,
    color="",
    limit=CANDIDATE_LIMIT,
    include_market=False,
) -> CatalogSnapshot:
    """Read explicitly selected parts and a bounded candidate page in one SQL snapshot."""
    if type(company_id) is not int or company_id != SHOP_COMPANY_ID:
        return CatalogSnapshot([], [])
    if category is not None and category not in CATEGORY_ORDER:
        raise ValueError("알 수 없는 부품 분류입니다.")
    if not 1 <= limit <= CANDIDATE_LIMIT:
        raise ValueError("잘못된 조회 개수입니다.")
    scoped = (SHOP_COMPANY_ID, SHOP_SOURCE, company_id)
    rows = {}
    missing_color_count = 0
    ids = tuple(dict.fromkeys(part_ids))
    try:
        with closing(get_connection()) as connection:
            with connection.cursor(dictionary=True) as cursor:
                if ids:
                    placeholders = ", ".join("%s" for _ in ids)
                    cursor.execute(_SCOPED + f" AND p.part_id IN ({placeholders})", (*scoped, *ids))
                    rows.update((r["part_id"], r) for r in cursor.fetchall())
                if category or include_market:
                    where = []
                    params = list(scoped)
                    if category:
                        where.append("p.category=%s")
                        params.append(category)
                    if query:
                        # The name, model number and JSON key have different MySQL collations.
                        where.append(
                            "LOCATE(LOWER(%s), LOWER(CONCAT_WS(' ', p.brand, p.name, "
                            "p.model_number, p.specs->>'$._provenance.source_key')) "
                            "COLLATE utf8mb4_bin)>0"
                        )
                        params.append(query)
                    if budget is not None:
                        where.append("p.current_price<=%s")
                        params.append(budget)
                        for clause, required in _platform_filters(category, rows):
                            where.append(clause)
                            params.append(required)
                    for kind, (spec, minimum) in (floors or {}).items():
                        if kind not in CATEGORY_ORDER or spec not in _SPEC_KEYS:
                            raise ValueError("알 수 없는 사양 조건입니다.")
                        where.append(
                            f"(p.category<>%s OR CAST(p.specs->>'$.{spec}' AS DECIMAL(14,2)) >= %s)"
                        )
                        params.extend((kind, minimum))
                    statement = _SCOPED + "".join(" AND " + clause for clause in where)
                    if color:
                        cursor.execute(
                            "SELECT COUNT(*) AS missing FROM ("
                            + statement
                            + " AND COALESCE(p.specs->>'$.color','') IN ('','null')) uncolored",
                            tuple(params),
                        )
                        missing_color_count = cursor.fetchone()["missing"]
                        statement += " AND LOCATE(LOWER(%s), LOWER(p.specs->>'$.color'))>0"
                        params.append(color)
                    if include_market:
                        # Transfer one actual priced SKU per category to calculate its budget share.
                        statement = (
                            "SELECT * FROM (SELECT priced.*, ROW_NUMBER() OVER "
                            "(PARTITION BY category ORDER BY current_price, part_id) AS pos "
                            f"FROM ({statement}) priced) ranked WHERE pos=1"
                        )
                    else:
                        priority = (
                            _evidence_order(category, rows, params) if budget is not None else ""
                        )
                        statement += " ORDER BY " + priority + "p.current_price, p.part_id LIMIT %s"
                        params.append(limit)
                    cursor.execute(statement, tuple(params))
                    rows.update((r["part_id"], r) for r in cursor.fetchall())
            parts = [_part(row, company_id) for row in rows.values()]
            evidence = list_compatibility(connection, part_ids=list(rows)) if rows else []
    except (mysql.connector.Error, ValueError, KeyError, TypeError, OSError) as error:
        raise PartsCatalogError(
            "부품 DB를 읽을 수 없습니다. 연결과 카탈로그 설정을 확인해 주세요."
        ) from error
    return CatalogSnapshot(parts, evidence, missing_color_count)
