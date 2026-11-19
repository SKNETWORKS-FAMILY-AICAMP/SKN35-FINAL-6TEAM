"""Check, initialize, or migrate the local MySQL parts schema."""

import re
import sys
from contextlib import closing
from pathlib import Path
from typing import Literal

import mysql.connector

from app.db.connection import get_connection
from app.domains.hardware.ingestion.common import compatibility_sources, read_specs

SCHEMA_PATH = Path(__file__).resolve().parent / "sql" / "parts_catalog.sql"
PAID_QUOTES_MIGRATION_PATH = SCHEMA_PATH.parent / "migrations" / "005_paid_quotes.sql"
PART_SOURCE_URLS_MIGRATION_PATH = (
    SCHEMA_PATH.parent / "migrations" / "006_remove_parts_source_urls.sql"
)
COMPATIBILITY_SOURCE_URL_MIGRATION_PATH = (
    SCHEMA_PATH.parent / "migrations" / "007_remove_compatibility_source_url.sql"
)
COMPATIBILITY_SOURCE_DATE_MIGRATION_PATH = (
    SCHEMA_PATH.parent / "migrations" / "008_remove_compatibility_source_updated_at.sql"
)
COMPATIBILITY_VERIFIED_AT_MIGRATION_PATH = (
    SCHEMA_PATH.parent / "migrations" / "009_remove_compatibility_verified_at.sql"
)
PART_VERIFIED_AT_MIGRATION_PATH = (
    SCHEMA_PATH.parent / "migrations" / "010_remove_parts_verified_at.sql"
)
COMPATIBILITY_SOURCE_PUBLISHER_MIGRATION_PATH = (
    SCHEMA_PATH.parent / "migrations" / "011_remove_compatibility_source_publisher.sql"
)
LEGACY_QUOTE_COLUMNS = {
    "quotes": [
        "quote_id",
        "consultation_id",
        "version",
        "status",
        "currency",
        "total_amount",
        "created_at",
        "updated_at",
    ],
    "quote_items": [
        "quote_item_id",
        "quote_id",
        "part_id",
        "part_name_snapshot",
        "quantity",
        "unit_price",
        "price_source_url",
        "price_checked_at",
        "configuration",
    ],
    "quote_validations": [
        "validation_id",
        "quote_id",
        "quote_version",
        "item_a_id",
        "item_b_id",
        "compatibility_id",
        "check_type",
        "result",
        "reason",
        "input_snapshot",
        "evidence_snapshot",
        "checked_at",
    ],
}


def _schema_columns(sql: str) -> dict[str, list[str]]:
    definitions = re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\) ENGINE", sql, re.S)
    return {
        table: re.findall(
            r"^    (\w+) (?:BIGINT|VARCHAR|CHAR|INT|TEXT|JSON|DECIMAL|DATETIME)\b",
            definition,
            re.M,
        )
        for table, definition in definitions
    }


def _current_columns(cursor, table: str) -> list[str]:
    cursor.execute(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s ORDER BY ORDINAL_POSITION",
        (table,),
    )
    return [row[0] for row in cursor.fetchall()]


