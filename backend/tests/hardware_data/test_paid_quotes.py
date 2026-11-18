from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from mysql.connector import IntegrityError

from app.db.paid_quotes import PaidQuote, PaidQuoteItem, save_paid_quote


@pytest.fixture
def quote():
    return PaidQuote(
        user_id=1,
        consultation_type="UPGRADE",
        payment_reference="test-payment",
        paid_at=datetime(2026, 1, 1, tzinfo=UTC),
        total_amount=Decimal("20.00"),
        performance_goal_snapshot={"min_memory_gb": 32},
        items=(PaidQuoteItem(1, "Test part", 2, Decimal("10.00"), {"capacity_gb": 32}),),
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"payment_reference": ""},
        {"paid_at": datetime(2026, 1, 1)},
        {"items": ()},
        {"total_amount": Decimal("19.99")},
    ],
)
def test_incomplete_payment_or_quote_does_not_start_a_write(quote, changes):
    connection = MagicMock(in_transaction=False)

    with pytest.raises(ValueError):
        save_paid_quote(connection, replace(quote, **changes))

    connection.start_transaction.assert_not_called()
    connection.cursor.assert_not_called()


def test_item_insert_error_rolls_back_the_quote(quote):
    connection = MagicMock(in_transaction=False)
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.lastrowid = 42
    cursor.executemany.side_effect = IntegrityError(errno=1452)

    with pytest.raises(IntegrityError):
        save_paid_quote(connection, quote)

    connection.start_transaction.assert_called_once_with()
    cursor.execute.assert_called_once()
    connection.rollback.assert_called_once_with()
    connection.commit.assert_not_called()
