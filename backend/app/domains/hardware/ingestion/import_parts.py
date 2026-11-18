"""Preview or import docyx parts, reviewed compatibility, and catalog metadata."""

import argparse
import json
from contextlib import closing
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from app.db.connection import connection_settings, get_connection
from app.db.schema import initialize_schema
from app.domains.hardware.ingestion.common import (
    CATEGORIES,
    DATA,
    TABLES,
    import_transaction,
    json_text,
    read_json,
    read_specs,
    run_cli,
    sql_time,
    utc_now,
)
from app.domains.hardware.ingestion.docyx import REVISION, prepare_parts, read_snapshot
from app.domains.hardware.ingestion.import_compatibility import (
    upsert_compatibility,
    validate_records,
)
from app.domains.hardware.ingestion.part_images import (
    IMAGE_PLACEHOLDER_URL,
    load_reviewed_images,
    match_images,
    read_image_rows,
    resolve_image_url,
)
from app.domains.hardware.ingestion.part_power import (
    load_gpu_estimates,
    load_power_reviews,
    resolve_catalog_power,
)
from app.domains.hardware.power_planning import ESTIMATE_FIELD

FX_URL = "https://www.federalreserve.gov/releases/h10/hist/dat00_ko.htm"
DROP_OFFERS = (
    Path(__file__).resolve().parents[3] / "db/sql/migrations/003_remove_legacy_part_offers.sql"
)


def upsert_parts(connection, parts, *, power_reviews=None, gpu_estimates=None):
    power_reviews = power_reviews or {}
    rows = []
    for part in parts:
        specs, power = resolve_catalog_power(part, power_reviews, gpu_estimates)
        rows.append(
            (
                part["category"],
                part["brand"],
                part["name"],
                part["model_number"],
                json_text(specs),
                part["verified_at"],
                part["current_price"],
                sql_time(part["price_checked_at"]),
                power,
                resolve_image_url(part.get("image_url"), None),
            )
        )
    estimate_path = f"$.{ESTIMATE_FIELD}"
    old_estimate = f"JSON_CONTAINS_PATH(parts.specs,'one','{estimate_path}')"
    new_estimate = f"JSON_CONTAINS_PATH(VALUES(specs),'one','{estimate_path}')"
    query = f"""
        INSERT INTO parts
            (category,brand,name,model_number,specs,verified_at,
             current_price,currency,price_checked_at,power_draw_w,image_url)
        VALUES (%s,%s,%s,%s,%s,%s,%s,'KRW',%s,%s,%s)
        ON DUPLICATE KEY UPDATE model_number=VALUES(model_number),
             specs=CASE
                 WHEN VALUES(power_draw_w) IS NULL AND {old_estimate}
                     THEN JSON_SET(VALUES(specs),'{estimate_path}',JSON_EXTRACT(parts.specs,'{estimate_path}'))
                 WHEN {new_estimate} AND parts.power_draw_w IS NOT NULL AND NOT {old_estimate}
                     THEN JSON_REMOVE(VALUES(specs),'{estimate_path}')
                 ELSE VALUES(specs) END,
             verified_at=VALUES(verified_at),
             current_price=VALUES(current_price),currency=VALUES(currency),
             price_checked_at=VALUES(price_checked_at),
             power_draw_w=CASE WHEN {new_estimate} AND NOT {old_estimate}
                 THEN COALESCE(parts.power_draw_w,VALUES(power_draw_w))
                 ELSE COALESCE(VALUES(power_draw_w),parts.power_draw_w) END,
             image_url=COALESCE(NULLIF(NULLIF(parts.image_url,''),'{IMAGE_PLACEHOLDER_URL}'),
                                VALUES(image_url))
    """
    with connection.cursor() as cursor:
        for start in range(0, len(rows), 400):
            cursor.executemany(query, rows[start : start + 400])


