"""기본 규약을 포함한 전체 단위 테스트의 집계 리포트만 생성합니다."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.runtime import launch_unit_tests  # noqa: E402


def main() -> int:
    return launch_unit_tests("--all-only")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ImportError, OSError, RuntimeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2) from error
