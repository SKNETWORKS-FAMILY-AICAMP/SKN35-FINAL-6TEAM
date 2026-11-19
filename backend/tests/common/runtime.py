"""네 가지 테스트 단계가 공유하는 Python 실행 기준."""

from __future__ import annotations

import sys

REQUIRED_PYTHON = (3, 14)


def validate_python_runtime() -> None:
    """Python 3.14가 아니면 테스트 산출물을 만들기 전에 중단합니다."""
    current = sys.version_info[:2]
    if current != REQUIRED_PYTHON:
        expected = ".".join(map(str, REQUIRED_PYTHON))
        actual = ".".join(map(str, current))
        raise RuntimeError(
            f"테스트 도구는 Python {expected}가 필요합니다. "
            f"현재 실행기는 Python {actual}입니다: {sys.executable}"
        )