def refresh_reviewed_specs(connection, parts, power_reviews, gpu_estimates):
    """Apply reviewed fields in place without rewriting price or price provenance."""
    reviewed = 0
    with connection.cursor(dictionary=True) as cursor:
        for part in parts:
            incoming = part["specs"]["_provenance"]
            if "reviewed_fields" not in incoming:
                continue
            cursor.execute(
                "SELECT part_id,specs,power_draw_w FROM parts "
                "WHERE category=%s AND brand=%s AND name=%s FOR UPDATE",
                (part["category"], part["brand"], part["name"]),
            )
            existing = cursor.fetchone()
            if not existing:
                raise ValueError(f"{part['name']}: 검토 사양을 연결할 부품이 DB에 없습니다.")
            specs = read_specs(existing["specs"])
            saved = specs.get("_provenance", {})
            if any(saved.get(key) != incoming[key] for key in ("source", "revision", "raw_name")):
                raise ValueError(f"{part['name']}: DB 부품의 docyx 출처가 일치하지 않습니다.")
            for field in incoming["reviewed_fields"]:
                specs[field] = part["specs"][field]
            saved.update(
                {
                    key: incoming[key]
                    for key in ("source_key", "reviewed_fields", "reviewed_specs_url")
                }
            )
            specs, power = resolve_catalog_power(
                {**part, "specs": specs, "power_draw_w": existing["power_draw_w"]},
                power_reviews,
                gpu_estimates,
            )
            cursor.execute(
                "UPDATE parts SET model_number=%s,specs=%s,"
                "power_draw_w=COALESCE(%s,power_draw_w) WHERE part_id=%s",
                (
                    part["model_number"],
                    json_text(specs),
                    power,
                    existing["part_id"],
                ),
            )
            reviewed += 1
    return reviewed


def part_identity(part):
    return part["category"], part["brand"], part["name"]


def refresh_metadata(
    connection, image_rows, power_reviews, gpu_estimates, *, apply=False, fill_images=True
):
    """Refresh existing power data and any requested images in the caller's transaction."""
    with connection.cursor(dictionary=True) as cursor:
        query = "SELECT part_id,category,brand,name,model_number,specs,power_draw_w,image_url FROM parts"
        cursor.execute(query + (" ORDER BY part_id FOR UPDATE" if apply else ""))
        parts = cursor.fetchall()
        for part in parts:
            part["specs"] = read_specs(part["specs"])
        images = (
            match_images(parts, image_rows, reviewed_images=load_reviewed_images())
            if fill_images
            else {}
        )
        updates = []
        power_values_found = 0
        estimated_power = 0
        cpu_tdp_moved = 0
        image_placeholders = 0
        for part in parts:
            specs, power = resolve_catalog_power(part, power_reviews, gpu_estimates)
            power_values_found += power is not None
            estimated_power += ESTIMATE_FIELD in specs
            image = resolve_image_url(
                part["image_url"], images.get(part_identity(part)), fill_missing=fill_images
            )
            image_placeholders += image == IMAGE_PLACEHOLDER_URL
            spec_update = None
            if specs != part["specs"]:
                spec_update = json_text(specs)
                cpu_tdp_moved += "tdp_w" in part["specs"] and "tdp_w" not in specs
            if spec_update is not None or (power, image) != (
                part["power_draw_w"],
                part["image_url"],
            ):
                updates.append((part["part_id"], power, image, spec_update))

        if apply:
            for start in range(0, len(updates), 400):
                batch = updates[start : start + 400]
                cases = "WHEN %s THEN %s " * len(batch)
                ids = ",".join(["%s"] * len(batch))
                power_params = [
                    value for part_id, power, _, _ in batch for value in (part_id, power)
                ]
                image_params = [
                    value for part_id, _, image, _ in batch for value in (part_id, image)
                ]
                spec_params = [value for part_id, _, _, spec in batch for value in (part_id, spec)]
                cursor.execute(
                    f"UPDATE parts SET power_draw_w=CASE part_id {cases}END,"
                    f"image_url=CASE part_id {cases}END,"
                    f"specs=COALESCE(CASE part_id {cases}END,specs) WHERE part_id IN ({ids})",
                    (*power_params, *image_params, *spec_params, *(row[0] for row in batch)),
                )
    return {
        "parts_scanned": len(parts),
        "image_urls_matched": len(images),
        "image_placeholders": image_placeholders,
        "power_values_found": power_values_found,
        "estimated_power": estimated_power,
        "cpu_tdp_moved": cpu_tdp_moved,
        "parts_to_update": len(updates),
    }


