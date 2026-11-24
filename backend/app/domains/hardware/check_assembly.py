"""Check a stored quote or a proposed list of catalog parts."""

import argparse
import json
from collections import Counter
from contextlib import closing
from dataclasses import asdict

from app.db.catalog import list_compatibility, list_parts
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
    if quote_id is not None:
        with connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT quote_id FROM quotes WHERE quote_id=%s", (quote_id,))
            if cursor.fetchone() is None:
                raise ValueError(f"견적 {quote_id}을 찾을 수 없습니다.")
            cursor.execute(
                "SELECT p.part_id,p.category,p.name,p.specs,p.power_draw_w,i.quantity "
                "FROM quote_items AS i JOIN parts AS p ON p.part_id=i.part_id "
                "WHERE i.quote_id=%s ORDER BY i.quote_item_id",
                (quote_id,),
            )
            rows = cursor.fetchall()
    else:
        rows = list_parts(connection, part_ids=selection)
        if missing := set(selection) - {row["part_id"] for row in rows}:
            raise ValueError(f"DB에 없는 부품 ID: {sorted(missing)}")
        for row in rows:
            row["quantity"] = selection[row["part_id"]]

    parts = [
        AssemblyPart(
            part_id=row["part_id"],
            name=row["name"],
            category=row["category"],
            specs=read_specs(row["specs"]),
            quantity=row["quantity"],
            power_draw_w=row["power_draw_w"],
        )
        for row in rows
    ]
    board_ids = {part.part_id for part in parts if part.category == "motherboard"}
    target_ids = {part.part_id for part in parts if part.category in ("cpu", "ram")}
    evidence = []
    if board_ids and target_ids:
        evidence = [
            row
            for row in list_compatibility(connection, part_ids=sorted(board_ids | target_ids))
            if row["part_a_id"] in board_ids
            and row["part_b_id"] in target_ids
            and row["check_type"] in ("CPU_SUPPORT", "MEMORY_QVL")
        ]

    checks = validate_assembly(
        parts,
        evidence,
        bios_version=bios_version,
        front_radiator_mm=front_radiator_mm,
        other_load_w=other_load_w,
    )
    sources = {row["compatibility_id"]: row["source_url"] for row in evidence if row["source_url"]}
    return {
        "quote_id": quote_id,
        "parts": [
            {"part_id": p.part_id, "name": p.name, "category": p.category, "quantity": p.quantity}
            for p in parts
        ],
        "checks": [
            {
                **asdict(check),
                "source_urls": sorted(
                    {sources[key] for key in check.compatibility_ids if key in sources}
                ),
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
        help="기타 부품의 최소 설계 부하(W). 선택 부품 합계가 더 크면 합계를 사용합니다.",
    )
    args = parser.parse_args()
    selection = Counter()
    for part_id, quantity in args.part or ():
        selection[part_id] += quantity
    with closing(get_connection()) as connection:
        # TiDB provides a consistent snapshot but can reject the MySQL READ ONLY option.
        is_tidb = "tidb" in (connection.server_info or "").casefold()
        connection.start_transaction(consistent_snapshot=True, readonly=None if is_tidb else True)
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
