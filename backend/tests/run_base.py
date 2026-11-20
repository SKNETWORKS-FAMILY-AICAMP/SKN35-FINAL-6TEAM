"""기존 단위 테스트 실행기로 기본 규약만 실행합니다."""

import sys

from common.runtime import launch_unit_tests


def main() -> int:
    return launch_unit_tests("--test-id", "unit-base-common-contract-001")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ImportError, OSError, RuntimeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2) from error