def check_connection() -> tuple[str, str]:
    """Return the selected database and server version without changing data."""
    with closing(get_connection()) as connection, closing(connection.cursor()) as cursor:
        cursor.execute("SELECT DATABASE(), VERSION()")
        database, version = cursor.fetchone()
        return database, version


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="MySQL 연결 확인 / 초기 테이블 생성 / 마이그레이션"
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--init", action="store_true", help="별도 부품 DB의 parts_catalog.sql 실행")
    action.add_argument(
        "--migrate-paid-quotes", action="store_true", help="비어 있는 기존 견적 테이블 전환"
    )
    action.add_argument(
        "--migrate-part-source-urls", action="store_true", help="parts의 중복 출처 URL 컬럼 제거"
    )
    action.add_argument(
        "--migrate-compatibility-source-url",
        action="store_true",
        help="part_compatibility의 중복 출처 URL 컬럼 제거",
    )
    action.add_argument(
        "--migrate-compatibility-source-updated-at",
        action="store_true",
        help="part_compatibility의 원문 갱신일 컬럼 제거",
    )
    action.add_argument(
        "--migrate-compatibility-verified-at",
        action="store_true",
        help="part_compatibility의 적재 시각 컬럼 제거",
    )
    action.add_argument(
        "--migrate-part-verified-at", action="store_true", help="parts의 확인 시각 컬럼 제거"
    )
    action.add_argument(
        "--migrate-compatibility-source-publisher",
        action="store_true",
        help="part_compatibility의 중복 출처 발행자 컬럼 제거",
    )
    args = parser.parse_args()
    try:
        database, version = check_connection()
        if args.init:
            if database != "dev_database":
                raise ValueError("초기화 대상은 dev_database만 허용합니다.")
            initialize_schema()
        if args.migrate_paid_quotes:
            migrated = migrate_paid_quotes()
        if args.migrate_part_source_urls:
            migrated = migrate_part_source_urls()
        if args.migrate_compatibility_source_url:
            migrated = migrate_compatibility_source_url()
        if args.migrate_compatibility_source_updated_at:
            migrated = migrate_compatibility_source_updated_at()
        if args.migrate_compatibility_verified_at:
            migrated = migrate_compatibility_verified_at()
        if args.migrate_part_verified_at:
            migrated = migrate_part_verified_at()
        if args.migrate_compatibility_source_publisher:
            migrated = migrate_compatibility_source_publisher()
    except (OSError, ValueError) as error:
        print(f"설정 확인: {error}", file=sys.stderr)
        return 1
    except mysql.connector.Error as error:
        # Do not print credentials or a raw connection configuration.
        messages = {
            1045: "MySQL 사용자 이름과 비밀번호를 확인해 주세요.",
            1049: "PARTS_MYSQL_DATABASE에 지정한 데이터베이스가 존재하는지 확인해 주세요.",
            2002: "MySQL 서비스 실행 여부와 접속 주소·포트를 확인해 주세요.",
            2003: "MySQL 서비스 실행 여부와 접속 주소·포트를 확인해 주세요.",
            2005: "PARTS_MYSQL_HOST에 지정한 접속 주소를 확인해 주세요.",
            2026: "MySQL 서버와 클라이언트의 TLS 설정을 확인해 주세요.",
        }
        message = messages.get(error.errno, "MySQL 연결 설정과 서버 상태를 확인해 주세요.")
        print(f"연결 실패 (MySQL {error.errno}): {message}", file=sys.stderr)
        return 1

    print(f"연결 성공: {database} (MySQL {version})")
    if args.init:
        print("부품 DB 테이블 생성 완료 (기존 데이터 유지)")
    if args.migrate_paid_quotes:
        print(
            "결제 견적 구조 적용 완료" if migrated else "결제 견적 구조가 이미 적용되어 있습니다."
        )
    if args.migrate_part_source_urls:
        print("부품 출처 URL 컬럼 제거 완료" if migrated else "부품 출처 URL 컬럼이 이미 없습니다.")
    if args.migrate_compatibility_source_url:
        print(
            "호환성 출처 URL 컬럼 제거 완료"
            if migrated
            else "호환성 출처 URL 컬럼이 이미 없습니다."
        )
    if args.migrate_compatibility_source_updated_at:
        print(
            "호환성 원문 갱신일 컬럼 제거 완료"
            if migrated
            else "호환성 원문 갱신일 컬럼이 이미 없습니다."
        )
    if args.migrate_compatibility_verified_at:
        print(
            "호환성 적재 시각 컬럼 제거 완료"
            if migrated
            else "호환성 적재 시각 컬럼이 이미 없습니다."
        )
    if args.migrate_part_verified_at:
        print(
            "부품 확인 시각 컬럼 제거 완료" if migrated else "부품 확인 시각 컬럼이 이미 없습니다."
        )
    if args.migrate_compatibility_source_publisher:
        print(
            "호환성 출처 발행자 컬럼 제거 완료"
            if migrated
            else "호환성 출처 발행자 컬럼이 이미 없습니다."
        )
    return 0


def initialize_schema() -> None:
    """Only run the reviewed CREATE script. MySQL DDL is not transactional."""
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with closing(get_connection()) as connection, closing(connection.cursor()) as cursor:
        cursor.execute("SELECT DATABASE()")
        if cursor.fetchone()[0] != "dev_database":
            raise ValueError("초기화 대상이 dev_database가 아닙니다.")
        for table, expected in _schema_columns(sql).items():
            actual = _current_columns(cursor, table)
            if actual and actual != expected:
                raise ValueError(
                    f"{table}: 기존 컬럼이 parts_catalog.sql과 다릅니다. 별도 마이그레이션이 필요합니다."
                )
        # This script contains no stored programs or semicolons inside strings.
        for statement in sql.split(";"):
            if statement.strip():
                cursor.execute(statement)


