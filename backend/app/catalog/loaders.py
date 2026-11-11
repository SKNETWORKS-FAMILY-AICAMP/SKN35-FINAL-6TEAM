"""기업 데이터 적재 어댑터.

기업마다 상품 데이터 모양이 다릅니다. 여기 어댑터가 각 기업 형식을 공통 형식(ProductRecord)으로 바꾸고,
그 뒤로는 모든 기업이 같은 엔진 · 같은 DB 테이블을 씁니다.

- public_json : 공통 형식 그대로인 JSON (공개 멀티브랜드 견본)
- company_csv : 기업 자체 상품표 CSV + 컬럼 매핑 JSON (가상 기업 A)

실제 기업을 붙일 때는 이 파일에 어댑터를 하나 더 만들고 LOADERS 에 등록합니다.
"""

import csv
import io
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.catalog.records import ProductRecord
from app.domains.base import DomainPack


class CatalogLoadError(ValueError):
    pass


def _check_unique(products: list[ProductRecord], source: str) -> list[ProductRecord]:
    seen: set[str] = set()
    for product in products:
        if product.sku in seen:
            raise CatalogLoadError(f"{source}: 상품코드가 중복됩니다 — {product.sku}")
        seen.add(product.sku)
    return products


def load_public_json(
    fixtures_dir: Path, source_file: str, mapping_file: str | None, pack: DomainPack
) -> list[ProductRecord]:
    path = fixtures_dir / source_file
    raw = json.loads(path.read_text(encoding="utf-8"))
    products: list[ProductRecord] = []
    for index, item in enumerate(raw["products"], start=1):
        try:
            attributes = pack.normalize_attributes(item["product_type"], item.get("attributes", {}))
            products.append(ProductRecord.model_validate({**item, "attributes": attributes}))
        except (KeyError, ValueError) as exc:
            raise CatalogLoadError(
                f"{source_file} {index}번째 상품을 읽지 못했습니다: {exc}"
            ) from exc
    return _check_unique(products, source_file)


def _parse_price(text: str) -> int | None:
    cleaned = text.replace(",", "").replace("원", "").strip()
    return int(cleaned) if cleaned else None


def _decode_csv(data: bytes, source_file: str) -> str:
    try:
        return data.decode("utf-8-sig")  # 엑셀이 붙이는 BOM 은 허용
    except UnicodeDecodeError as exc:
        raise CatalogLoadError(
            f"{source_file} 을 UTF-8 로 읽지 못했습니다. "
            "엑셀에서 '다른 이름으로 저장 → CSV UTF-8(쉼표로 분리)' 로 다시 저장하세요."
        ) from exc


def load_company_csv(
    fixtures_dir: Path, source_file: str, mapping_file: str | None, pack: DomainPack
) -> list[ProductRecord]:
    if mapping_file is None:
        raise CatalogLoadError(f"{source_file}: CSV 어댑터에는 컬럼 매핑 파일이 필요합니다")
    mapping: dict[str, Any] = json.loads((fixtures_dir / mapping_file).read_text(encoding="utf-8"))
    text = _decode_csv((fixtures_dir / source_file).read_bytes(), source_file)
    reader = csv.DictReader(io.StringIO(text))

    columns: dict[str, str] = mapping["columns"]
    missing = [col for col in columns.values() if col not in (reader.fieldnames or [])]
    if missing:
        raise CatalogLoadError(f"{source_file}: 매핑에 있는 컬럼이 CSV 에 없습니다 — {missing}")

    type_values: dict[str, str] = mapping["product_type_values"]
    price_values: dict[str, str] = mapping["price_status_values"]
    attribute_maps: dict[str, dict[str, str]] = mapping["attributes"]
    defaults: dict[str, Any] = mapping.get("defaults", {})

    products: list[ProductRecord] = []
    for line_no, row in enumerate(reader, start=2):
        try:
            product_type = type_values[row[columns["product_type"]].strip()]
            attributes = {
                field: row[column].strip()
                for field, column in attribute_maps[product_type].items()
                if row.get(column, "").strip()
            }
            record = {
                **defaults,
                "sku": row[columns["sku"]].strip(),
                "product_type": product_type,
                "brand": row[columns["brand"]].strip(),
                "model_name": row[columns["model_name"]].strip(),
                "price_amount": _parse_price(row[columns["price_amount"]]),
                "price_status": price_values[row[columns["price_status"]].strip()],
                "attributes": pack.normalize_attributes(product_type, attributes),
            }
            products.append(ProductRecord.model_validate(record))
        except (KeyError, ValueError) as exc:
            raise CatalogLoadError(
                f"{source_file} {line_no}번째 줄을 읽지 못했습니다: {exc}"
            ) from exc
    return _check_unique(products, source_file)


Loader = Callable[[Path, str, str | None, DomainPack], list[ProductRecord]]

LOADERS: dict[str, Loader] = {
    "public_json": load_public_json,
    "company_csv": load_company_csv,
}
