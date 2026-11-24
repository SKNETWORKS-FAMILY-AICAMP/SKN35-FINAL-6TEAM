"""네 가지 테스트 단계가 공유하는 Python 실행 기준."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REQUIRED_PYTHON = (3, 14)


def launch_unit_tests(*arguments: str) -> int:
    """설정된 프로젝트 Python으로 단위 테스트 실행기를 호출합니다."""
    from config import PROJECT_PYTHON

    python = Path(PROJECT_PYTHON).expanduser().resolve()
    if not python.is_file():
        raise RuntimeError(f"tests/config.py의 PROJECT_PYTHON 실행기를 찾을 수 없습니다: {python}")
    version = subprocess.run(
        [str(python), "-B", "-c", "import sys; print('.'.join(map(str, sys.version_info[:2])))"],
        capture_output=True,
        text=True,
        check=False,
    )
    expected = ".".join(map(str, REQUIRED_PYTHON))
    if version.returncode != 0 or version.stdout.strip() != expected:
        raise RuntimeError(f"PROJECT_PYTHON은 프로젝트 환경 Python {expected}여야 합니다: {python}")

    runner = Path(__file__).resolve().parents[1] / "unit" / "run.py"
    print(f"프로젝트 Python: {python}", flush=True)
    return subprocess.run([str(python), "-B", str(runner), *arguments], check=False).returncode


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
