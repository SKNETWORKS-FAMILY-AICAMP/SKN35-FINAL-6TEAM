"""Check the docyx catalog, compatibility evidence, and quote totals in MySQL."""

import json
import re
from collections import Counter
from contextlib import closing

from app.db.connection import get_connection
from app.db.schema import SCHEMA_PATH
from app.domains.hardware.ingestion.common import (
    COMPATIBILITY_REVIEWS,
    compatibility_source_urls,
    read_json,
    read_specs,
    run_cli,
)
from app.domains.hardware.ingestion.docyx import REVISION


def inspect_database(connection):
    errors, counts = [], {}
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    definitions = re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\) ENGINE", sql, re.S)
    with connection.cursor(dictionary=True) as cursor:
        cursor.execute(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"
        )
        existing = {r["TABLE_NAME"] for r in cursor.fetchall()}
        expected_tables = {name for name, _ in definitions}
        if existing != expected_tables:
            errors.append(
                {
                    "issue": "SCHEMA_TABLES_MISMATCH",
                    "missing": sorted(expected_tables - existing),
                    "extra": sorted(existing - expected_tables),
                }
            )
        for table, definition in definitions:
            expected = re.findall(
                r"^    (\w+) (?:BIGINT|VARCHAR|CHAR|INT|TEXT|JSON|DECIMAL|DATETIME)\b",
                definition,
                re.M,
            )
            cursor.execute(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s ORDER BY ORDINAL_POSITION",
                (table,),
            )
            if [r["COLUMN_NAME"] for r in cursor.fetchall()] != expected:
                errors.append({"table": table, "issue": "SCHEMA_COLUMNS_MISMATCH"})
        if errors:
            return {"passed": False, "errors": errors}

        for table, _ in definitions:
            cursor.execute(f"SELECT COUNT(*) AS n FROM {table}")
            counts[table] = cursor.fetchone()["n"]
        cursor.execute(
            "SELECT part_id,category,model_number,specs,current_price,currency,price_checked_at FROM parts"
        )
        parts = cursor.fetchall()
        keys = Counter()
        for part in parts:
            provenance = read_specs(part["specs"]).get("_provenance", {})
            keys[provenance.get("source_key")] += 1
            if (
                provenance.get("source") != "docyx"
                or provenance.get("revision") != REVISION
                or provenance.get("price_status") != "test"
                or not part["current_price"]
                or part["currency"] != "KRW"
                or not part["price_checked_at"]
                or not all(
                    provenance.get(k)
                    for k in ("price_usd", "krw_per_usd", "fx_date", "fx_source_url")
                )
            ):
                errors.append({"issue": "INVALID_DEMO_PRICE", "part_id": part["part_id"]})
        if None in keys or any(n > 1 for n in keys.values()):
            errors.append({"issue": "MISSING_OR_DUPLICATE_SOURCE_KEYS"})
        by_id = {row["part_id"]: row for row in parts}

        cursor.execute(
            "SELECT part_a_id,part_b_id,check_type,conditions,min_bios_version FROM part_compatibility"
        )
        evidence = cursor.fetchall()
        record_keys = Counter()
        for row in evidence:
            conditions = read_specs(row["conditions"])
            record_keys[conditions.get("_record_key")] += 1
            if row["check_type"] == "MEMORY_QVL" and (
                by_id[row["part_b_id"]]["model_number"] != conditions.get("ram_model_number")
                or row["min_bios_version"] is not None
            ):
                errors.append({"issue": "INVALID_QVL", "key": conditions.get("_record_key")})
        if None in record_keys or any(n > 1 for n in record_keys.values()):
            errors.append({"issue": "MISSING_OR_DUPLICATE_COMPATIBILITY_KEYS"})
        if unknown := record_keys.keys() - compatibility_source_urls().keys() - {None}:
            errors.append(
                {
                    "issue": "UNRECOGNIZED_COMPATIBILITY_SOURCE_KEYS",
                    "keys": sorted(unknown, key=str),
                }
            )
        expected_evidence = {
            row["record_key"]
            for row in read_json(COMPATIBILITY_REVIEWS)["records"]
            if {row["part_a_key"], row["part_b_key"]} <= keys.keys()
        }
        if missing := expected_evidence - record_keys.keys():
            errors.append({"issue": "MISSING_REVIEWED_EVIDENCE", "keys": sorted(missing)})

        cursor.execute(
            "SELECT q.quote_id,q.total_amount,COUNT(i.quote_item_id) AS item_count,"
            "SUM(i.unit_price*i.quantity) AS component_total "
            "FROM quotes q LEFT JOIN quote_items i ON q.quote_id=i.quote_id "
            "GROUP BY q.quote_id,q.total_amount"
        )
        for row in cursor.fetchall():
            if row["item_count"] == 0:
                errors.append({"issue": "PAID_QUOTE_INCOMPLETE", "id": row["quote_id"]})
            elif row["total_amount"] != row["component_total"]:
                errors.append({"issue": "QUOTE_TOTAL_MISMATCH", "id": row["quote_id"]})

    return {
        "passed": not errors,
        "table_counts": counts,
        "errors": errors,
        "warnings": [],
        "parts_by_category": dict(Counter(p["category"] for p in parts)),
        "evidence_by_type": dict(Counter(row["check_type"] for row in evidence)),
    }


def main():
    with closing(get_connection()) as connection:
        result = inspect_database(connection)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(run_cli(main))
