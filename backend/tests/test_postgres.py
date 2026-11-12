"""PostgreSQL 로 옮긴 뒤에도 동시성 규칙이 그대로인지 · pgvector 가 켜졌는지 확인합니다.

- 격리 수준 READ COMMITTED
- `SELECT ... FOR UPDATE` 로 세션 행을 잠그면 다음 사람은 기다렸다가 커밋된 최신 값을 받는다
- 여러 작업이 동시에 이벤트를 남겨도 순번(seq)에 빈 번호 · 중복이 없다
- vector 타입으로 저장하고 거리로 정렬할 수 있다(벡터 테이블 본 설계는 5주차)
"""

import threading
import time

from fastapi.testclient import TestClient
from pgvector.sqlalchemy import VECTOR
from sqlalchemy import Column, Integer, MetaData, Table, select, text

from app.contracts.schemas import EventType, WorkStatus
from app.core.db import Database
from app.events.service import append_event, list_events, lock_session
from tests.helpers import start_session


def test_isolation_level_is_read_committed(database: Database) -> None:
    with database.session() as db:
        assert db.scalar(text("SHOW transaction_isolation")) == "read committed"


def test_for_update_waits_and_then_sees_committed_value(
    client: TestClient, database: Database, companies: dict[str, int]
) -> None:
    sid = start_session(client, companies["public-demo"])
    locked = threading.Event()
    seen: dict[str, float] = {}

    def first() -> None:
        with database.transaction() as db:
            row = lock_session(db, sid)
            row.last_event_seq += 7
            locked.set()
            time.sleep(0.5)  # 잠근 채로 잠시 붙잡고 있다가 커밋

    def second() -> None:
        assert locked.wait(timeout=10)
        started = time.monotonic()
        with database.transaction() as db:
            row = lock_session(db, sid)
            seen["waited_s"] = time.monotonic() - started
            seen["seq"] = row.last_event_seq

    threads = [threading.Thread(target=first), threading.Thread(target=second)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    assert seen["seq"] == 7, "기다린 쪽은 앞 트랜잭션이 커밋한 값을 받아야 합니다"
    assert seen["waited_s"] >= 0.3, "앞 트랜잭션이 커밋할 때까지 기다려야 합니다"


def test_concurrent_appends_keep_seq_gapless(
    client: TestClient, database: Database, companies: dict[str, int]
) -> None:
    sid = start_session(client, companies["public-demo"])
    workers, per_worker = 8, 5
    barrier = threading.Barrier(workers)
    errors: list[Exception] = []

    def work(worker: int) -> None:
        try:
            barrier.wait()
            for n in range(per_worker):
                with database.transaction() as db:
                    row = lock_session(db, sid)
                    append_event(
                        db,
                        row,
                        type=EventType.task_progress,
                        status=WorkStatus.running,
                        message=f"작업 {worker}-{n}",
                    )
        except Exception as exc:  # 스레드 안 오류를 본 스레드로 넘깁니다
            errors.append(exc)

    threads = [threading.Thread(target=work, args=(i,)) for i in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    assert errors == []
    with database.session() as db:
        seqs = [e.seq for e in list_events(db, sid)]
    assert seqs == list(range(1, workers * per_worker + 1))


def test_vector_type_stores_and_orders_by_distance(database: Database) -> None:
    probe = Table(
        "vector_probe",
        MetaData(),
        Column("id", Integer, primary_key=True),
        Column("embedding", VECTOR(3)),
        prefixes=["TEMPORARY"],
    )
    with database.engine.connect() as conn:
        version = conn.scalar(text("SELECT extversion FROM pg_extension WHERE extname = 'vector'"))
        assert version, "마이그레이션이 vector 확장을 켜야 합니다"

        probe.create(conn)
        conn.execute(
            probe.insert(),
            [
                {"id": 1, "embedding": [1.0, 0.0, 0.0]},
                {"id": 2, "embedding": [0.0, 1.0, 0.0]},
                {"id": 3, "embedding": [0.9, 0.1, 0.0]},
            ],
        )
        query = [1.0, 0.0, 0.0]
        rows = conn.execute(
            select(probe.c.id, probe.c.embedding, probe.c.embedding.l2_distance(query))
            .order_by(probe.c.embedding.l2_distance(query))
            .limit(2)
        ).all()
        conn.rollback()  # 임시 테이블도 함께 사라집니다

    assert [row[0] for row in rows] == [1, 3]
    assert rows[0][1] == [1.0, 0.0, 0.0]
    assert rows[0][2] == 0.0
    assert abs(rows[1][2] - (0.1**2 + 0.1**2) ** 0.5) < 1e-4
