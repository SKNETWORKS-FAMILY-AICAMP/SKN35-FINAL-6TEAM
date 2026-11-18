"""Store and read final quotes supplied by the payment completion flow."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from mysql.connector import IntegrityError
from mysql.connector.abstracts import MySQLConnectionAbstract
from mysql.connector.errorcode import ER_DUP_ENTRY

_CONSULTATION_TYPES = ("UPGRADE", "NEW_BUILD")
_MAX_AMOUNT = Decimal("9999999999999.99")
_CENT = Decimal("0.01")


@dataclass(frozen=True)
class PaidQuoteItem:
    part_id: int
    part_name_snapshot: str
    quantity: int
    unit_price: Decimal
    selection_basis: dict[str, object]


@dataclass(frozen=True)
class PaidQuote:
    user_id: int
    consultation_type: str
    payment_reference: str
    paid_at: datetime
    total_amount: Decimal
    performance_goal_snapshot: dict[str, object]
    items: tuple[PaidQuoteItem, ...]


def _check_amount(amount: Decimal) -> None:
    if (
        not isinstance(amount, Decimal)
        or not amount.is_finite()
        or not 0 <= amount <= _MAX_AMOUNT
        or amount != amount.quantize(_CENT)
    ):
        raise ValueError("금액은 DECIMAL(15,2) 범위의 0 이상 Decimal이어야 합니다.")


def _snapshot(value: dict[str, object]) -> str:
    if not isinstance(value, dict) or not value:
        raise ValueError("성능 목표와 품목별 선택 근거는 비어 있지 않은 JSON 객체여야 합니다.")
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)
    except (TypeError, ValueError) as error:
        raise ValueError("견적 스냅샷은 JSON으로 저장할 수 있어야 합니다.") from error


def _read_quote(connection: MySQLConnectionAbstract, predicate: str, params: tuple) -> dict | None:
    with connection.cursor(dictionary=True) as cursor:
        cursor.execute(
            "SELECT quote_id,user_id,consultation_type,payment_reference,paid_at,"
            "total_amount,currency,performance_goal_snapshot FROM quotes WHERE " + predicate,
            params,
        )
        row = cursor.fetchone()
        if row is None:
            return None
        row["paid_at"] = row["paid_at"].replace(tzinfo=UTC)
        row["performance_goal_snapshot"] = json.loads(row["performance_goal_snapshot"])
        cursor.execute(
            "SELECT part_id,part_name_snapshot,quantity,unit_price,selection_basis "
            "FROM quote_items WHERE quote_id=%s ORDER BY quote_item_id",
            (row["quote_id"],),
        )
        row["items"] = cursor.fetchall()
        for item in row["items"]:
            item["selection_basis"] = json.loads(item["selection_basis"])
        return row


def get_paid_quote(
    connection: MySQLConnectionAbstract, *, user_id: int, quote_id: int
) -> dict | None:
    """Return purchase-time snapshots for an existing user, scoped to that user."""
    return _read_quote(connection, "user_id=%s AND quote_id=%s", (user_id, quote_id))


def save_paid_quote(connection: MySQLConnectionAbstract, quote: PaidQuote) -> int:
    """Persist a confirmed payment and its items together on an idle connection.

    The caller supplies verified payment facts and the final user-visible snapshots.
    A replay with the same facts returns the existing quote ID.
    """
    if connection.in_transaction:
        raise ValueError("견적 저장에는 진행 중인 트랜잭션이 없는 연결이 필요합니다.")
    if type(quote.user_id) is not int or not 0 < quote.user_id <= 2**64 - 1:
        raise ValueError("유효한 사용자 ID가 필요합니다.")
    if quote.consultation_type not in _CONSULTATION_TYPES:
        raise ValueError("상담 유형은 UPGRADE 또는 NEW_BUILD여야 합니다.")
    reference = quote.payment_reference
    if (
        not isinstance(reference, str)
        or not 1 <= len(reference) <= 191
        or reference.strip() != reference
    ):
        raise ValueError("결제 식별값은 앞뒤 공백 없이 1~191자여야 합니다.")
    if not isinstance(quote.paid_at, datetime) or quote.paid_at.utcoffset() is None:
        raise ValueError("결제 완료 시각에는 UTC 오프셋이 필요합니다.")
    if not quote.items:
        raise ValueError("결제 견적에는 품목이 하나 이상 필요합니다.")

    paid_at = quote.paid_at.astimezone(UTC)
    goal = _snapshot(quote.performance_goal_snapshot)
    _check_amount(quote.total_amount)
    item_values = []
    for item in quote.items:
        if type(item.part_id) is not int or not 0 < item.part_id <= 2**64 - 1:
            raise ValueError("유효한 부품 ID가 필요합니다.")
        if type(item.quantity) is not int or not 0 < item.quantity <= 2**32 - 1:
            raise ValueError("품목 수량은 양수여야 합니다.")
        if (
            not isinstance(item.part_name_snapshot, str)
            or not item.part_name_snapshot.strip()
            or len(item.part_name_snapshot) > 255
        ):
            raise ValueError("결제 당시 제품명을 1~255자로 입력해 주세요.")
        _check_amount(item.unit_price)
        item_values.append(
            (
                item.part_id,
                item.part_name_snapshot,
                item.quantity,
                item.unit_price,
                _snapshot(item.selection_basis),
            )
        )
    if quote.total_amount != sum(price * qty for _, _, qty, price, _ in item_values):
        raise ValueError("견적 총액이 품목별 단가와 수량의 합계와 다릅니다.")

    connection.start_transaction()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO quotes (user_id,consultation_type,payment_reference,paid_at,"
                "total_amount,performance_goal_snapshot) VALUES (%s,%s,%s,%s,%s,%s)",
                (
                    quote.user_id,
                    quote.consultation_type,
                    reference,
                    paid_at.replace(tzinfo=None),
                    quote.total_amount,
                    goal,
                ),
            )
            quote_id = cursor.lastrowid
            cursor.executemany(
                "INSERT INTO quote_items (quote_id,part_id,part_name_snapshot,quantity,"
                "unit_price,selection_basis,configuration) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                [(quote_id, *item, "{}") for item in item_values],
            )
        connection.commit()
        return quote_id
    except IntegrityError as error:
        connection.rollback()
        if error.errno != ER_DUP_ENTRY:
            raise
    except BaseException:
        connection.rollback()
        raise

    try:
        existing = _read_quote(
            connection, "user_id=%s AND payment_reference=%s", (quote.user_id, reference)
        )
    finally:
        connection.rollback()
    if existing is not None and (
        existing["consultation_type"],
        existing["paid_at"],
        existing["total_amount"],
        existing["performance_goal_snapshot"],
        existing["items"],
    ) == (
        quote.consultation_type,
        paid_at,
        quote.total_amount,
        json.loads(goal),
        [
            dict(
                part_id=part_id,
                part_name_snapshot=name,
                quantity=qty,
                unit_price=price,
                selection_basis=json.loads(basis),
            )
            for part_id, name, qty, price, basis in item_values
        ],
    ):
        return existing["quote_id"]
    raise ValueError("이미 다른 견적 정보로 사용된 결제 식별값입니다.")
