"""DB 연결 (PostgreSQL 18 + pgvector, 드라이버 psycopg 3).

- 격리 수준은 READ COMMITTED 입니다(PostgreSQL 기본값과 같지만 명시합니다). 문장마다 새 스냅샷을 보므로
  이벤트를 주기적으로 다시 읽는 화면 스트림이 예전 스냅샷에 갇히지 않습니다.
- 순서가 중요한 쓰기(이벤트 순번 · 요구사항 버전 확인)는 세션 행을 `SELECT ... FOR UPDATE` 로
  잠그고 합니다(app/events/service.py 의 lock_session). 기다리던 쪽은 앞 트랜잭션이 커밋한 최신 값을 받습니다.
- PostgreSQL 은 오류(예: 유니크 위반)가 난 트랜잭션을 더 쓰지 못하게 막습니다. 오류 뒤에는 롤백하고
  새 트랜잭션에서 다시 읽습니다(app/orders/service.py).
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker


class Database:
    def __init__(self, url: str, pool_size: int = 10) -> None:
        self.engine = create_engine(
            url,
            pool_pre_ping=True,
            pool_size=pool_size,
            max_overflow=10,
            pool_recycle=1800,
            isolation_level="READ COMMITTED",
        )
        self.session_factory = sessionmaker(self.engine, expire_on_commit=False)

    def session(self) -> Session:
        return self.session_factory()

    @contextmanager
    def transaction(self) -> Iterator[Session]:
        """with 블록이 정상으로 끝나면 커밋, 예외가 나면 롤백합니다."""
        with self.session_factory() as db, db.begin():
            yield db

    def ping(self) -> bool:
        try:
            with self.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    def dispose(self) -> None:
        self.engine.dispose()
