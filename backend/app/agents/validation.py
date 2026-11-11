"""검증팀: 후보 하나를 기업 정책 · 데이터 상태 · 도메인 규칙으로 확인합니다.

공통 검사(여기)와 도메인 검사(domains/<팩>.check)를 합칩니다.
severity=block 검사가 하나라도 실패하면 후보는 탈락(rejected)입니다.
"""

from app.catalog.records import ProductRecord
from app.companies.policy import CompanyPolicy
from app.domains.base import Check, DomainPack, Preferences


def check_candidate(
    product: ProductRecord,
    budget_max: int,
    prefs: Preferences,
    policy: CompanyPolicy,
    pack: DomainPack,
) -> list[Check]:
    checks: list[Check] = [
        Check(
            code="POLICY_PRODUCT_TYPE",
            passed=product.product_type in policy.supported_product_types,
            severity="block",
            detail=f"기업 취급 상품 유형: {product.product_type}",
        )
    ]

    if product.price_amount is None:
        checks.append(
            Check(
                code="BUDGET", passed=False, severity="warn", detail="가격 미확인 — 예산 비교 불가"
            )
        )
    else:
        checks.append(
            Check(
                code="BUDGET",
                passed=product.price_amount <= budget_max,
                severity="block",
                detail=f"가격 {product.price_amount:,}원 / 예산 {budget_max:,}원",
            )
        )

    if product.price_status == "unconfirmed":
        checks.append(
            Check(
                code="PRICE_STATUS",
                passed=False,
                severity="warn",
                detail="가격 미확인 상품 — 견적에 넣을 수 없습니다",
            )
        )

    data_detail = {
        "verified": "출처 확인된 데이터",
        "unverified": "출처 미확인 데이터",
        "test": "테스트 데이터(가상 상품)",
    }[product.data_status]
    checks.append(
        Check(
            code="DATA_STATUS",
            passed=product.data_status == "verified",
            severity="warn" if product.data_status == "unverified" else "info",
            detail=data_detail,
        )
    )

    checks.extend(pack.check(product, budget_max, prefs))
    return checks


def is_passed(checks: list[Check]) -> bool:
    return not any(c.severity == "block" and not c.passed for c in checks)
