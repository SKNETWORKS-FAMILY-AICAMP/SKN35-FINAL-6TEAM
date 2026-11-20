"""catalog.json에 등록된 단위 테스트를 실행하고 XML 결과를 생성합니다."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import re
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

UNIT_ROOT = Path(__file__).resolve().parent
TEST_ROOT = UNIT_ROOT.parent
COMMON_ROOT = TEST_ROOT / "common"
REPORT_ROOT = TEST_ROOT / "report"

sys.path.insert(0, str(COMMON_ROOT))
from config import PROJECT_PATH  # noqa: E402
from discover import write_inventory  # noqa: E402
from reporting import get_repository_branch_name, new_report_identity  # noqa: E402
from runtime import validate_python_runtime  # noqa: E402

EXACT_DEPENDENCY_PATTERN = re.compile(r"^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?==([^;\s]+)\s*$")


def load_catalog() -> dict[str, Any]:
    catalog_path = UNIT_ROOT / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    definitions = catalog.get("tests", [])
    if not definitions:
        raise RuntimeError(f"등록된 단위 테스트가 없습니다: {catalog_path}")
    return catalog


def validate_backend_test_classification(
    repository_root: Path,
    definitions: list[dict[str, Any]],
    classified_elsewhere: list[dict[str, Any]],
) -> None:
    backend_tests_root = repository_root / "backend" / "tests"
    if not backend_tests_root.is_dir():
        raise RuntimeError(f"백엔드 테스트 폴더를 찾을 수 없습니다: {backend_tests_root}")

    discovered_files = {
        path.relative_to(repository_root).as_posix()
        for pattern in ("test_*.py", "*_test.py")
        for path in backend_tests_root.rglob(pattern)
        if path.is_file()
    }
    unit_files = {
        Path(definition["testPath"]).as_posix()
        for definition in definitions
        if definition.get("targetRoot") == "project"
        and Path(definition["testPath"]).as_posix().startswith("backend/tests/")
    }
    for definition in definitions:
        if definition.get("targetRoot") != "harness":
            continue
        harness_target = UNIT_ROOT / Path(definition["testPath"])
        patterns = ("test_*.py", "*_test.py")
        harness_files = (
            {harness_target}
            if harness_target.is_file()
            else {
                path
                for pattern in patterns
                for path in harness_target.rglob(pattern)
                if path.is_file()
            }
        )
        unit_files.update(path.relative_to(repository_root).as_posix() for path in harness_files)
    other_files = {
        Path(classification["testPath"]).as_posix() for classification in classified_elsewhere
    }

    overlapping = sorted(unit_files & other_files)
    unclassified = sorted(discovered_files - unit_files - other_files)
    missing = sorted((unit_files | other_files) - discovered_files)
    problems: list[str] = []
    if overlapping:
        problems.append(f"단위·타 단계 중복 분류: {', '.join(overlapping)}")
    if unclassified:
        problems.append(f"미분류 백엔드 테스트: {', '.join(unclassified)}")
    if missing:
        problems.append(f"존재하지 않는 분류 대상: {', '.join(missing)}")
    if problems:
        raise RuntimeError("\n".join(problems))


def select_definitions(
    definitions: list[dict[str, Any]], requested_ids: list[str] | None
) -> list[dict[str, Any]]:
    if not requested_ids:
        return definitions

    definitions_by_id = {definition["id"]: definition for definition in definitions}
    missing_ids = [test_id for test_id in requested_ids if test_id not in definitions_by_id]
    if missing_ids:
        raise RuntimeError(f"단위 테스트 ID를 찾을 수 없습니다: {', '.join(missing_ids)}")
    return [definitions_by_id[test_id] for test_id in requested_ids]


def validate_project_paths(repository_root: Path, definition: dict[str, Any]) -> None:
    for relative_path in definition.get("requiredProjectPaths", []):
        required_path = repository_root / Path(relative_path)
        if not required_path.exists():
            raise RuntimeError(f"단위 테스트에 필요한 경로를 찾을 수 없습니다: {required_path}")


def validate_installed_dependencies(backend_project: Path) -> None:
    project_config = tomllib.loads((backend_project / "pyproject.toml").read_text(encoding="utf-8"))
    dependency_specs = list(project_config["project"].get("dependencies", []))
    dependency_specs.extend(project_config.get("dependency-groups", {}).get("dev", []))

    problems: list[str] = []
    for dependency_spec in dependency_specs:
        match = EXACT_DEPENDENCY_PATTERN.fullmatch(dependency_spec)
        if match is None:
            problems.append(f"정확한 버전 규약이 아님: {dependency_spec}")
            continue

        package_name, expected_version = match.groups()
        try:
            installed_version = importlib.metadata.version(package_name)
        except importlib.metadata.PackageNotFoundError:
            problems.append(f"미설치: {package_name}=={expected_version}")
            continue
        if installed_version != expected_version:
            problems.append(
                f"버전 불일치: {package_name}=={installed_version} (필요: {expected_version})"
            )

    if problems:
        details = "\n- ".join(problems)
        raise RuntimeError(
            "현재 Python에 테스트 의존성이 정확히 준비되어 있지 않습니다. "
            "run.py는 가상환경 생성이나 패키지 설치를 하지 않습니다.\n"
            f"Python: {sys.executable}\n- {details}"
        )


def resolve_test_target(*, repository_root: Path, definition: dict[str, Any]) -> Path:
    validate_project_paths(repository_root, definition)

    target_root = definition.get("targetRoot", "harness")
    test_path = Path(definition["testPath"])
    if target_root == "harness":
        test_target = UNIT_ROOT / test_path
    elif target_root == "project":
        test_target = repository_root / test_path
    else:
        raise RuntimeError(
            f"지원하지 않는 테스트 대상 기준입니다: {target_root} ({definition['id']})"
        )
    if not test_target.exists():
        raise RuntimeError(f"단위 테스트 대상을 찾을 수 없습니다: {test_target}")
    if not test_target.is_dir() and test_target.suffix != ".py":
        raise RuntimeError(f"지원하지 않는 단위 테스트 대상입니다: {test_target}")
    return test_target


def run_test(
    *,
    repository_root: Path,
    backend_project: Path,
    branch_name: str,
    definition: dict[str, Any],
    runtime_environment: dict[str, str],
) -> int:
    test_target = resolve_test_target(repository_root=repository_root, definition=definition)

    report_identity = new_report_identity(
        test_type="unit",
        branch_name=branch_name,
        requirement_id=definition["requirementId"],
        subject=definition["subject"],
        sequence=definition["sequence"],
    )
    report_path = REPORT_ROOT / report_identity.file_name

    print(f"\n[단위] {definition['label']}")
    command = [
        sys.executable,
        "-B",
        "-m",
        "pytest",
        str(test_target),
        "-q",
        "-p",
        "no:cacheprovider",
        "-o",
        "junit_family=xunit2",
        "-o",
        f"junit_suite_name={report_identity.suite_title}",
        f"--junitxml={report_path}",
        f"--junit-prefix={report_identity.junit_prefix}",
    ]
    environment = runtime_environment.copy()
    environment["TEST_PROJECT_PATH"] = str(repository_root)
    existing_python_path = environment.get("PYTHONPATH")
    python_path_entries = [str(backend_project)]
    if existing_python_path:
        python_path_entries.append(existing_python_path)
    environment["PYTHONPATH"] = os.pathsep.join(python_path_entries)

    completed = subprocess.run(command, cwd=repository_root, env=environment, check=False)
    result = "PASS" if completed.returncode == 0 else "FAIL"
    print(f"{result}: {report_path}")
    return completed.returncode


def run_all_unit_tests(
    *,
    repository_root: Path,
    backend_project: Path,
    branch_name: str,
    definitions: list[dict[str, Any]],
    runtime_environment: dict[str, str],
) -> int:
    test_targets = [
        resolve_test_target(repository_root=repository_root, definition=definition)
        for definition in definitions
    ]
    report_identity = new_report_identity(
        test_type="unit",
        branch_name=branch_name,
        requirement_id="ALL",
        subject="backend-suite",
        sequence="001",
    )
    report_path = REPORT_ROOT / report_identity.file_name

    print("\n[단위] 전체 단위 테스트")
    for definition in definitions:
        print(f"- {definition['label']}: {definition['testPath']}")

    command = [
        sys.executable,
        "-B",
        "-m",
        "pytest",
        *(str(test_target) for test_target in test_targets),
        "-q",
        "-p",
        "no:cacheprovider",
        "-o",
        "junit_family=xunit2",
        "-o",
        f"junit_suite_name={report_identity.suite_title}",
        f"--junitxml={report_path}",
        f"--junit-prefix={report_identity.junit_prefix}",
    ]
    environment = runtime_environment.copy()
    environment["TEST_PROJECT_PATH"] = str(repository_root)
    existing_python_path = environment.get("PYTHONPATH")
    python_path_entries = [str(backend_project)]
    if existing_python_path:
        python_path_entries.append(existing_python_path)
    environment["PYTHONPATH"] = os.pathsep.join(python_path_entries)

    completed = subprocess.run(command, cwd=repository_root, env=environment, check=False)
    result = "PASS" if completed.returncode == 0 else "FAIL"
    print(f"{result}: {report_path}")
    return completed.returncode


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="등록된 단위 테스트를 실행합니다.")
    parser.add_argument(
        "--test-id",
        action="append",
        help=(
            "특정 테스트만 개별 XML로 실행할 때 지정합니다. "
            "생략하면 BASE 1개와 ALL 1개를 생성합니다."
        ),
    )
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    validate_python_runtime()
    repository_root = Path(PROJECT_PATH).expanduser().resolve()
    if not repository_root.is_dir():
        raise RuntimeError(
            f"config.py의 PROJECT_PATH가 올바른 프로젝트 폴더가 아닙니다: {repository_root}"
        )

    backend_project = repository_root / "backend"
    if not (backend_project / "pyproject.toml").is_file():
        raise RuntimeError(f"백엔드 프로젝트 설정을 찾을 수 없습니다: {backend_project}")

    inventory = write_inventory(repository_root)
    inventory_summary = inventory["summary"]
    print(
        "코드 수집: 심볼 {symbols}개, 단위 테스트 후보 {candidates}개, "
        "미참조 후보 {candidatesWithoutUnitReference}개".format(**inventory_summary)
    )
    comparison = inventory["comparison"]
    comparison_summary = comparison["summary"]
    print(
        "기준 비교({status}): 추가 {added}개, 삭제 {removed}개, 변경 {changed}개, "
        "테스트 미참조 신규 후보 {uncoveredAddedCandidates}개".format(
            status=comparison["status"],
            **comparison_summary,
        )
    )
    contract_summary = inventory["contractComparison"]["summary"]
    print(
        "환경·API 계약: 환경 Breaking {environmentBreaking}개, API Breaking {apiBreaking}개".format(
            **contract_summary
        )
    )
    validate_installed_dependencies(backend_project)

    catalog = load_catalog()
    definitions = catalog["tests"]
    validate_backend_test_classification(
        repository_root,
        definitions,
        catalog.get("classifiedElsewhere", []),
    )
    branch_name = get_repository_branch_name(repository_root)
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)

    failed_tests: list[str] = []
    runtime_environment = os.environ.copy()
    runtime_environment["PYTHONDONTWRITEBYTECODE"] = "1"
    if arguments.test_id:
        selected_definitions = select_definitions(definitions, arguments.test_id)
        for definition in selected_definitions:
            if (
                run_test(
                    repository_root=repository_root,
                    backend_project=backend_project,
                    branch_name=branch_name,
                    definition=definition,
                    runtime_environment=runtime_environment,
                )
                != 0
            ):
                failed_tests.append(definition["id"])
    else:
        base_definitions = [
            definition for definition in definitions if definition["requirementId"] == "BASE"
        ]
        if len(base_definitions) != 1:
            raise RuntimeError(
                "기본 실행에는 requirementId가 BASE인 테스트가 정확히 1개여야 합니다."
            )
        if (
            run_test(
                repository_root=repository_root,
                backend_project=backend_project,
                branch_name=branch_name,
                definition=base_definitions[0],
                runtime_environment=runtime_environment,
            )
            != 0
        ):
            failed_tests.append(base_definitions[0]["id"])
        if (
            run_all_unit_tests(
                repository_root=repository_root,
                backend_project=backend_project,
                branch_name=branch_name,
                definitions=definitions,
                runtime_environment=runtime_environment,
            )
            != 0
        ):
            failed_tests.append("unit-all-backend-suite-001")

    if failed_tests:
        print(f"\n실패한 단위 테스트: {', '.join(failed_tests)}")
        return 1

    print(f"\n선택한 단위 테스트가 모두 통과했습니다. 결과: {REPORT_ROOT}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2) from error
