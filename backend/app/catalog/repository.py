"""상품 조회. 언제나 기업(company_id)으로 범위를 좁혀 다른 기업 상품이 섞이지 않게 합니다."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog.records import ProductRecord
from app.db.models import Product


def list_products(db: Session, company_id: int, product_types: list[str]) -> list[ProductRecord]:
    if not product_types:
        return []
    rows = db.scalars(
        select(Product)
        .where(Product.company_id == company_id, Product.product_type.in_(product_types))
        .order_by(Product.id)
    ).all()
    return [ProductRecord.model_validate(row) for row in rows]
