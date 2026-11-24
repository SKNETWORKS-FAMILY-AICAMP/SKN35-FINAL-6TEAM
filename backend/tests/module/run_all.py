"""일반 DB 검사를 포함한 모듈 테스트를 한 번에 실행합니다."""

import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True


def main() -> int:
    runner = Path(__file__).resolve().with_name("run.py")
    return subprocess.run(
        [sys.executable, "-B", str(runner), "--with-db", *sys.argv[1:]], check=False
    ).returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2) from error
