"""등록된 모듈 간 값 전달 검사를 실행하고 공통 XML/Excel을 생성합니다."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
MODULE_ROOT = Path(__file__).resolve().parent
TEST_ROOT = MODULE_ROOT.parent
sys.path[:0] = [str(TEST_ROOT), str(TEST_ROOT / "common")]
from config import PROJECT_PATH, PROJECT_PYTHON  # noqa: E402
from flow_report import enrich_report, print_connections  # noqa: E402
from report_excel import export_junit_excel  # noqa: E402
from reporting import get_repository_branch_name, new_report_identity  # noqa: E402
from runtime import validate_python_runtime  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test-id", action="append", help="catalog.json의 ID (여러 번 지정 가능)")
    parser.add_argument("--with-db", action="store_true", help="현재 DB에서 롤백 기반 검사 실행")
    parser.add_argument(
        "--full-db",
        action="store_true",
        help="DB 검사와 23,000건 이상 대량 재적재 검사 포함 (장시간)",
    )
    args = parser.parse_args()
    python = Path(PROJECT_PYTHON).expanduser().resolve()
    if not python.is_file():
        raise RuntimeError(f"PROJECT_PYTHON 실행기를 찾을 수 없습니다: {python}")
    if Path(sys.executable).resolve() != python:
        return subprocess.run(
            [str(python), "-B", str(Path(__file__).resolve()), *sys.argv[1:]], check=False
        ).returncode
    validate_python_runtime()
    root = Path(PROJECT_PATH).expanduser().resolve()
    backend = root / "backend"
    if not (backend / "pyproject.toml").is_file():
        raise RuntimeError(f"PROJECT_PATH가 올바르지 않습니다: {root}")
    catalog = json.loads((MODULE_ROOT / "catalog.json").read_text(encoding="utf-8"))
    definitions = catalog["tests"]
    ids = {entry["id"] for entry in definitions}
    if args.test_id:
        missing = set(args.test_id) - ids
        if missing:
            raise ValueError(f"등록되지 않은 모듈 테스트 ID: {', '.join(sorted(missing))}")
        definitions = [entry for entry in definitions if entry["id"] in args.test_id]
    targets = []
    for entry in definitions:
        path = (root / entry["testPath"]).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise RuntimeError(f"테스트 경로를 확인하세요: {path}")
        targets.append(str(path))
        print(f"[모듈] {entry['id']}: {entry['label']}", flush=True)
    identity = new_report_identity(
        test_type="module",
        branch_name=get_repository_branch_name(root),
        requirement_id="ALL",
        subject="value-flow-suite",
        sequence="001",
    )
    reports = TEST_ROOT / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    report = reports / identity.file_name
    before = report.stat() if report.exists() else None
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONPYCACHEPREFIX"] = str(reports / ".disabled-bytecode")
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(backend), env.get("PYTHONPATH")]))
    env["TEST_PROJECT_PATH"] = str(root)
    # DB 실행 여부는 실행 명령으로 명확히 선택하며 주변 셸의 설정에 의존하지 않습니다.
    with_db = args.with_db or args.full_db
    env["RUN_MYSQL_TESTS"] = "1" if with_db else "0"
    print(
        f"실제 DB 검사: {'실행 (종료 시 rollback)' if with_db else '미실행 (--with-db 필요)'}",
        flush=True,
    )
    command = [
        str(python),
        "-B",
        "-m",
        "pytest",
        *targets,
        "-q",
        "-p",
        "no:cacheprovider",
        "-p",
        "tests.common.assertion_details",
        "-o",
        "enable_assertion_pass_hook=true",
        "-o",
        "junit_family=xunit2",
        "-o",
        f"junit_suite_name={identity.suite_title}",
        f"--junitxml={report}",
        f"--junit-prefix={identity.junit_prefix}",
    ]
    if not args.full_db:
        command.append(
            "--deselect=backend/tests/hardware_data/test_mysql.py::MySQLTests::test_repeated_import_keeps_ids_and_rows"
        )
        command.append(
            "--deselect=tests/hardware_data/test_mysql.py::MySQLTests::test_repeated_import_keeps_ids_and_rows"
        )
        print("대량 재적재 검사 제외: --full-db에서만 실행합니다 (이번 검증 범위 밖).", flush=True)
    result = subprocess.run(command, cwd=root, env=env, check=False).returncode
    try:
        after = report.stat()
        if before and (before.st_mtime_ns, before.st_size) == (after.st_mtime_ns, after.st_size):
            raise RuntimeError("이번 실행에서 XML이 갱신되지 않았습니다.")
        print(f"모듈 연결 상세 기록: {enrich_report(report)} testcase")
        print_connections(report)
        print(f"XML: {report}")
        print(f"EXCEL: {export_junit_excel(report)}")
    except (OSError, ValueError, RuntimeError) as error:
        print(f"리포트 생성 실패: {error}", file=sys.stderr)
        return result or 2
    return result


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2) from error
