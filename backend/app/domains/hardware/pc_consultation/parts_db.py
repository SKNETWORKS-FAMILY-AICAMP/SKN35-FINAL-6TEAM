"""Read a consultation shortlist and its published compatibility records from MySQL."""

from contextlib import closing
from dataclasses import dataclass
from datetime import UTC
from functools import cache
from re import sub

import mysql.connector

from app.db.catalog import list_compatibility
from app.db.connection import get_connection
from app.domains.hardware.ingestion.common import read_specs
from app.domains.hardware.ingestion.fit_specs import fit_updates, load_fit_reviews
from app.domains.hardware.power_planning import ESTIMATE_FIELD

from .catalog import CATEGORY_ORDER


class PartsCatalogError(RuntimeError):
    """The configured shop's catalog could not be read."""


@dataclass
class CatalogSnapshot:
    parts: list[dict]
    compatibility: list[dict]
    missing_color_count: int = 0
    platform_prices: dict | None = None


# This shared import is assigned to a single shop. Other shops have no access.
SHOP_COMPANY_ID = 1
SHOP_SOURCE = "docyx"
CANDIDATE_LIMIT = 64
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


@cache
def _fit_reviews():
    return load_fit_reviews()


def _part(row, company_id):
    specs = read_specs(row["specs"])
    source = specs["_provenance"]
    if review := _fit_reviews().get(source["source_key"]):
        try:
            updates = fit_updates(
                specs, row["category"], row["model_number"], review, include_file_sources=True
            )
        except ValueError:
            # Ambiguous identity or conflicting catalog values cannot supply missing facts.
            updates = {}
        specs = specs | {k: v for k, v in updates.items() if specs.get(k) is None}
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
        "sold_units": int(row.get("sold_units") or 0),
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


def _platform_query(columns, company_id, rows, category, minima):
    """Limit a new build to saleable CPU/board/kit paths recorded by this shop."""
    aliases = {"cpu": "cpu", "motherboard": "board", "ram": "kit"}
    query = f"""SELECT {columns}
          FROM part_compatibility c
          JOIN parts cpu ON cpu.part_id=c.part_b_id AND cpu.category='cpu'
          JOIN parts board ON board.part_id=c.part_a_id AND board.category='motherboard'
          JOIN part_compatibility m ON m.part_a_id=board.part_id
          JOIN parts kit ON kit.part_id=m.part_b_id AND kit.category='ram'
          JOIN (SELECT %s AS company_id, %s AS source) shop ON shop.company_id=%s
         WHERE c.check_type='CPU_SUPPORT' AND c.support_status='SUPPORTED'
           AND COALESCE(c.bios_scope,'')<>'MIN_VERSION'
           AND COALESCE(c.conditions->>'$.known_supported_bios','') IN ('','null')
           AND COALESCE(c.conditions->>'$.support_evidence','')<>'official_bundle'
           AND m.check_type='MEMORY_QVL' AND m.support_status='CONDITIONAL'
           AND m.conditions->>'$.kits'='1'
           AND m.conditions->>'$.cpu_family' IN (cpu.specs->>'$.cpu_family',cpu.specs->>'$.cpu_series')
    """
    selected = {r["category"]: r["part_id"] for r in rows.values()}
    params = [SHOP_COMPANY_ID, SHOP_SOURCE, company_id]
    for role, alias in aliases.items():
        query += (
            f" AND {alias}.specs->>'$._provenance.source'=shop.source"
            f" AND {alias}.current_price>0 AND {alias}.currency='KRW'"
            f" AND {alias}.price_checked_at IS NOT NULL"
        )
        if role != category and role in selected:
            query += f" AND {alias}.part_id=%s"
            params.append(selected[role])
    for role, field in (("cpu", "cores"), ("ram", "capacity_gb")):
        if minima.get(role):
            column = f"{aliases[role]}.specs->>'$.{field}'"
            query += f" AND ({column} IS NULL OR CAST({column} AS DECIMAL(12,2))>=%s)"
            params.append(minima[role])
    return query, params


def load_catalog(
    company_id: int,
    *,
    part_ids=(),
    category=None,
    query="",
    budget=None,
    color="",
    limit=CANDIDATE_LIMIT,
    include_market=False,
    survey=None,
    all_candidates=False,
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
    platform_prices = None
    minima = (survey or {}).get("_design", {}).get("minimum_specs", {})
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
                    if (
                        all_candidates
                        and survey
                        and survey["mode"] == "new"
                        and category in {"cpu", "motherboard", "ram"}
                    ):
                        alias = {"cpu": "cpu", "motherboard": "board", "ram": "kit"}[category]
                        clause, platform_params = _platform_query(
                            f"{alias}.part_id", company_id, rows, category, minima
                        )
                        where.append("p.part_id IN (" + clause + ")")
                        params.extend(platform_params)
                    if include_market or (category == "cooler" and not all_candidates):
                        where.append("COALESCE(p.specs->>'$.cooling_type','') <> 'case_fan'")
                    if query:
                        # The name, model number and JSON key have different MySQL collations.
                        where.append(
                            "LOCATE(LOWER(%s), LOWER(CONCAT_WS(' ', p.brand, p.name, "
                            "p.model_number, p.specs->>'$.chipset', p.specs->>'$._provenance.source_key')) "
                            "COLLATE utf8mb4_bin)>0"
                        )
                        params.append(query)
                    if budget is not None:
                        where.append("p.current_price<=%s")
                        params.append(budget)
                        for clause, required in _platform_filters(category, rows):
                            where.append(clause)
                            params.append(required)
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
                    elif all_candidates:
                        # Filters that require the assembled parts run in Python. Applying a
                        # price/evidence LIMIT first could discard every compatible option.
                        if survey and survey["mode"] == "new":
                            statement = (
                                "SELECT eligible.*, COALESCE((SELECT SUM(i.quantity) FROM quote_items i "
                                "JOIN quotes q ON q.quote_id=i.quote_id AND q.paid_at IS NOT NULL "
                                "WHERE i.part_id=eligible.part_id),0) AS sold_units "
                                f"FROM ({statement}) eligible"
                            )
                    else:
                        priority = (
                            _evidence_order(category, rows, params) if budget is not None else ""
                        )
                        statement += " ORDER BY " + priority + "p.current_price, p.part_id LIMIT %s"
                        params.append(limit)
                    cursor.execute(statement, tuple(params))
                    rows.update((r["part_id"], r) for r in cursor.fetchall())
                if include_market and survey and survey["mode"] == "new":
                    sql, args = _platform_query(
                        "cpu.current_price cpu, board.current_price motherboard, kit.current_price ram",
                        company_id,
                        {},
                        None,
                        minima,
                    )
                    cursor.execute(
                        sql
                        + " ORDER BY cpu.current_price + board.current_price + kit.current_price,"
                        " cpu.part_id, board.part_id, kit.part_id LIMIT 1",
                        tuple(args),
                    )
                    platform_prices = {k: int(v) for k, v in (cursor.fetchone() or {}).items()}
            parts = [_part(row, company_id) for row in rows.values()]
            evidence = list_compatibility(connection, part_ids=list(rows)) if rows else []
    except (mysql.connector.Error, ValueError, KeyError, TypeError, OSError) as error:
        raise PartsCatalogError(
            "부품 DB를 읽을 수 없습니다. 연결과 카탈로그 설정을 확인해 주세요."
        ) from error
    return CatalogSnapshot(parts, evidence, missing_color_count, platform_prices)
