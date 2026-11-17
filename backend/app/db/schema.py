"""Check the local MySQL connection or initialize its schema."""

import sys
from contextlib import closing
from pathlib import Path

import mysql.connector

from app.db.connection import get_connection

SCHEMA_PATH = Path(__file__).resolve().parent / "sql" / "parts_catalog.sql"


def check_connection() -> tuple[str, str]:
    """Return the selected database and server version without changing data."""
    with closing(get_connection()) as connection, closing(connection.cursor()) as cursor:
        cursor.execute("SELECT DATABASE(), VERSION()")
        database, version = cursor.fetchone()
        return database, version


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="MySQL 연결 확인 / 초기 테이블 생성")
    parser.add_argument("--init", action="store_true", help="별도 부품 DB의 parts_catalog.sql 실행")
    args = parser.parse_args()
    try:
        database, version = check_connection()
        if args.init:
            if database != "dev_database":
                raise ValueError("초기화 대상은 dev_database만 허용합니다.")
            initialize_schema()
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
    return 0


def initialize_schema() -> None:
    """Only run the reviewed CREATE script. MySQL DDL is not transactional."""
    import re

    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    definitions = re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\) ENGINE", sql, re.S)
    with closing(get_connection()) as connection, closing(connection.cursor()) as cursor:
        cursor.execute("SELECT DATABASE()")
        if cursor.fetchone()[0] != "dev_database":
            raise ValueError("초기화 대상이 dev_database가 아닙니다.")
        for table, definition in definitions:
            expected = re.findall(
                r"^    (\w+) (?:BIGINT|VARCHAR|CHAR|INT|TEXT|JSON|DECIMAL|DATETIME)\b",
                definition,
                re.M,
            )
            cursor.execute(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s ORDER BY ORDINAL_POSITION",
                (table,),
            )
            actual = [row[0] for row in cursor.fetchall()]
            if actual and actual != expected:
                raise ValueError(
                    f"{table}: 기존 컬럼이 parts_catalog.sql과 다릅니다. 별도 마이그레이션이 필요합니다."
                )
        # This script contains no stored programs or semicolons inside strings.
        for statement in sql.split(";"):
            if statement.strip():
                cursor.execute(statement)


if __name__ == "__main__":
    raise SystemExit(main())
