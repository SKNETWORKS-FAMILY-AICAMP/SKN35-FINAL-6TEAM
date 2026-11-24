"""기존 assertion의 비교 요소를 계층화합니다. 판정 규칙은 변경하지 않습니다."""

from __future__ import annotations

import ast
import json
from pathlib import Path


def comparison_items(expected: object, actual: object, path: str = "$") -> list[dict]:
    """등가 비교의 키·배열 위치·말단 값을 추가 테스트가 아닌 내역으로 기록합니다."""

    def item(name, want, got, passed):
        return {
            "item": name,
            "expected": want,
            "actual": got,
            "result": "일치" if passed else "불일치",
            "evidence": "상위 테스트 등가 비교의 내역이며 독립된 pytest 실행이 아닙니다.",
        }

    if isinstance(expected, dict) and isinstance(actual, dict):
        rows = []
        for key in sorted(expected.keys() | actual.keys()):
            child = f"{path}.{key}"
            if key not in expected:
                rows.append(item(child, "키 없음", actual[key], False))
            elif key not in actual:
                rows.append(item(child, expected[key], "키 없음", False))
            else:
                rows.extend(comparison_items(expected[key], actual[key], child))
        return rows or [item(path, expected, actual, expected == actual)]
    if isinstance(expected, (list, tuple)) and isinstance(actual, (list, tuple)):
        rows = [item(f"{path}.요소수", len(expected), len(actual), len(expected) == len(actual))]
        for index in range(max(len(expected), len(actual))):
            child = f"{path}[{index}]"
            if index >= len(expected):
                rows.append(item(child, "요소 없음", actual[index], False))
            elif index >= len(actual):
                rows.append(item(child, expected[index], "요소 없음", False))
            else:
                rows.extend(comparison_items(expected[index], actual[index], child))
        return rows
    return [item(path, expected, actual, expected == actual)]


def resolve_route_evidence(project_root: Path) -> dict[str, dict]:
    """문자열 상수 prefix만 읽습니다. 앱 실행이나 미해결 값 추측은 하지 않습니다."""
    routes = {}
    for file in (project_root / "backend/app").rglob("*.py"):
        try:
            tree = ast.parse(file.read_text(encoding="utf-8"))
        except OSError, UnicodeError, SyntaxError:
            continue
        constants = {}
        routers = {}
        for node in tree.body:
            if (
                isinstance(node, ast.Assign)
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)
            ):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        constants[target.id] = node.value.value
        for node in tree.body:
            if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Call):
                continue
            function = node.value.func
            name = function.id if isinstance(function, ast.Name) else getattr(function, "attr", "")
            if name != "APIRouter":
                continue
            for keyword in node.value.keywords:
                if (
                    keyword.arg == "prefix"
                    and isinstance(keyword.value, ast.Name)
                    and keyword.value.id in constants
                ):
                    for target in node.targets:
                        if isinstance(target, ast.Name):
                            routers[target.id] = (keyword.value.id, constants[keyword.value.id])
        for node in tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for deco in node.decorator_list:
                if (
                    not isinstance(deco, ast.Call)
                    or not isinstance(deco.func, ast.Attribute)
                    or not isinstance(deco.func.value, ast.Name)
                    or not deco.args
                ):
                    continue
                receiver = deco.func.value.id
                if (
                    receiver not in routers
                    or not isinstance(deco.args[0], ast.Constant)
                    or not isinstance(deco.args[0].value, str)
                ):
                    continue
                variable, prefix = routers[receiver]
                suffix = deco.args[0].value.strip("/")
                raw = f"{deco.func.attr.upper()} /{variable}/{suffix}".rstrip("/")
                resolved = f"{deco.func.attr.upper()} /{prefix.strip('/')}/{suffix}".rstrip("/")
                routes[raw] = {
                    "source": f"{file.relative_to(project_root).as_posix()}:{node.lineno}",
                    "constant": f"{variable} = {prefix!r}",
                    "resolved": resolved,
                }
    return routes


def breaking_items(changes: list[dict], section: str, project_root: Path) -> list[dict]:
    if not changes:
        return [
            {
                "item": f"{section}.breakingChanges",
                "expected": [],
                "actual": [],
                "result": "일치",
                "evidence": "Breaking 목록이 비었습니다. 실제 API 접속 성공이나 환경변수 값 유효성을 뜻하지 않습니다.",
            }
        ]
    evidence = resolve_route_evidence(project_root) if section == "api" else {}
    # Saved contract is read only. No app imports, credentials, or network requests.
    try:
        saved = (
            json.loads((project_root / "contracts/openapi.json").read_text(encoding="utf-8"))
            if section == "api"
            else {}
        )
    except OSError, ValueError:
        saved = {}
    operations = {
        f"{method.upper()} {path}"
        for path, methods in saved.get("paths", {}).items()
        for method in methods
        if method.lower() in {"get", "post", "put", "patch", "delete", "head", "options", "trace"}
    }
    rows = []
    for change in changes:
        key = str(change.get("key", ""))
        detail = {
            "observed": change,
            "scope": "프로젝트 계약 비교입니다. OpenAI 키 인증·외부 API 연결은 실행하지 않았습니다.",
        }
        if key in evidence:
            detail["source_evidence"] = evidence[key]
            detail["collector_limitation"] = (
                "수집 키에 상수 이름이 남아 있습니다. 실제 URL로 단정하지 않습니다."
            )
            detail["resolved_operation_in_saved_spec"] = (
                evidence[key]["resolved"] in operations
                if "paths" in saved
                else "명세를 읽지 못해 확인 불가"
            )
            detail["next_check"] = (
                "수집기의 상수 해석을 확인하고 저장 OpenAPI와 실행 앱의 정의를 대조하세요. 계약 갱신은 별도 승인이 필요합니다."
            )
        else:
            detail["next_check"] = (
                "해당 키의 소스·기준 인벤토리·저장 계약을 확인하세요. 이 기록만으로 원인을 단정하지 않습니다."
            )
        rows.append(
            {
                "item": key,
                "expected": "Breaking 없음",
                "actual": change.get("change", ""),
                "result": "불일치",
                "evidence": detail,
            }
        )
    return rows
