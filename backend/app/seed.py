"""견본 데이터 넣기.

    uv run python -m app.seed          # DB 에 넣기(이미 있으면 갱신, 지우지는 않음)
    uv run python -m app.seed --check  # DB 없이 견본 파일만 검사(CI 에서 사용)

견본 데이터는 모두 가상 브랜드 · 가상 모델인 테스트 데이터입니다. 실제 제품 정보가 아닙니다.
"""

import argparse
import json
import sys
from pathlib import Path

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog.loaders import LOADERS, CatalogLoadError
from app.catalog.records import ProductRecord
from app.companies.policy import CompanyPolicy
from app.core.config import get_settings
from app.core.db import Database
from app.db.models import Company, Product
from app.domains import get_pack


class CompanySeed(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str
    name: str
    description: str
    domain: str
    source_format: str
    source_file: str
    mapping_file: str | None = None
    policy: CompanyPolicy
    is_test_data: bool = True


def read_seeds(fixtures_dir: Path) -> list[CompanySeed]:
    raw = json.loads((fixtures_dir / "companies.json").read_text(encoding="utf-8"))
    return [CompanySeed.model_validate(item) for item in raw["companies"]]


def load_catalog(seed: CompanySeed, fixtures_dir: Path) -> list[ProductRecord]:
    pack = get_pack(seed.domain)
    unknown = set(seed.policy.supported_product_types) - set(pack.product_types())
    if unknown:
        raise CatalogLoadError(f"{seed.slug}: 도메인 팩이 모르는 상품 유형 — {sorted(unknown)}")
    loader = LOADERS.get(seed.source_format)
    if loader is None:
        raise CatalogLoadError(f"{seed.slug}: 모르는 카탈로그 형식 — {seed.source_format}")
    return loader(fixtures_dir, seed.source_file, seed.mapping_file, pack)


def _upsert(db: Session, seed: CompanySeed, products: list[ProductRecord]) -> None:
    company = db.scalar(select(Company).where(Company.slug == seed.slug))
    if company is None:
        company = Company(slug=seed.slug)
        db.add(company)
    company.name = seed.name
    company.description = seed.description
    company.domain = seed.domain
    company.source_format = seed.source_format
    company.policy = seed.policy.model_dump(mode="json")
    company.is_test_data = seed.is_test_data
    db.flush()

    existing = {
        p.sku: p for p in db.scalars(select(Product).where(Product.company_id == company.id))
    }
    for record in products:
        row = existing.get(record.sku) or Product(company_id=company.id, sku=record.sku)
        row.product_type = record.product_type
        row.brand = record.brand
        row.model_name = record.model_name
        row.price_amount = record.price_amount
        row.currency = record.currency
        row.price_status = record.price_status
        row.data_status = record.data_status
        row.source_url = record.source_url
        row.source_note = record.source_note
        row.attributes = record.attributes
        db.add(row)


def seed_database(database: Database, fixtures_dir: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    with database.transaction() as db:
        for seed in read_seeds(fixtures_dir):
            products = load_catalog(seed, fixtures_dir)
            _upsert(db, seed, products)
            counts[seed.slug] = len(products)
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="BUILDWISE 견본 데이터")
    parser.add_argument("--check", action="store_true", help="DB 없이 견본 파일만 검사")
    args = parser.parse_args(argv)
    settings = get_settings()

    try:
        if args.check:
            for seed in read_seeds(settings.fixtures_dir):
                products = load_catalog(seed, settings.fixtures_dir)
                print(f"[seed] {seed.slug}: 상품 {len(products)}개 형식 확인")
            return 0
        database = Database(settings.database_url)
        counts = seed_database(database, settings.fixtures_dir)
        database.dispose()
    except CatalogLoadError as exc:
        print(f"[seed] 실패: {exc}", file=sys.stderr)
        return 1
    for slug, count in counts.items():
        print(f"[seed] {slug}: 상품 {count}개 반영")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
