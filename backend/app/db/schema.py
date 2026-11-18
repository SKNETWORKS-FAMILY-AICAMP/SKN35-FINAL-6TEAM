"""Check, initialize, or migrate the local MySQL parts schema."""

import re
import sys
from contextlib import closing
from pathlib import Path

import mysql.connector

from app.db.connection import get_connection

SCHEMA_PATH = Path(__file__).resolve().parent / "sql" / "parts_catalog.sql"
PAID_QUOTES_MIGRATION_PATH = SCHEMA_PATH.parent / "migrations" / "005_paid_quotes.sql"
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
    args = parser.parse_args()
    try:
        database, version = check_connection()
        if args.init:
            if database != "dev_database":
                raise ValueError("초기화 대상은 dev_database만 허용합니다.")
            initialize_schema()
        if args.migrate_paid_quotes:
            migrated = migrate_paid_quotes()
    except ValueError as error:
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


if __name__ == "__main__":
    raise SystemExit(main())