def migrate_paid_quotes() -> bool:
    """Apply 005 to empty legacy quote tables, and resume completed table changes on retry."""
    expected = _schema_columns(SCHEMA_PATH.read_text(encoding="utf-8"))
    migration = PAID_QUOTES_MIGRATION_PATH.read_text(encoding="utf-8")
    statements = re.findall(r"(ALTER TABLE (\w+)\s+[^;]+);", migration)
    with closing(get_connection()) as connection, closing(connection.cursor()) as cursor:
        cursor.execute("SELECT GET_LOCK('dev_database:migrate_paid_quotes', 10)")
        if cursor.fetchone()[0] != 1:
            raise ValueError("결제 견적 마이그레이션 잠금을 얻지 못했습니다.")

        pending = []
        for statement, table in statements:
            current = _current_columns(cursor, table)
            if current == expected[table]:
                continue
            if current != LEGACY_QUOTE_COLUMNS[table]:
                raise ValueError(f"{table}: 마이그레이션 대상 컬럼 구성이 아닙니다.")
            pending.append(statement)
        if not pending:
            return False

        cursor.execute("SELECT EXISTS (SELECT 1 FROM quotes)")
        if cursor.fetchone()[0]:
            raise ValueError("기존 견적이 있습니다. 결제 근거 확인과 이관 계획이 필요합니다.")
        for statement in pending:
            cursor.execute(statement)
        return True


def _parts_price_checks(cursor) -> tuple[bool, bool]:
    cursor.execute("SHOW CREATE TABLE parts")
    _, ddl = cursor.fetchone()
    checks = set(re.findall(r"CONSTRAINT `?(\w+)`?\s+CHECK\b[^\n]*", ddl, re.IGNORECASE))
    return "ck_parts_price_source" in checks, "ck_parts_price_checked_at" in checks


def _parts_columns_by_revision() -> dict[int, list[str]]:
    current = _schema_columns(SCHEMA_PATH.read_text(encoding="utf-8"))["parts"]
    after_006 = current.copy()
    after_006.insert(after_006.index("specs") + 1, "verified_at")
    return {6: after_006, 10: current}


def migrate_part_source_urls() -> bool:
    """Apply 006 under the catalog import lock, resuming any completed DDL steps."""
    layouts = _parts_columns_by_revision()
    expected = layouts[6]
    sql = PART_SOURCE_URLS_MIGRATION_PATH.read_text(encoding="utf-8")
    add_check, drop_check, drop_price_url, drop_source_url = re.findall(
        r"ALTER TABLE parts\s+[^;]+", sql
    )
    with closing(get_connection()) as connection, closing(connection.cursor()) as cursor:
        cursor.execute("SELECT GET_LOCK(CONCAT(DATABASE(), ':catalog_import'), 10)")
        if cursor.fetchone()[0] != 1:
            raise ValueError("부품 적재 잠금을 얻지 못했습니다.")

        columns = _current_columns(cursor, "parts")
        if columns == layouts[10] and _parts_price_checks(cursor) == (False, True):
            return False
        source_urls = {"source_url", "price_source_url"}
        if [col for col in columns if col not in source_urls] != expected or (
            "price_source_url" in columns and "source_url" not in columns
        ):
            raise ValueError("parts: 출처 URL 마이그레이션 대상 컬럼 구성이 아닙니다.")

        if "price_source_url" in columns:
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM parts WHERE price_source_url IS NOT NULL "
                "AND NOT (BINARY price_source_url <=> BINARY source_url))"
            )
            if cursor.fetchone()[0]:
                raise ValueError("부품 출처와 다른 가격 출처가 있어 마이그레이션을 중단했습니다.")

        old_check, new_check = _parts_price_checks(cursor)
        if columns == expected and new_check and not old_check:
            return False
        if not new_check:
            cursor.execute(add_check)
            if not _parts_price_checks(cursor)[1]:
                raise ValueError("가격 확인 시각 제약을 추가하지 못했습니다.")
        if old_check:
            cursor.execute(drop_check)
        if "price_source_url" in columns:
            cursor.execute(drop_price_url)
        if "source_url" in columns:
            cursor.execute(drop_source_url)

        if _current_columns(cursor, "parts") != expected or _parts_price_checks(cursor) != (
            False,
            True,
        ):
            raise ValueError("부품 출처 URL 마이그레이션 결과가 예상한 구조와 다릅니다.")
        return True


def _compatibility_columns_by_revision() -> dict[int, list[str]]:
    current = _schema_columns(SCHEMA_PATH.read_text(encoding="utf-8"))["part_compatibility"]
    with_publisher = [*current, "source_publisher"]
    return {
        6: [*with_publisher, "source_url", "source_updated_at", "verified_at"],
        7: [*with_publisher, "source_updated_at", "verified_at"],
        8: [*with_publisher, "verified_at"],
        9: with_publisher,
        10: with_publisher,
        11: current,
    }


