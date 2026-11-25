"""읽기 합성 글자 수 원장. 공급자를 부르기 전에 예약하고, 서버를 다시 켜도 남습니다."""

import sqlite3
from collections import OrderedDict, deque
from collections.abc import Callable
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from time import monotonic

# 한국은 서머타임이 없어 고정 시차로 충분합니다(Windows 에는 tz 데이터가 없을 수 있습니다).
KST = timezone(timedelta(hours=9), "KST")


class BudgetExceeded(Exception):
    def __init__(self, message: str, retry_after: int):
        super().__init__(message)
        self.retry_after = retry_after


class UsageLedger:
    """하루 상한과 누적 상한을 함께 봅니다. 실패한 합성도 환급하지 않습니다."""

    def __init__(
        self,
        path: Path,
        *,
        daily_chars: int,
        total_chars: int,
        now: Callable[[], datetime] = lambda: datetime.now(KST),
    ):
        self.path = path
        self.daily_chars = daily_chars
        self.total_chars = total_chars
        self._now = now
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing_connection(path) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS speech_usage (day TEXT PRIMARY KEY, chars INTEGER NOT NULL)"
            )

    def reserve(self, chars: int) -> None:
        now = self._now().astimezone(KST)
        day = now.date().isoformat()
        with closing_connection(self.path) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                row = connection.execute(
                    "SELECT chars FROM speech_usage WHERE day = ?", (day,)
                ).fetchone()
                today = row[0] if row else 0
                total = connection.execute(
                    "SELECT COALESCE(SUM(chars), 0) FROM speech_usage"
                ).fetchone()[0]
                if total + chars > self.total_chars:
                    raise BudgetExceeded(
                        "음성 합성 누적 한도에 도달했습니다. 브라우저 음성으로 읽습니다.", 24 * 3600
                    )
                if today + chars > self.daily_chars:
                    tomorrow = datetime.combine(
                        now.date() + timedelta(days=1), datetime.min.time(), KST
                    )
                    raise BudgetExceeded(
                        "오늘 음성 합성 한도에 도달했습니다. 브라우저 음성으로 읽습니다.",
                        max(1, int((tomorrow - now).total_seconds())),
                    )
                connection.execute(
                    "INSERT INTO speech_usage (day, chars) VALUES (?, ?) "
                    "ON CONFLICT(day) DO UPDATE SET chars = chars + excluded.chars",
                    (day, chars),
                )
            except BaseException:
                connection.execute("ROLLBACK")
                raise
            connection.execute("COMMIT")

    def used(self) -> tuple[int, int]:
        """(오늘, 누적) 글자 수."""
        day = self._now().astimezone(KST).date().isoformat()
        with closing_connection(self.path) as connection:
            row = connection.execute(
                "SELECT chars FROM speech_usage WHERE day = ?", (day,)
            ).fetchone()
            total = connection.execute(
                "SELECT COALESCE(SUM(chars), 0) FROM speech_usage"
            ).fetchone()[0]
        return (row[0] if row else 0), total


class SessionMeter:
    """상담 세션마다 합성 글자와 요청 빈도를 셉니다. 세션이 실제로 받은 답 글자에 예산을 묶습니다."""

    def __init__(
        self,
        *,
        ratio: int = 3,
        allowance: int = 300,
        per_minute: int = 40,
        max_sessions: int = 512,
        clock: Callable[[], float] = monotonic,
    ):
        self.ratio = ratio
        self.allowance = allowance
        self.per_minute = per_minute
        self.max_sessions = max_sessions
        self._clock = clock
        self._used: OrderedDict[str, int] = OrderedDict()
        self._hits: dict[str, deque[float]] = {}
        self._lock = Lock()

    def hit(self, session: str) -> None:
        """요청 빈도. 캐시 적중도 셉니다."""
        now = self._clock()
        with self._lock:
            hits = self._hits.setdefault(session, deque())
            while hits and now - hits[0] >= 60:
                hits.popleft()
            if len(hits) >= self.per_minute:
                raise BudgetExceeded(
                    "음성 요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.",
                    max(1, int(60 - (now - hits[0])) + 1),
                )
            hits.append(now)
            self._remember(session)

    def check(self, session: str, answer_chars: int, chars: int) -> None:
        with self._lock:
            if self._used.get(session, 0) + chars > answer_chars * self.ratio + self.allowance:
                raise BudgetExceeded("이 상담의 음성 합성 한도에 도달했습니다.", 30)

    def charge(self, session: str, answer_chars: int, chars: int) -> None:
        with self._lock:
            used = self._used.get(session, 0)
            if used + chars > answer_chars * self.ratio + self.allowance:
                raise BudgetExceeded("이 상담의 음성 합성 한도에 도달했습니다.", 30)
            self._used[session] = used + chars
            self._remember(session)

    def _remember(self, session: str) -> None:
        self._used.setdefault(session, 0)
        self._used.move_to_end(session)
        while len(self._used) > self.max_sessions:
            old, _ = self._used.popitem(last=False)
            self._hits.pop(old, None)


def closing_connection(path: Path) -> closing[sqlite3.Connection]:
    return closing(sqlite3.connect(path, timeout=5, isolation_level=None))
