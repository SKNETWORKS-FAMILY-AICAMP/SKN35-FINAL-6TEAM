"""시각 도우미.

MySQL DATETIME 은 시간대를 저장하지 않습니다. 그래서 DB 에는 항상 UTC 를 시간대 없이 넣고,
API 로 내보낼 때 UTC 표시를 붙입니다(app/contracts/schemas.py 의 UtcDatetime).
"""

import time
from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def monotonic_ms() -> float:
    """소요 시간 측정용. 벽시계가 아니라 단조 시계를 씁니다."""
    return time.monotonic() * 1000


def elapsed_ms(started_monotonic_ms: float) -> int:
    return max(0, round(monotonic_ms() - started_monotonic_ms))
