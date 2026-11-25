"""현재 UI를 Playwright로 검증하고 XML·Excel·화면 기록을 저장합니다."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

TEST_ROOT = Path(__file__).resolve().parent


def reachable(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return response.status < 500
    except (OSError, urllib.error.URLError) as _error:
        return False


@contextmanager
def local_servers(project: Path, python: Path, node: str, output: Path, enabled: bool):
    """이 실행기가 시작한 프로세스만 종료하며 기존 서버는 유지합니다."""
    processes = []
    logs = []
    try:
        if enabled:
            commands = [
                (
                    "backend",
                    "http://127.0.0.1:8000/openapi.json",
                    project / "backend",
                    [
                        str(python),
                        "-X",
                        "utf8",
                        "-B",
                        "-m",
                        "uvicorn",
                        "app.main:app",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        "8000",
                    ],
                ),
                (
                    "frontend",
                    "http://127.0.0.1:5173/",
                    project / "frontend",
                    [
                        node,
                        str(project / "frontend/node_modules/vite/bin/vite.js"),
                        "--host",
                        "127.0.0.1",
                    ],
                ),
            ]
            environment = os.environ.copy()
            environment.update(PYTHONIOENCODING="utf-8", BUILDWISE_CONSULTATION_PROVIDER="local")
            for name, url, cwd, command in commands:
                if reachable(url):
                    continue
                log = (output / f"{name}.log").open("w", encoding="utf-8")
                logs.append(log)
                process = subprocess.Popen(
                    command,
                    cwd=cwd,
                    env=environment,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
                processes.append(process)
                deadline = time.monotonic() + 30
                while not reachable(url):
                    if process.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError(f"{name} 시작 실패: {output / f'{name}.log'}")
                    time.sleep(0.3)
        yield
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        for log in logs:
            log.close()


def write_xml(results: dict, path: Path, title: str, prefix: str) -> None:
    cases = results["cases"]
    suite = ET.Element(
        "testsuite",
        name=title,
        tests=str(len(cases)),
        failures=str(sum(c["result"] == "Fail" for c in cases)),
        errors="0",
        skipped=str(sum(c["result"] == "Blocked" for c in cases)),
    )
    properties = ET.SubElement(suite, "properties")
    ET.SubElement(
        properties,
        "property",
        name="verification.scope",
        value="현재 UI 시스템 검증 · 실제 인증/음성/결제 검증 제외",
    )
    for case in cases:
        case = {
            key: re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value)
            if isinstance(value, str)
            else value
            for key, value in case.items()
        }
        element = ET.SubElement(
            suite, "testcase", name=case["id"], classname=prefix, time=str(case["seconds"])
        )
        if case["result"] != "Pass":
            ET.SubElement(
                element,
                "failure" if case["result"] == "Fail" else "skipped",
                message=case["detail"],
            ).text = case["detail"]
        case_properties = ET.SubElement(element, "properties")
        fields = {
            "target": case["id"],
            "criterion": case["expected"],
            "expected": case["expected"],
            "actual": case["detail"],
            "precondition": case.get(
                "precondition", "localhost 현재 UI · 기업은 시연 데이터 · 개인은 실제 API"
            ),
            "method": "Playwright 브라우저 조작과 DOM/API 응답 확인",
            "exclusions": "실제 인증·음성·결제·추천 품질 평가 제외",
            "location": "backend/tests/system_acceptance/playwright/functional.mjs"
            if case["id"].startswith("BW-")
            else "backend/tests/system_acceptance/playwright/ui.mjs",
            "checks": json.dumps(
                [
                    {
                        "item": case["id"],
                        "expected": case["expected"],
                        "actual": case["detail"],
                        "result": case["result"],
                        "evidence": str(results.get("output", ""))
                        + "/"
                        + case.get("screenshot", ""),
                    }
                ],
                ensure_ascii=False,
            ),
        }
        for key, value in fields.items():
            ET.SubElement(case_properties, "property", name=key, value=value)
        ET.SubElement(element, "system-out").text = json.dumps(
            {
                "expected": case["expected"],
                "actual": case["detail"],
                "screenshot": case.get("screenshot", ""),
            },
            ensure_ascii=False,
        )
    ET.indent(suite)
    ET.ElementTree(suite).write(path, encoding="utf-8", xml_declaration=True)


def main() -> int:
    from config import PROJECT_PATH, PROJECT_PYTHON

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:5173")
    parser.add_argument(
        "--scope", choices=("ui", "consultation", "all", "functional"), default="all"
    )
    parser.add_argument("--headed", action="store_true", help="브라우저 창 표시")
    parser.add_argument("--slow-mo", type=int, default=0, help="조작 사이 지연(ms)")
    parser.add_argument("--browser", choices=("chrome", "msedge", "chromium"), default="chrome")
    parser.add_argument("--node", default=shutil.which("node"), help="Node 실행기 경로")
    parser.add_argument("--start-server", action="store_true", help="없는 로컬 서버만 시작 후 종료")
    parser.add_argument(
        "--case-id", action="append", default=[], help="functional에서 특정 TC만 재실행"
    )
    args = parser.parse_args()
    project = Path(PROJECT_PATH).resolve()
    python = Path(PROJECT_PYTHON).resolve()
    if Path(sys.executable).resolve() != python:
        return subprocess.run(
            [str(python), "-X", "utf8", "-B", str(__file__), *sys.argv[1:]], check=False
        ).returncode
    from common.report_excel import export_junit_excel
    from common.reporting import get_repository_branch_name, new_report_identity
    from common.runtime import validate_project_layout, validate_python_runtime

    validate_python_runtime()
    validate_project_layout(project, TEST_ROOT)
    if not args.node or not Path(args.node).is_file():
        raise RuntimeError("Node 실행기가 필요합니다. --node로 지정하세요. 자동 설치하지 않습니다.")
    if urlparse(args.base_url).hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("이 실행기는 로컬 테스트 주소만 허용합니다.")
    if args.start_server and args.base_url.rstrip("/") != "http://127.0.0.1:5173":
        raise ValueError("--start-server는 기본 주소 http://127.0.0.1:5173 에서 사용하세요.")
    if args.case_id:
        if args.scope != "functional":
            raise ValueError("--case-id는 --scope functional에서 사용하세요.")
        catalog = json.loads(
            (TEST_ROOT / "system_acceptance/playwright/functional-cases.json").read_text(
                encoding="utf-8"
            )
        )
        unknown = set(args.case_id) - {case["id"] for case in catalog}
        if unknown:
            raise ValueError("등록되지 않은 TC ID: " + ", ".join(sorted(unknown)))
    if args.slow_mo < 0:
        raise ValueError("--slow-mo는 0 이상이어야 합니다.")

    identity = new_report_identity(
        test_type="system",
        branch_name=get_repository_branch_name(project),
        requirement_id="ALL",
        subject=f"playwright-{args.scope}" + ("-retry" if args.case_id else ""),
        sequence="001",
    )
    reports = TEST_ROOT / "reports"
    reports.mkdir(exist_ok=True)
    output = reports / f"{Path(identity.file_name).stem}_{datetime.now():%H%M%S_%f}"
    output.mkdir()
    command = [
        args.node,
        str(
            TEST_ROOT
            / "system_acceptance/playwright"
            / ("functional.mjs" if args.scope == "functional" else "ui.mjs")
        ),
        str(project),
        str(output),
        args.base_url,
        args.scope,
        str(args.slow_mo),
        args.browser,
        str(args.headed).lower(),
        ",".join(args.case_id),
    ]
    with local_servers(project, python, args.node, output, args.start_server):
        if not reachable(args.base_url):
            raise RuntimeError(
                "프론트 서버가 없습니다. 서버 실행 후 재시도하거나 --start-server를 사용하세요."
            )
        completed = subprocess.run(command, cwd=project, check=False)
    result_path = output / "results.json"
    if not result_path.is_file():
        raise RuntimeError(f"브라우저 결과가 생성되지 않았습니다: {output}")
    results = json.loads(result_path.read_text(encoding="utf-8"))
    results["output"] = str(output)
    xml = reports / identity.file_name
    write_xml(results, xml, identity.suite_title, identity.junit_prefix)
    excel = export_junit_excel(xml)
    print(f"XML: {xml}\nEXCEL: {excel}\n화면·버튼 로그·Trace·HTML: {output}", flush=True)
    blocked = any(c["result"] == "Blocked" for c in results["cases"])
    return completed.returncode or (2 if blocked else 0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        raise SystemExit(main())
    except (ImportError, OSError, RuntimeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2) from error
