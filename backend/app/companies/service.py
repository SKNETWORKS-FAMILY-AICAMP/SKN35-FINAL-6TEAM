"""기업 조회."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.companies.policy import CompanyPolicy
from app.contracts.schemas import CompanyOut, CompanyPolicyOut, ProductTypeOut
from app.core.errors import NotFoundError
from app.db.models import Company
from app.domains import get_pack


class CompanyNotFound(NotFoundError):
    def __init__(self, company_id: int) -> None:
        super().__init__(f"기업을 찾을 수 없습니다: {company_id}")


def load_policy(company: Company) -> CompanyPolicy:
    return CompanyPolicy.model_validate(company.policy)


def get_company(db: Session, company_id: int) -> Company:
    company = db.get(Company, company_id)
    if company is None:
        raise CompanyNotFound(company_id)
    return company


def to_company_out(company: Company) -> CompanyOut:
    policy = load_policy(company)
    labels = get_pack(company.domain).product_types()
    return CompanyOut(
        id=company.id,
        slug=company.slug,
        name=company.name,
        description=company.description,
        domain=company.domain,
        source_format=company.source_format,
        product_types=[
            ProductTypeOut(code=code, label=labels.get(code, code))
            for code in policy.supported_product_types
        ],
        policy=CompanyPolicyOut(
            shipping_fee=policy.shipping_fee,
            free_shipping_over=policy.free_shipping_over,
            discount_rate=policy.discount_rate,
            quote_valid_days=policy.quote_valid_days,
        ),
        is_test_data=company.is_test_data,
    )


def list_companies(db: Session) -> list[CompanyOut]:
    companies = db.scalars(select(Company).order_by(Company.id)).all()
    return [to_company_out(c) for c in companies]
