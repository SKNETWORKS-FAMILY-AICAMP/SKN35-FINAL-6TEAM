"""Check a local MySQL quote or a proposed list of catalog parts."""

import argparse
import json
from collections import Counter
from contextlib import closing
from dataclasses import asdict

from app.db.connection import get_connection
from app.domains.hardware.assembly import DEFAULT_OTHER_LOAD_W, AssemblyPart, validate_assembly
from app.domains.hardware.ingestion.common import read_specs, run_cli


def check_catalog_assembly(
    connection,
    *,
    quote_id=None,
    selection=None,
    bios_version=None,
    front_radiator_mm=None,
    other_load_w=DEFAULT_OTHER_LOAD_W,
):
    """Resolve the selection in one database snapshot controlled by the caller."""
    if (quote_id is None) == (not selection):
        raise ValueError("견적 ID나 부품 목록 중 하나를 지정하세요.")
    quote_version = None
    with connection.cursor(dictionary=True) as cursor:
        if quote_id is not None:
            cursor.execute("SELECT version FROM quotes WHERE quote_id=%s", (quote_id,))
            quote = cursor.fetchone()
            if not quote:
                raise ValueError(f"견적 {quote_id}을 찾을 수 없습니다.")
            quote_version = quote["version"]
            cursor.execute(
                "SELECT p.part_id,p.category,p.name,p.specs,i.quantity "
                "FROM quote_items AS i JOIN parts AS p ON p.part_id=i.part_id "
                "WHERE i.quote_id=%s ORDER BY i.quote_item_id",
                (quote_id,),
            )
            rows = cursor.fetchall()
        else:
            ids = tuple(selection)
            placeholders = ",".join(["%s"] * len(ids))
            cursor.execute(
                f"SELECT part_id,category,name,specs FROM parts WHERE part_id IN ({placeholders}) "
                "ORDER BY part_id",
                ids,
            )
            rows = cursor.fetchall()
            if missing := set(ids) - {row["part_id"] for row in rows}:
                raise ValueError(f"DB에 없는 부품 ID: {sorted(missing)}")
            for row in rows:
                row["quantity"] = selection[row["part_id"]]
        parts = [AssemblyPart(**{**row, "specs": read_specs(row["specs"])}) for row in rows]

        boards = tuple(sorted({part.part_id for part in parts if part.category == "motherboard"}))
        targets = tuple(sorted({part.part_id for part in parts if part.category in ("cpu", "ram")}))
        evidence = []
        if boards and targets:
            board_params = ",".join(["%s"] * len(boards))
            target_params = ",".join(["%s"] * len(targets))
            cursor.execute(
                "SELECT compatibility_id,part_a_id,part_b_id,check_type,support_status,"
                "bios_scope,min_bios_version,conditions,source_url FROM part_compatibility "
                f"WHERE part_a_id IN ({board_params}) AND part_b_id IN ({target_params}) "
                "AND check_type IN ('CPU_SUPPORT','MEMORY_QVL') ORDER BY compatibility_id",
                (*boards, *targets),
            )
            evidence = cursor.fetchall()
            for row in evidence:
                row["conditions"] = read_specs(row["conditions"])

    checks = validate_assembly(
        parts,
        evidence,
        bios_version=bios_version,
        front_radiator_mm=front_radiator_mm,
        other_load_w=other_load_w,
    )
    sources = {row["compatibility_id"]: row["source_url"] for row in evidence}
    return {
        "quote_id": quote_id,
        "quote_version": quote_version,
        "parts": [
            {"part_id": p.part_id, "name": p.name, "category": p.category, "quantity": p.quantity}
            for p in parts
        ],
        "checks": [
            {
                **asdict(check),
                "source_urls": sorted({sources[key] for key in check.compatibility_ids}),
            }
            for check in checks
        ],
    }


def _part_arg(value):
    try:
        raw_id, separator, raw_quantity = value.partition(":")
        part_id, quantity = int(raw_id), int(raw_quantity) if separator else 1
        if part_id > 0 and quantity > 0:
            return part_id, quantity
    except ValueError:
        pass
    raise argparse.ArgumentTypeError("부품은 양수 ID[:수량] 형식으로 입력하세요.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--quote-id", type=int, help="이미 저장된 견적 ID")
    choice.add_argument("--part", action="append", type=_part_arg, help="부품 ID[:수량], 반복 지정")
    parser.add_argument("--bios-version", help="확인한 메인보드 BIOS 버전")
    parser.add_argument("--front-radiator-mm", type=int, help="전면 라디에이터 규격(mm)")
    parser.add_argument(
        "--other-load-w",
        type=int,
        default=DEFAULT_OTHER_LOAD_W,
        help="기타 부품 소비전력 추정치(W)",
    )
    args = parser.parse_args()
    selection = Counter()
    for part_id, quantity in args.part or ():
        selection[part_id] += quantity
    with closing(get_connection()) as connection:
        connection.start_transaction(consistent_snapshot=True, readonly=True)
        result = check_catalog_assembly(
            connection,
            quote_id=args.quote_id,
            selection=selection,
            bios_version=args.bios_version,
            front_radiator_mm=args.front_radiator_mm,
            other_load_w=args.other_load_w,
        )
        connection.rollback()
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    raise SystemExit(run_cli(main))
