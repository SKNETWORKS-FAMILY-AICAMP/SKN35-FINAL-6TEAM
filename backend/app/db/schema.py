"""Check, initialize, or migrate the local MySQL parts schema."""

import re
import sys
from contextlib import closing
from pathlib import Path

import mysql.connector

from app.db.connection import get_connection
from app.domains.hardware.ingestion.common import compatibility_source_urls, read_specs

SCHEMA_PATH = Path(__file__).resolve().parent / "sql" / "parts_catalog.sql"
PAID_QUOTES_MIGRATION_PATH = SCHEMA_PATH.parent / "migrations" / "005_paid_quotes.sql"
PART_SOURCE_URLS_MIGRATION_PATH = (
    SCHEMA_PATH.parent / "migrations" / "006_remove_parts_source_urls.sql"
)
COMPATIBILITY_SOURCE_URL_MIGRATION_PATH = (
    SCHEMA_PATH.parent / "migrations" / "007_remove_compatibility_source_url.sql"
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


def migrate_part_source_urls() -> bool:
    """Apply 006 under the catalog import lock, resuming any completed DDL steps."""
    expected = _schema_columns(SCHEMA_PATH.read_text(encoding="utf-8"))["parts"]
    sql = PART_SOURCE_URLS_MIGRATION_PATH.read_text(encoding="utf-8")
    add_check, drop_check, drop_price_url, drop_source_url = re.findall(
        r"ALTER TABLE parts\s+[^;]+", sql
    )
    with closing(get_connection()) as connection, closing(connection.cursor()) as cursor:
        cursor.execute("SELECT GET_LOCK(CONCAT(DATABASE(), ':catalog_import'), 10)")
        if cursor.fetchone()[0] != 1:
            raise ValueError("부품 적재 잠금을 얻지 못했습니다.")

        columns = _current_columns(cursor, "parts")
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


def migrate_compatibility_source_url() -> bool:
    """Apply 007 only if every stored URL can be recovered from the evidence file."""
    table = "part_compatibility"
    expected = _schema_columns(SCHEMA_PATH.read_text(encoding="utf-8"))[table]
    previous = expected.copy()
    previous.insert(expected.index("source_publisher") + 1, "source_url")
    sql = COMPATIBILITY_SOURCE_URL_MIGRATION_PATH.read_text(encoding="utf-8")
    with closing(get_connection()) as connection, closing(connection.cursor()) as cursor:
        cursor.execute("SELECT GET_LOCK(CONCAT(DATABASE(), ':catalog_import'), 10)")
        if cursor.fetchone()[0] != 1:
            raise ValueError("부품 적재 잠금을 얻지 못했습니다.")

        columns = _current_columns(cursor, table)
        if columns == expected:
            return False
        if columns != previous:
            raise ValueError("part_compatibility: 출처 URL 마이그레이션 대상 컬럼 구성이 아닙니다.")

        sources = compatibility_source_urls()
        first_mismatch = None
        cursor.execute("SELECT compatibility_id, conditions, source_url FROM part_compatibility")
        for compatibility_id, raw_conditions, url in cursor:
            conditions = read_specs(raw_conditions)
            key = conditions.get("_record_key") if isinstance(conditions, dict) else None
            if first_mismatch is None and (
                not isinstance(key, str) or not url or sources.get(key) != url
            ):
                first_mismatch = compatibility_id
        if first_mismatch is not None:
            raise ValueError(
                "원본 자료와 출처 URL이 일치하지 않아 마이그레이션을 중단했습니다 "
                f"(compatibility_id={first_mismatch})."
            )

        cursor.execute(sql)
        if _current_columns(cursor, table) != expected:
            raise ValueError("호환성 출처 URL 마이그레이션 결과가 예상한 구조와 다릅니다.")
        return True


if __name__ == "__main__":
    raise SystemExit(main())
