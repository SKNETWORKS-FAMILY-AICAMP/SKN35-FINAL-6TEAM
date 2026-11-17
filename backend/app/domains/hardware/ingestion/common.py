"""Shared import helpers; data paths are rooted at the repository's data/hardware."""

import json
from contextlib import contextmanager
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from app.domains.hardware.ingestion.paths import DATA as DATA

CATEGORIES = ("cpu", "motherboard", "ram", "gpu", "storage", "psu", "case", "cooler")
TABLES = (
    "users",
    "consultations",
    "messages",
    "parts",
    "quotes",
    "quote_items",
    "part_compatibility",
    "quote_validations",
)


def utc_now():
    return datetime.now(UTC).isoformat()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def read_specs(value):
    return json.loads(value) if isinstance(value, (str, bytes)) else value


def sql_time(value):
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("시각에는 UTC 오프셋이 필요합니다: " + value)
    return parsed.astimezone(UTC).replace(tzinfo=None)


def price_value(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        price = Decimal(str(value))
    except InvalidOperation:
        return None
    if not price.is_finite() or price <= 0 or price > Decimal("9999999999999.99"):
        return None
    if price != price.quantize(Decimal("0.01")):
        return None
    return price


def json_text(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


@contextmanager
def import_transaction(connection):
    """Serialize our importers, commit on success, and roll back every DML failure."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT GET_LOCK(CONCAT(DATABASE(), ':catalog_import'), 10)")
        if cursor.fetchone()[0] != 1:
            raise ValueError("다른 데이터 가져오기가 실행 중입니다.")
    try:
        yield
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        with connection.cursor() as cursor:
            cursor.execute("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':catalog_import'))")
            cursor.fetchone()


def run_cli(main):
    import mysql.connector

    try:
        return main() or 0
    except mysql.connector.Error as error:
        print(f"DB 작업 실패 (MySQL {error.errno}). 연결 설정 또는 제약조건을 확인하세요.")
        return 1
    except (ValueError, OSError) as error:
        print(f"작업 실패: {error}")
        return 1
