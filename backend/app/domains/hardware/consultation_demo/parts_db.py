"""Read a consultation shortlist and its published compatibility records from MySQL."""

from contextlib import closing
from dataclasses import dataclass
from datetime import UTC
from re import sub

import mysql.connector

from app.db.catalog import list_compatibility
from app.db.connection import get_connection
from app.domains.hardware.ingestion.common import read_specs


class PartsCatalogError(RuntimeError):
    """The configured shop's catalog could not be read."""


@dataclass
class CatalogSnapshot:
    parts: list[dict]
    compatibility: list[dict]


# The parts database is a shared reference catalog. Only the first demo shop is
# assigned this public import. Customer, order and other shop data are never queried.
SHOP_COMPANY_ID = 1
SHOP_SOURCE = "docyx"

# Retain models with published CPU support, QVL or mechanical specifications.
# Only source keys are pinned. IDs, availability, pricing and evidence come from SQL.
REVIEWED_KEYS = (
    "amd-ryzen-5-7600",
    "amd-ryzen-5-8600g",
    "amd-ryzen-9-7900",
    "cpu-r5-9600x",
    "mb-asus-tuf-gaming-b850-plus-wifi",
    "mb-b650-tomahawk",
    "ram-gskill-f5-6000j3636f32gx2-fx5",
    "ram-kingston-ksm48e40bd8km-32hm",
    "gpu-msi-3060-ventus-2x-12g",
    "gpu-sapphire-pulse-rx9060xt-16gb",
    "gpu-gigabyte-5070-windforce-oc",
    "gpu-asus-tuf-rtx5080-oc",
    "cooler-thermalright-peerless-assassin-120-se",
    "case-nzxt-h7-flow-2024-black",
    "case-nzxt-h7-flow-2024-white",
    "case-nzxt-h5-flow-2024-black",
    "case-nzxt-h5-flow-2024-white",
)

# Supplement the reviewed models with the two lowest stored prices per capacity
# or wattage group. Rank IDs first so that only the shortlist's full specs travel.
_PARTS_QUERY = """
    WITH shop AS (SELECT %s AS company_id, %s AS source),
    candidates AS (
        SELECT p.part_id, p.category, p.current_price,
            p.specs->>'$._provenance.source_key' AS source_key,
            CASE
                WHEN p.category='storage' AND p.specs->>'$.type'='SSD'
                    AND p.specs->>'$.capacity_gb' IN ('500','512','1000','1024','2000')
                    THEN p.specs->>'$.capacity_gb'
                WHEN p.category='psu' AND p.specs->>'$.form_factor'='ATX'
                    AND p.specs->>'$.wattage_w' IN ('550','650','750','850')
                    THEN p.specs->>'$.wattage_w'
                WHEN p.category='ram' AND p.specs->>'$.ram_type'='DDR5'
                    AND p.specs->>'$.capacity_gb' IN ('8','16','32','64')
                    THEN p.specs->>'$.capacity_gb'
                WHEN p.category='gpu' AND p.specs->>'$.vram_gb' IN ('4','6','8','12','16')
                    AND p.specs->>'$.length_mm' IS NOT NULL
                    THEN p.specs->>'$.vram_gb'
            END AS spec_group
        FROM parts p JOIN shop ON p.specs->>'$._provenance.source'=shop.source
        WHERE shop.company_id=%s AND p.currency='KRW' AND p.current_price>0
            AND p.current_price=FLOOR(p.current_price) AND p.price_checked_at IS NOT NULL
    ), ranked AS (
        SELECT part_id, source_key, spec_group,
            ROW_NUMBER() OVER (
                PARTITION BY category, spec_group ORDER BY current_price, part_id
            ) AS price_position
        FROM candidates
    )
    SELECT p.part_id, p.category, p.brand, p.name, p.model_number, p.specs,
           p.current_price, p.currency, p.price_checked_at, p.power_draw_w
    FROM parts p JOIN ranked r ON p.part_id=r.part_id
    WHERE r.source_key IN ({keys}) OR (r.spec_group IS NOT NULL AND r.price_position<=2)
    ORDER BY p.category, p.current_price, p.part_id
""".format(keys=", ".join(["%s"] * len(REVIEWED_KEYS)))


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
        "power_draw_w": float(watts) if watts is not None else None,
        "price": int(row["current_price"]),
        "currency": row["currency"],
        "price_checked_at": row["price_checked_at"].replace(tzinfo=UTC).isoformat(),
        "price_basis": source.get("price_basis"),
        "price_status": source.get("price_status", "unconfirmed"),
        "data_status": source.get("data_status", "unverified"),
        "source_key": source["source_key"],
    }


def load_catalog(company_id: int = SHOP_COMPANY_ID) -> CatalogSnapshot:
    if type(company_id) is not int or company_id != SHOP_COMPANY_ID:
        return CatalogSnapshot([], [])
    try:
        with closing(get_connection()) as connection:
            with connection.cursor(dictionary=True) as cursor:
                cursor.execute(
                    _PARTS_QUERY, (SHOP_COMPANY_ID, SHOP_SOURCE, company_id, *REVIEWED_KEYS)
                )
                parts = [_part(row, company_id) for row in cursor.fetchall()]
            # Both ends of every returned evidence record must belong to this shop's shortlist.
            evidence = list_compatibility(connection, part_ids=[part["id"] for part in parts])
    except (mysql.connector.Error, ValueError, KeyError, TypeError, OSError) as error:
        raise PartsCatalogError(
            "부품 DB를 읽을 수 없습니다. DB 연결과 카탈로그 설정을 확인해 주세요."
        ) from error
    return CatalogSnapshot(parts, evidence)
