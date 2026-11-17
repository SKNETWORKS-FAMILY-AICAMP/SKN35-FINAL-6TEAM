"""Connection to the local dev_database PC parts database.

PARTS_MYSQL_* settings take precedence. A complete legacy MYSQL_* configuration
is accepted for the original local development database only.
"""

import os
from pathlib import Path

import mysql.connector
from dotenv import dotenv_values
from mysql.connector.abstracts import MySQLConnectionAbstract

ENV_PATH = Path(__file__).resolve().parents[3] / ".env"


def connection_settings() -> dict:
    """Read settings without changing the process environment."""
    settings = {**dotenv_values(ENV_PATH, interpolate=False), **os.environ}
    if any(key.startswith("PARTS_MYSQL_") for key in settings):
        prefix = "PARTS_MYSQL_"
    elif settings.get("MYSQL_DATABASE") == "dev_database":
        prefix = "MYSQL_"
    else:
        raise ValueError(
            ".env에 PARTS_MYSQL_* 부품 DB 설정을 입력해 주세요. docs/database/README.md 참고."
        )

    password = settings.get(prefix + "PASSWORD")
    if not password:
        raise ValueError(f".env의 {prefix}PASSWORD에 MySQL 비밀번호를 입력해 주세요.")
    try:
        port = int(settings.get(prefix + "PORT") or "3306")
    except ValueError:
        raise ValueError(f"{prefix}PORT에는 숫자 포트를 입력해 주세요.") from None
    if not 1 <= port <= 65535:
        raise ValueError(f"{prefix}PORT는 1~65535 범위여야 합니다.")

    database = settings.get(prefix + "DATABASE") or "dev_database"
    if database != "dev_database":
        raise ValueError("부품 수집 DB는 dev_database만 허용합니다.")
    return {
        "host": settings.get(prefix + "HOST") or "127.0.0.1",
        "port": port,
        "user": settings.get(prefix + "USER") or "root",
        "password": password,
        "database": database,
        "charset": "utf8mb4",
        "connection_timeout": 5,
        "autocommit": False,
        "time_zone": "+00:00",
    }


def get_connection() -> MySQLConnectionAbstract:
    """Open a connection; the caller must close it and commit any writes."""
    return mysql.connector.connect(**connection_settings())
