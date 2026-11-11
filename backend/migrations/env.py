"""Alembic 실행 환경. DB 주소는 app 설정(BUILDWISE_DATABASE_URL)에서 가져옵니다."""

from alembic import context
from sqlalchemy import create_engine

from app.core.config import get_settings
from app.db.models import Base

config = context.config
target_metadata = Base.metadata


def _database_url() -> str:
    # 테스트 코드가 config 에 주소를 넣어 부르면 그 주소를 씁니다.
    return config.get_main_option("sqlalchemy.url") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_database_url())
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