def migrate_compatibility_source_url() -> bool:
    """Apply 007 only if every stored URL can be recovered from the evidence file."""
    return _migrate_compatibility_columns(
        COMPATIBILITY_SOURCE_URL_MIGRATION_PATH,
        revision=7,
        label="출처 URL",
        source_field="source_url",
    )


def migrate_compatibility_source_updated_at() -> bool:
    """Apply 008 under the catalog import lock, with original dates in the evidence file."""
    return _migrate_compatibility_columns(
        COMPATIBILITY_SOURCE_DATE_MIGRATION_PATH, revision=8, label="원문 갱신일"
    )


def migrate_compatibility_verified_at() -> bool:
    """Apply 009 under the catalog import lock, preserving the evidence conditions."""
    return _migrate_compatibility_columns(
        COMPATIBILITY_VERIFIED_AT_MIGRATION_PATH, revision=9, label="적재 시각"
    )


def migrate_compatibility_source_publisher() -> bool:
    """Apply 011 only if every stored publisher can be recovered from the evidence file."""
    return _migrate_compatibility_columns(
        COMPATIBILITY_SOURCE_PUBLISHER_MIGRATION_PATH,
        revision=11,
        label="출처 발행자",
        source_field="source_publisher",
    )


def _verify_compatibility_sources(cursor, source_field: str, label: str) -> None:
    sources = compatibility_sources()
    cursor.execute(f"SELECT compatibility_id, conditions, {source_field} FROM part_compatibility")
    first_mismatch = None
    for compatibility_id, raw_conditions, value in cursor:
        if first_mismatch is not None:
            continue
        conditions = read_specs(raw_conditions)
        key = conditions.get("_record_key") if isinstance(conditions, dict) else None
        expected = sources.get(key, {}).get(source_field) if isinstance(key, str) else None
        if not value or value != expected:
            first_mismatch = compatibility_id
    if first_mismatch is not None:
        raise ValueError(
            f"원본 자료와 {label} 값이 일치하지 않아 마이그레이션을 중단했습니다 "
            f"(compatibility_id={first_mismatch})."
        )


def _migrate_compatibility_columns(
    migration_path: Path,
    *,
    revision: int,
    label: str,
    source_field: Literal["source_url", "source_publisher"] | None = None,
) -> bool:
    table = "part_compatibility"
    layouts = _compatibility_columns_by_revision()
    sql = migration_path.read_text(encoding="utf-8")
    with closing(get_connection()) as connection, closing(connection.cursor()) as cursor:
        cursor.execute("SELECT GET_LOCK(CONCAT(DATABASE(), ':catalog_import'), 10)")
        if cursor.fetchone()[0] != 1:
            raise ValueError("부품 적재 잠금을 얻지 못했습니다.")

        columns = _current_columns(cursor, table)
        if any(columns == layout for version, layout in layouts.items() if version >= revision):
            return False
        if columns != layouts[revision - 1]:
            raise ValueError(f"part_compatibility: {label} 마이그레이션 대상 컬럼 구성이 아닙니다.")
        if source_field is not None:
            _verify_compatibility_sources(cursor, source_field, label)

        cursor.execute(sql)
        if _current_columns(cursor, table) != layouts[revision]:
            raise ValueError(f"호환성 {label} 마이그레이션 결과가 예상한 구조와 다릅니다.")
        return True


def migrate_part_verified_at() -> bool:
    """Apply 010 under the catalog import lock when there are no saved timestamps."""
    layouts = _parts_columns_by_revision()
    sql = PART_VERIFIED_AT_MIGRATION_PATH.read_text(encoding="utf-8")
    with closing(get_connection()) as connection, closing(connection.cursor()) as cursor:
        cursor.execute("SELECT GET_LOCK(CONCAT(DATABASE(), ':catalog_import'), 10)")
        if cursor.fetchone()[0] != 1:
            raise ValueError("부품 적재 잠금을 얻지 못했습니다.")

        columns = _current_columns(cursor, "parts")
        if columns == layouts[10]:
            return False
        if columns != layouts[6] or _parts_price_checks(cursor) != (False, True):
            raise ValueError("parts: 먼저 006 출처 URL 마이그레이션 적용 상태를 확인하세요.")

        cursor.execute("SELECT EXISTS (SELECT 1 FROM parts WHERE verified_at IS NOT NULL)")
        if cursor.fetchone()[0]:
            raise ValueError("parts.verified_at에 저장된 시각이 있어 마이그레이션을 중단했습니다.")

        cursor.execute(sql)
        if _current_columns(cursor, "parts") != layouts[10]:
            raise ValueError("부품 확인 시각 마이그레이션 결과가 예상한 구조와 다릅니다.")
        return True


if __name__ == "__main__":
    raise SystemExit(main())