def apply_catalog(
    parts, records, checked_at, *, power_reviews, gpu_estimates, reset=False, specs_only=False
):
    if specs_only and reset:
        raise ValueError("사양 갱신과 초기화를 동시에 실행할 수 없습니다.")
    if reset and connection_settings()["host"].lower() not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("--reset은 로컬 dev_database에서만 사용할 수 있습니다.")
    if not specs_only:
        initialize_schema()
    with closing(get_connection()) as connection, import_transaction(connection):
        with connection.cursor() as cursor:
            cursor.execute("SHOW FULL TABLES")
            tables = {name: kind for name, kind in cursor.fetchall()}
            legacy = "part_offers" in tables
            if legacy and not reset:
                raise ValueError(
                    "이전 판매 상품 테이블이 있습니다. 기존 DB 교체에는 --apply --reset을 사용하세요."
                )
            if reset:
                unexpected = set(tables) - set(TABLES) - {"part_offers"}
                if unexpected or any(kind != "BASE TABLE" for kind in tables.values()):
                    raise ValueError(
                        "dev_database에 프로젝트 초기화 범위 밖의 테이블 또는 뷰가 있습니다."
                    )
                for table in reversed(TABLES):
                    if table == "parts" and legacy:
                        cursor.execute("DELETE FROM part_offers")
                    cursor.execute(f"DELETE FROM {table}")
        updated = {}
        if specs_only:
            updated["reviewed_specs_refreshed"] = refresh_reviewed_specs(
                connection, parts, power_reviews, gpu_estimates
            )
        else:
            upsert_parts(
                connection, parts, power_reviews=power_reviews, gpu_estimates=gpu_estimates
            )
        evidence = upsert_compatibility(connection, records, checked_at)
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM parts")
            count = cursor.fetchone()[0]
            if reset and count != len(parts):
                raise ValueError("정규화된 부품 수와 DB 행 수가 달라 초기화를 롤백합니다.")
            if reset and legacy:
                # MySQL DDL commits independently. All replacement rows must succeed first.
                connection.commit()
                cursor.execute(DROP_OFFERS.read_text(encoding="utf-8").strip().removesuffix(";"))
        return {"parts_in_database": count, "compatibility": evidence, "reset": reset, **updated}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, help="고정 리비전의 data/json 파일이 있는 폴더")
    parser.add_argument("--krw-per-usd", help="1 USD당 KRW 기준환율")
    parser.add_argument("--fx-date", type=date.fromisoformat, help="환율 기준일 YYYY-MM-DD")
    parser.add_argument("--fx-source", help="환율 출처 HTTPS URL")
    parser.add_argument("--apply", action="store_true", help="미리보기 대신 MySQL에 저장")
    parser.add_argument("--with-images", action="store_true", help="Hugging Face 이미지 URL 연결")
    parser.add_argument("--image-dataset", type=Path, help="다운로드한 이미지 데이터셋 JSONL 경로")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--reset", action="store_true", help="기존 로컬 dev_database 행을 모두 교체")
    mode.add_argument(
        "--metadata-only", action="store_true", help="기존 부품의 전력·이미지 URL만 갱신"
    )
    mode.add_argument("--power-only", action="store_true", help="기존 부품의 전력만 갱신")
    mode.add_argument(
        "--specs-only",
        action="store_true",
        help="부품 ID와 가격을 유지하고 검토 사양과 근거만 갱신",
    )
    args = parser.parse_args()
    if args.reset and not args.apply:
        parser.error("--reset에는 --apply가 필요합니다.")
    if args.specs_only and (
        not args.apply
        or args.krw_per_usd is not None
        or any((args.fx_date, args.fx_source, args.with_images, args.image_dataset))
    ):
        parser.error(
            "--specs-only에는 --apply가 필요하며 환율·이미지 옵션과 함께 사용할 수 없습니다."
        )
    if args.metadata_only or args.power_only:
        if args.krw_per_usd is not None or any((args.source_dir, args.fx_date, args.fx_source)):
            parser.error(
                "기존 부품 메타데이터 갱신은 docyx 원본·환율 옵션과 함께 사용할 수 없습니다."
            )
        if args.power_only and (args.with_images or args.image_dataset):
            parser.error("--power-only는 이미지 옵션과 함께 사용할 수 없습니다.")
        power_reviews = load_power_reviews()
        gpu_estimates = load_gpu_estimates(power_reviews)
        image_rows = [] if args.power_only else list(read_image_rows(args.image_dataset))
        with closing(get_connection()) as connection:
            if args.apply:
                with import_transaction(connection):
                    metadata = refresh_metadata(
                        connection,
                        image_rows,
                        power_reviews,
                        gpu_estimates,
                        apply=True,
                        fill_images=not args.power_only,
                    )
            else:
                metadata = refresh_metadata(
                    connection,
                    image_rows,
                    power_reviews,
                    gpu_estimates,
                    fill_images=not args.power_only,
                )
        print(json.dumps({"mode": "apply" if args.apply else "preview", **metadata}))
        return
    if args.krw_per_usd is None:
        if args.fx_date or args.fx_source:
            parser.error("다른 환율을 지정하려면 세 환율 옵션을 함께 입력하세요.")
        rate, fx_date, source = Decimal("1361.89"), date(2026, 11, 6), FX_URL
    else:
        if not args.fx_date or not args.fx_source or not args.fx_source.startswith("https://"):
            parser.error("--krw-per-usd에는 --fx-date와 HTTPS --fx-source가 필요합니다.")
        try:
            rate = Decimal(args.krw_per_usd)
        except InvalidOperation:
            parser.error("--krw-per-usd는 숫자여야 합니다.")
        fx_date, source = args.fx_date, args.fx_source

    snapshot = read_snapshot(args.source_dir)
    reviews = read_json(DATA / "docyx_compatibility.json")
    records = validate_records(reviews["records"], reviews["parts"])
    checked_at = utc_now()
    parts, counts, unmatched = prepare_parts(
        snapshot,
        reviews["parts"],
        rate,
        fx_date,
        source,
        checked_at,
        excluded_keys=(part["source_key"] for part in reviews.get("excluded_parts", ())),
    )
    if set(counts) != set(CATEGORIES) or any(not info["ready"] for info in counts.values()):
        raise ValueError("적재 가능한 부품이 없는 카테고리가 있습니다.")
    keys = {row["specs"]["_provenance"]["source_key"] for row in parts}
    power_reviews = load_power_reviews()
    gpu_estimates = load_gpu_estimates(power_reviews)
    result = {
        "mode": "apply" if args.apply else "preview",
        "revision": REVISION,
        "fx_date": fx_date.isoformat(),
        "krw_per_usd": str(rate),
        "parts_ready": len(parts),
        "categories": counts,
        "unmatched_reviewed_parts": unmatched,
        "compatibility_ready": sum({r["part_a_key"], r["part_b_key"]} <= keys for r in records),
        "power_values_found": sum(
            resolve_catalog_power(part, power_reviews, gpu_estimates)[1] is not None
            for part in parts
        ),
    }
    if args.with_images or args.image_dataset:
        images = match_images(
            parts, read_image_rows(args.image_dataset), reviewed_images=load_reviewed_images()
        )
        for part in parts:
            part["image_url"] = resolve_image_url(None, images.get(part_identity(part)))
        result["image_urls_matched"] = len(images)
        result["image_placeholders"] = len(parts) - len(images)
    if args.apply:
        if args.specs_only and unmatched:
            raise ValueError("일부 검토 사양을 원본에서 정확히 식별할 수 없습니다.")
        result.update(
            apply_catalog(
                parts,
                records,
                checked_at,
                power_reviews=power_reviews,
                gpu_estimates=gpu_estimates,
                reset=args.reset,
                specs_only=args.specs_only,
            )
        )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    raise SystemExit(run_cli(main))
