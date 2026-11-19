"""The demo's database reader must preserve real identifiers, evidence and price provenance."""

import json
from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock

import mysql.connector
import pytest

from app.domains.hardware.consultation_demo import parts_db


def case_record(part_id, color):
    specs = {
        "color": color,
        "_provenance": {
            "source": "docyx",
            "source_key": f"test-case-{color.lower()}",
            "raw_name": "Database test case",
            "price_status": "test",
            "price_basis": "USD_FX_REFERENCE",
        },
    }
    return {
        "part_id": part_id,
        "category": "case",
        "brand": "Test",
        "name": "Database test case [0123456789ab]",
        "model_number": f"Test {color}",
        "specs": json.dumps(specs),
        "power_draw_w": None,
        "current_price": Decimal("37500.00"),
        "currency": "KRW",
        "price_checked_at": datetime(2026, 11, 1, 0, 0),
    }


def test_reads_shop_rows_and_only_their_pairwise_evidence(monkeypatch):
    db = MagicMock()
    catalog_cursor = db.cursor.return_value.__enter__.return_value
    catalog_cursor.fetchall.return_value = [case_record(171, "Black"), case_record(196, "White")]
    evidence = [{"compatibility_id": 1}]
    lookup = MagicMock(return_value=evidence)
    monkeypatch.setattr(parts_db, "get_connection", lambda: db)
    monkeypatch.setattr(parts_db, "list_compatibility", lookup)

    snapshot = parts_db.load_catalog(1)

    statement, parameters = catalog_cursor.execute.call_args.args
    assert "shop.company_id=%s" in statement and "source'=shop.source" in statement
    assert parameters[:3] == (1, "docyx", 1)
    lookup.assert_called_once_with(db, part_ids=[171, 196])
    assert snapshot.compatibility == evidence
    black, white = snapshot.parts
    assert (black["name"], white["name"]) == (
        "Database test case · Black",
        "Database test case · White",
    )
    assert black["id"] == 171 and black["price"] == 37500 and black["company_id"] == 1
    assert black["price_checked_at"] == "2026-11-01T00:00:00+00:00"
    assert black["data_status"] == "unverified" and black["price_status"] == "test"
    assert black["price_basis"] == "USD_FX_REFERENCE" and black["currency"] == "KRW"
    assert black["power_draw_w"] is None
    db.close.assert_called_once()


@pytest.mark.parametrize("company_id", [2, 0, None, True, "1"])
def test_unassigned_company_cannot_open_catalog(monkeypatch, company_id):
    connect = MagicMock()
    monkeypatch.setattr(parts_db, "get_connection", connect)
    assert parts_db.load_catalog(company_id) == parts_db.CatalogSnapshot([], [])
    connect.assert_not_called()


def test_failed_connection_cannot_fall_back_to_a_snapshot(monkeypatch):
    connect = MagicMock(side_effect=mysql.connector.Error("test host unavailable"))
    monkeypatch.setattr(parts_db, "get_connection", connect)
    with pytest.raises(parts_db.PartsCatalogError, match="부품 DB") as raised:
        parts_db.load_catalog(1)
    assert "test host" not in str(raised.value)
