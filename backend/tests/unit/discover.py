"""현재 프로젝트에서 단위 테스트 후보를 최대한 수집합니다."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

UNIT_ROOT = Path(__file__).resolve().parent
TEST_ROOT = UNIT_ROOT.parent
COMMON_ROOT = TEST_ROOT / "common"
sys.path.insert(0, str(TEST_ROOT))
sys.path.insert(0, str(COMMON_ROOT))

from config import PROJECT_PATH  # noqa: E402
from runtime import REQUIRED_PYTHON, validate_python_runtime  # noqa: E402

DEFAULT_OUTPUT = UNIT_ROOT / "inventory.json"
DEFAULT_BASELINE = UNIT_ROOT / "inventory_baseline.json"
SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx"}
EXCLUDED_DIRECTORIES = {
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
}
TEST_DIRECTORIES = {"tests", "__tests__", "e2e"}
ENV_NAME_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")
JS_ENV_PATTERN = re.compile(r"\b(?:process\.env|import\.meta\.env)\.(?P<name>[A-Z][A-Z0-9_]*)")
API_METHODS = {"delete", "get", "head", "options", "patch", "post", "put"}
OPENAPI_METADATA_KEYS = {
    "description",
    "example",
    "examples",
    "externalDocs",
    "operationId",
    "summary",
    "tags",
    "title",
}
FINGERPRINT_FIELDS = (
    "language",
    "source",
    "qualifiedName",
    "kind",
    "visibility",
    "exported",
    "async",
    "decorators",
    "candidate",
    "strategy",
    "parameters",
    "keywordOnlyParameters",
    "hasVarArgs",
    "hasKeywordArgs",
    "returnAnnotation",
    "baseClasses",
    "classFields",
    "enumValues",
    "methodCount",
    "parameterSignature",
    "propsType",
    "props",
    "hooks",
    "eventHandlers",
    "childComponents",
    "externalDependencies",
    "localDependencies",
)


def relative_path(path: Path, project_root: Path) -> str:
    return path.relative_to(project_root).as_posix()


def is_excluded(path: Path) -> bool:
    return any(part in EXCLUDED_DIRECTORIES for part in path.parts)


def is_test_file(path: Path) -> bool:
    lowered_name = path.name.lower()
    return (
        any(part.lower() in TEST_DIRECTORIES for part in path.parts)
        or lowered_name.startswith("test_")
        or ".test." in lowered_name
        or ".spec." in lowered_name
    )


def is_unit_test_file(path: Path) -> bool:
    lowered_parts = {part.lower() for part in path.parts}
    return is_test_file(path) and "e2e" not in lowered_parts


def area_hint(source: str) -> str:
    parts = source.split("/")
    if "features" in parts:
        index = parts.index("features")
        if index + 1 < len(parts):
            return parts[index + 1]
    if "app" in parts:
        index = parts.index("app")
        if index + 1 < len(parts):
            return parts[index + 1]
    return parts[0] if parts else "unknown"


def requirement_hint(source: str) -> str | None:
    return "BASE" if source.startswith("backend/app/contracts/") else None


def load_test_documents(
    project_root: Path, source_files: list[Path]
) -> list[tuple[str, str, bool]]:
    documents: list[tuple[str, str, bool]] = []
    for path in source_files:
        if not is_test_file(path):
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            continue
        except UnicodeDecodeError:
            continue
        documents.append(
            (
                relative_path(path, project_root),
                content,
                is_unit_test_file(path),
            )
        )
    return documents


def referenced_tests(
    symbol_name: str, test_documents: list[tuple[str, str, bool]]
) -> tuple[list[str], list[str]]:
    pattern = re.compile(rf"(?<![\w$]){re.escape(symbol_name)}(?![\w$])")
    all_references: list[str] = []
    unit_references: list[str] = []
    for path, content, is_unit in test_documents:
        if pattern.search(content):
            all_references.append(path)
            if is_unit:
                unit_references.append(path)
    return sorted(all_references), sorted(unit_references)


def python_decorator_name(decorator: ast.expr) -> str:
    if isinstance(decorator, ast.Name):
        return decorator.id
    if isinstance(decorator, ast.Attribute):
        return decorator.attr
    if isinstance(decorator, ast.Call):
        return python_decorator_name(decorator.func)
    return type(decorator).__name__


def python_call_name(call: ast.Call) -> str | None:
    target = call.func
    if isinstance(target, ast.Name):
        return target.id
    if isinstance(target, ast.Attribute):
        parts = [target.attr]
        value = target.value
        while isinstance(value, ast.Attribute):
            parts.append(value.attr)
            value = value.value
        if isinstance(value, ast.Name):
            parts.append(value.id)
        return ".".join(reversed(parts))
    return None


def python_complexity_hint(node: ast.AST) -> int:
    branch_nodes = (
        ast.BoolOp,
        ast.ExceptHandler,
        ast.For,
        ast.If,
        ast.IfExp,
        ast.Match,
        ast.Try,
        ast.While,
        ast.comprehension,
    )
    return 1 + sum(isinstance(child, branch_nodes) for child in ast.walk(node))


def python_function_details(
    node: ast.FunctionDef | ast.AsyncFunctionDef,
) -> dict[str, Any]:
    positional = [argument.arg for argument in [*node.args.posonlyargs, *node.args.args]]
    keyword_only = [argument.arg for argument in node.args.kwonlyargs]
    called_symbols = sorted(
        {
            name
            for child in ast.walk(node)
            if isinstance(child, ast.Call)
            if (name := python_call_name(child))
        }
    )
    return {
        "parameters": positional,
        "keywordOnlyParameters": keyword_only,
        "hasVarArgs": node.args.vararg is not None,
        "hasKeywordArgs": node.args.kwarg is not None,
        "returnAnnotation": ast.unparse(node.returns) if node.returns else None,
        "hasDocstring": bool(ast.get_docstring(node)),
        "calledSymbols": called_symbols,
        "complexityHint": python_complexity_hint(node),
    }


def python_class_details(node: ast.ClassDef) -> dict[str, Any]:
    base_classes = [ast.unparse(base) for base in node.bases]
    class_fields: set[str] = set()
    literal_values: dict[str, Any] = {}
    for child in node.body:
        targets: list[ast.expr] = []
        value: ast.expr | None = None
        if isinstance(child, ast.AnnAssign):
            targets = [child.target]
            value = child.value
        elif isinstance(child, ast.Assign):
            targets = list(child.targets)
            value = child.value

        for target in targets:
            if not isinstance(target, ast.Name) or target.id.startswith("__"):
                continue
            class_fields.add(target.id)
            if value is None:
                continue
            try:
                literal_value = ast.literal_eval(value)
                json.dumps(literal_value)
            except TypeError, ValueError:
                continue
            literal_values[target.id] = literal_value

    is_enum = any(base.rsplit(".", 1)[-1].endswith("Enum") for base in base_classes)
    return {
        "baseClasses": base_classes,
        "classFields": sorted(class_fields),
        "enumValues": literal_values if is_enum else {},
        "methodCount": sum(
            isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) for child in node.body
        ),
        "hasDocstring": bool(ast.get_docstring(node)),
        "complexityHint": python_complexity_hint(node),
    }


class PythonSymbolVisitor(ast.NodeVisitor):
    def __init__(
        self,
        *,
        source: str,
        test_documents: list[tuple[str, str, bool]],
    ) -> None:
        self.source = source
        self.test_documents = test_documents
        self.stack: list[tuple[str, str]] = []
        self.items: list[dict[str, Any]] = []

    def add_item(
        self,
        *,
        name: str,
        line: int,
        kind: str,
        decorators: list[str] | None = None,
        is_async: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        qualified_name = ".".join([entry[0] for entry in self.stack] + [name])
        is_dunder = name.startswith("__") and name.endswith("__")
        visibility = "private" if name.startswith("_") else "public"
        candidate = not is_dunder
        confidence = "high" if visibility == "public" else "medium"
        reason = (
            "파이썬 공개 심볼"
            if visibility == "public"
            else "내부 헬퍼이지만 직접 호출 가능한 심볼"
        )
        if is_dunder:
            confidence = "low"
            reason = "파이썬 특수 메서드는 다른 공개 동작을 통해 검증하는 편이 적합함"

        all_tests, unit_tests = referenced_tests(name, self.test_documents)
        item = {
            "language": "python",
            "source": self.source,
            "line": line,
            "symbol": name,
            "qualifiedName": qualified_name,
            "kind": kind,
            "visibility": visibility,
            "exported": visibility == "public",
            "async": is_async,
            "decorators": decorators or [],
            "candidate": candidate,
            "confidence": confidence,
            "suggestedEngine": "pytest",
            "strategy": ("constructor-and-public-methods" if kind == "class" else "direct-call"),
            "requiresBrowser": False,
            "existingTestFiles": all_tests,
            "existingUnitTestFiles": unit_tests,
            "status": "existing-test-reference" if unit_tests else "candidate",
            "requirementId": requirement_hint(self.source),
            "owner": None,
            "areaHint": area_hint(self.source),
            "reason": reason,
        }
        item.update(details or {})
        self.items.append(item)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.add_item(
            name=node.name,
            line=node.lineno,
            kind="class",
            decorators=[python_decorator_name(item) for item in node.decorator_list],
            details=python_class_details(node),
        )
        self.stack.append((node.name, "class"))
        self.generic_visit(node)
        self.stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node, is_async=False)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node, is_async=True)

    def _visit_function(
        self, node: ast.FunctionDef | ast.AsyncFunctionDef, *, is_async: bool
    ) -> None:
        parent_kinds = {entry[1] for entry in self.stack}
        if "function" in parent_kinds:
            kind = "nested-function"
        elif "class" in parent_kinds:
            kind = "method"
        else:
            kind = "function"

        self.add_item(
            name=node.name,
            line=node.lineno,
            kind=kind,
            decorators=[python_decorator_name(item) for item in node.decorator_list],
            is_async=is_async,
            details=python_function_details(node),
        )
        self.stack.append((node.name, "function"))
        self.generic_visit(node)
        self.stack.pop()


def discover_python(
    path: Path,
    project_root: Path,
    test_documents: list[tuple[str, str, bool]],
) -> tuple[list[dict[str, Any]], str | None]:
    source = relative_path(path, project_root)
    try:
        content = path.read_text(encoding="utf-8")
        tree = ast.parse(content, filename=source)
    except (OSError, UnicodeDecodeError, SyntaxError) as error:
        return [], f"{source}: {error}"

    visitor = PythonSymbolVisitor(source=source, test_documents=test_documents)
    visitor.visit(tree)
    return visitor.items, None


FUNCTION_PATTERN = re.compile(
    r"(?m)^(?P<prefix>\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?)"
    r"function\s+(?P<name>[A-Za-z_$][\w$]*)\s*\((?P<params>[^)]*)\)"
)
CLASS_PATTERN = re.compile(
    r"(?m)^(?P<prefix>\s*(?:export\s+)?(?:default\s+)?)"
    r"class\s+(?P<name>[A-Za-z_$][\w$]*)"
)
ARROW_PATTERN = re.compile(
    r"(?ms)^(?P<prefix>\s*(?:export\s+)?)"
    r"(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)"
    r"(?:\s*:[^=\n]+)?\s*=\s*(?:async\s*)?"
    r"(?P<params>\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"
)
REACT_HOOK_PATTERN = re.compile(r"\b(?P<name>use[A-Z][A-Za-z0-9_$]*)\s*\(")
IMPORT_PATTERN = re.compile(
    r"""(?m)^\s*import(?:\s+type)?(?:.|\n)*?\s+from\s+["'](?P<module>[^"']+)["'];?"""
)
SIDE_EFFECT_IMPORT_PATTERN = re.compile(r"""(?m)^\s*import\s+["'](?P<module>[^"']+)["'];?""")
EVENT_HANDLER_PATTERN = re.compile(r"\b(?P<name>on[A-Z][A-Za-z0-9_$]*)\s*=")
JSX_COMPONENT_PATTERN = re.compile(r"<(?P<name>[A-Z][A-Za-z0-9_$.]*)\b")
TYPE_SHAPE_PATTERN = re.compile(
    r"(?ms)\b(?:interface|type)\s+(?P<name>[A-Za-z_$][\w$]*)"
    r"(?:\s*=)?\s*\{(?P<body>.*?)\}"
)
PROP_NAME_PATTERN = re.compile(r"(?m)^\s*(?P<name>[A-Za-z_$][\w$]*)\??\s*:")


def typescript_kind(name: str, path: Path) -> str:
    if re.fullmatch(r"use[A-Z].*", name):
        return "hook"
    if path.suffix.lower() == ".tsx" and name[:1].isupper():
        return "component"
    return "function"


def compact_signature(value: str | None) -> str | None:
    if value is None:
        return None
    return re.sub(r"\s+", " ", value.strip()).strip("() ")


def typescript_props(
    parameter_signature: str | None, type_shapes: dict[str, list[str]]
) -> tuple[str | None, list[str]]:
    if not parameter_signature:
        return None, []

    inline_match = re.fullmatch(r"\{.*\}\s*:\s*\{(?P<body>.*)\}", parameter_signature)
    if inline_match:
        names = sorted(
            {
                match.group("name")
                for match in re.finditer(
                    r"\b(?P<name>[A-Za-z_$][\w$]*)\??\s*:",
                    inline_match.group("body"),
                )
            }
        )
        return "inline", names

    type_match = re.search(
        r"(?:\}|[A-Za-z_$][\w$]*)\s*:\s*(?P<type>[A-Za-z_$][\w$]*)",
        parameter_signature,
    )
    if type_match:
        type_name = type_match.group("type")
        return type_name, type_shapes.get(type_name, [])
    return None, []


def discover_typescript(
    path: Path,
    project_root: Path,
    test_documents: list[tuple[str, str, bool]],
) -> tuple[list[dict[str, Any]], str | None]:
    source = relative_path(path, project_root)
    if path.name.endswith(".d.ts"):
        return [], None
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        return [], f"{source}: {error}"

    matches: list[tuple[re.Match[str], str]] = []
    matches.extend((match, "function") for match in FUNCTION_PATTERN.finditer(content))
    matches.extend((match, "class") for match in CLASS_PATTERN.finditer(content))
    matches.extend((match, "arrow") for match in ARROW_PATTERN.finditer(content))
    matches.sort(key=lambda entry: entry[0].start())

    items: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    hooks = sorted({match.group("name") for match in REACT_HOOK_PATTERN.finditer(content)})
    event_handlers = sorted(
        {match.group("name") for match in EVENT_HANDLER_PATTERN.finditer(content)}
    )
    child_components = sorted(
        {match.group("name") for match in JSX_COMPONENT_PATTERN.finditer(content)}
    )
    imports = sorted(
        {
            match.group("module")
            for pattern in (IMPORT_PATTERN, SIDE_EFFECT_IMPORT_PATTERN)
            for match in pattern.finditer(content)
        }
    )
    type_shapes = {
        match.group("name"): sorted(
            {prop.group("name") for prop in PROP_NAME_PATTERN.finditer(match.group("body"))}
        )
        for match in TYPE_SHAPE_PATTERN.finditer(content)
    }
    file_uses_hooks = bool(hooks)
    file_lines = content.count("\n") + 1
    for match, declaration_kind in matches:
        name = match.group("name")
        line = content.count("\n", 0, match.start()) + 1
        if (name, line) in seen:
            continue
        seen.add((name, line))

        prefix = match.group("prefix")
        parameter_signature = compact_signature(match.groupdict().get("params"))
        props_type, props = typescript_props(parameter_signature, type_shapes)
        exported = "export" in prefix
        kind = "class" if declaration_kind == "class" else typescript_kind(name, path)
        if kind == "component":
            if file_uses_hooks:
                strategy = "vitest-component-harness"
                confidence = "medium"
                reason = "React Hook을 사용하는 컴포넌트로 경량 컴포넌트 하네스가 필요함"
            else:
                strategy = "vitest-react-dom-server"
                confidence = "high"
                reason = "브라우저 없이 react-dom/server로 렌더링 가능한 컴포넌트 후보"
        elif kind == "hook":
            strategy = "vitest-hook-harness"
            confidence = "medium"
            reason = "Hook 전용 하네스가 필요한 코드 단위 후보"
        else:
            strategy = "vitest-direct"
            confidence = "high" if exported else "medium"
            reason = "브라우저 없이 직접 실행 가능한 TypeScript 심볼"

        all_tests, unit_tests = referenced_tests(name, test_documents)
        items.append(
            {
                "language": "typescript",
                "source": source,
                "line": line,
                "symbol": name,
                "qualifiedName": name,
                "kind": kind,
                "visibility": "public" if exported else "module-private",
                "exported": exported,
                "async": "async" in prefix,
                "decorators": [],
                "candidate": True,
                "confidence": confidence,
                "suggestedEngine": "vitest",
                "strategy": strategy,
                "requiresBrowser": False,
                "existingTestFiles": all_tests,
                "existingUnitTestFiles": unit_tests,
                "status": "existing-test-reference" if unit_tests else "candidate",
                "requirementId": None,
                "owner": None,
                "areaHint": area_hint(source),
                "reason": reason,
                "parameterSignature": parameter_signature,
                "propsType": props_type,
                "props": props,
                "hooks": hooks,
                "eventHandlers": event_handlers,
                "childComponents": [
                    component for component in child_components if component != name
                ],
                "imports": imports,
                "externalDependencies": [
                    module for module in imports if not module.startswith((".", "/"))
                ],
                "localDependencies": [
                    module for module in imports if module.startswith((".", "/"))
                ],
                "fileLines": file_lines,
                "detailsScope": "file-level-heuristic",
            }
        )
    return items, None


def ast_string(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def route_string(node: ast.AST | None, constants: dict[str, str]) -> str | None:
    value = ast_string(node)
    if value is not None:
        return value
    if isinstance(node, ast.Name):
        return constants.get(node.id)
    return None


def ast_path(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = ast_path(node.value)
        return f"{prefix}.{node.attr}" if prefix else node.attr
    return ""


def add_environment_variable(
    records: dict[str, dict[str, Any]],
    name: str,
    *,
    origin: str,
    required: bool | None = None,
    annotation: str | None = None,
    declared_in_template: bool = False,
) -> None:
    if not ENV_NAME_PATTERN.fullmatch(name):
        return
    record = records.setdefault(
        name,
        {
            "name": name,
            "required": None,
            "annotations": set(),
            "declaredInTemplate": False,
            "origins": set(),
        },
    )
    record["origins"].add(origin)
    record["declaredInTemplate"] = bool(record["declaredInTemplate"] or declared_in_template)
    if required is True:
        record["required"] = True
    elif required is False and record["required"] is None:
        record["required"] = False
    if annotation:
        record["annotations"].add(annotation)


def settings_prefix(node: ast.ClassDef) -> str:
    for child in node.body:
        if not isinstance(child, ast.Assign):
            continue
        if not any(
            isinstance(target, ast.Name) and target.id == "model_config" for target in child.targets
        ):
            continue
        if not isinstance(child.value, ast.Call):
            continue
        for keyword in child.value.keywords:
            if keyword.arg == "env_prefix" and (value := ast_string(keyword.value)):
                return value
    return ""


def discover_python_environment(
    path: Path,
    project_root: Path,
    records: dict[str, dict[str, Any]],
) -> None:
    source = relative_path(path, project_root)
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=source)
    except OSError, UnicodeDecodeError, SyntaxError:
        return

    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and any(
            ast_path(base).rsplit(".", 1)[-1] == "BaseSettings" for base in node.bases
        ):
            prefix = settings_prefix(node)
            for child in node.body:
                if not isinstance(child, ast.AnnAssign) or not isinstance(child.target, ast.Name):
                    continue
                field_name = child.target.id
                required = child.value is None or (
                    isinstance(child.value, ast.Constant) and child.value.value is Ellipsis
                )
                add_environment_variable(
                    records,
                    f"{prefix}{field_name}".upper(),
                    origin="python-settings",
                    required=required,
                    annotation=ast.unparse(child.annotation),
                )

        if isinstance(node, ast.Call):
            call_path = ast_path(node.func)
            if (
                call_path in {"os.getenv", "os.environ.get"}
                and node.args
                and (name := ast_string(node.args[0]))
            ):
                add_environment_variable(
                    records,
                    name,
                    origin="python-environment",
                    required=False,
                )

        if (
            isinstance(node, ast.Subscript)
            and ast_path(node.value) == "os.environ"
            and (name := ast_string(node.slice))
        ):
            add_environment_variable(
                records,
                name,
                origin="python-environment",
                required=True,
            )


def discover_environment_contract(
    project_root: Path, production_files: list[Path]
) -> dict[str, Any]:
    records: dict[str, dict[str, Any]] = {}
    template_path = project_root / ".env.example"
    if template_path.is_file():
        try:
            lines = template_path.read_text(encoding="utf-8").splitlines()
        except OSError, UnicodeDecodeError:
            lines = []
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            name = stripped.split("=", 1)[0].strip()
            add_environment_variable(
                records,
                name,
                origin="env-example",
                declared_in_template=True,
            )

    for path in production_files:
        source = relative_path(path, project_root)
        if source.split("/", 1)[0] not in {"backend", "frontend", "scripts"}:
            continue
        suffix = path.suffix.lower()
        if suffix == ".py":
            discover_python_environment(path, project_root, records)
            continue
        if suffix not in {".js", ".jsx", ".ts", ".tsx"}:
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except OSError, UnicodeDecodeError:
            continue
        for match in JS_ENV_PATTERN.finditer(content):
            add_environment_variable(
                records,
                match.group("name"),
                origin="frontend-environment",
                required=None,
            )

    variables: list[dict[str, Any]] = []
    for record in records.values():
        variables.append(
            {
                "name": record["name"],
                "required": record["required"],
                "annotations": sorted(record["annotations"]),
                "declaredInTemplate": record["declaredInTemplate"],
                "origins": sorted(record["origins"]),
            }
        )
    variables.sort(key=lambda item: item["name"])
    return {
        "variables": variables,
        "secretsStored": False,
        "limitations": [
            "실제 .env 값은 읽거나 저장하지 않음",
            "동적으로 조합한 환경변수 이름은 .env.example 선언을 기준으로 추적함",
        ],
    }


def function_parameters(
    node: ast.FunctionDef | ast.AsyncFunctionDef,
) -> list[dict[str, Any]]:
    positional = [*node.args.posonlyargs, *node.args.args]
    defaults: list[ast.expr | None] = [None] * (len(positional) - len(node.args.defaults))
    defaults.extend(node.args.defaults)
    parameters: list[dict[str, Any]] = []
    for argument, default in zip(positional, defaults, strict=True):
        annotation = ast.unparse(argument.annotation) if argument.annotation else None
        if argument.arg in {"self", "request", "response", "db", "database", "runner"}:
            continue
        if annotation and ("Depends" in annotation or annotation.endswith("Dep")):
            continue
        parameters.append(
            {
                "name": argument.arg,
                "annotation": annotation,
                "required": default is None,
            }
        )
    for argument, default in zip(node.args.kwonlyargs, node.args.kw_defaults, strict=True):
        annotation = ast.unparse(argument.annotation) if argument.annotation else None
        if annotation and ("Depends" in annotation or annotation.endswith("Dep")):
            continue
        parameters.append(
            {
                "name": argument.arg,
                "annotation": annotation,
                "required": default is None,
            }
        )
    return parameters


def normalized_route_path(prefix: str, path: str) -> str:
    combined = f"/{prefix.strip('/')}/{path.strip('/')}"
    return re.sub(r"/+", "/", combined).rstrip("/") or "/"


def discover_declared_routes(
    project_root: Path, production_files: list[Path]
) -> list[dict[str, Any]]:
    routes: dict[str, dict[str, Any]] = {}
    for path in production_files:
        if path.suffix.lower() != ".py":
            continue
        source = relative_path(path, project_root)
        if not source.startswith("backend/"):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=source)
        except OSError, UnicodeDecodeError, SyntaxError:
            continue

        constants: dict[str, str] = {}
        for node in tree.body:
            if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                continue
            value = ast_string(node.value)
            if value is None:
                continue
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name):
                    constants[target.id] = value

        prefixes: dict[str, str] = {}
        for node in tree.body:
            if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Call):
                continue
            if ast_path(node.value.func).rsplit(".", 1)[-1] not in {
                "APIRouter",
                "FastAPI",
            }:
                continue
            prefix = ""
            for keyword in node.value.keywords:
                if keyword.arg == "prefix":
                    prefix = route_string(keyword.value, constants) or ast.unparse(keyword.value)
            for target in node.targets:
                if isinstance(target, ast.Name):
                    prefixes[target.id] = prefix

        for node in tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call) or not isinstance(
                    decorator.func, ast.Attribute
                ):
                    continue
                method = decorator.func.attr.lower()
                if method not in API_METHODS or not decorator.args:
                    continue
                route_path = route_string(decorator.args[0], constants)
                if route_path is None:
                    route_path = ast.unparse(decorator.args[0])
                receiver = ast_path(decorator.func.value)
                full_path = normalized_route_path(prefixes.get(receiver, ""), route_path)
                keywords = {keyword.arg: keyword.value for keyword in decorator.keywords}
                key = f"{method.upper()} {full_path}"
                routes[key] = {
                    "key": key,
                    "method": method.upper(),
                    "path": full_path,
                    "parameters": function_parameters(node),
                    "responseModel": (
                        ast.unparse(keywords["response_model"])
                        if "response_model" in keywords
                        else None
                    ),
                    "returnAnnotation": ast.unparse(node.returns) if node.returns else None,
                    "statusCode": (
                        ast.unparse(keywords["status_code"]) if "status_code" in keywords else "200"
                    ),
                }
    return [routes[key] for key in sorted(routes)]


def normalize_openapi(value: Any, parent_key: str | None = None) -> Any:
    if isinstance(value, dict):
        return {
            key: normalize_openapi(item, key)
            for key, item in sorted(value.items())
            if key not in OPENAPI_METADATA_KEYS
        }
    if isinstance(value, list):
        items = [normalize_openapi(item) for item in value]
        if parent_key in {"allOf", "anyOf", "enum", "oneOf", "required"}:
            return sorted(
                items,
                key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True),
            )
        if parent_key == "parameters" and all(isinstance(item, dict) for item in items):
            return sorted(items, key=lambda item: (item.get("in", ""), item.get("name", "")))
        return items
    return value


def read_openapi_contract(openapi_path: Path) -> dict[str, Any]:
    if not openapi_path.is_file():
        return {"operations": [], "schemas": [], "error": f"{openapi_path} 없음"}
    try:
        document = json.loads(openapi_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        return {"operations": [], "schemas": [], "error": str(error)}

    operations: list[dict[str, Any]] = []
    for path, path_item in sorted(document.get("paths", {}).items()):
        if not isinstance(path_item, dict):
            continue
        for method, operation in sorted(path_item.items()):
            if method.lower() not in API_METHODS or not isinstance(operation, dict):
                continue
            key = f"{method.upper()} {path}"
            operations.append(
                {
                    "key": key,
                    "method": method.upper(),
                    "path": path,
                    "contract": normalize_openapi(operation),
                }
            )

    schemas = [
        {
            "key": name,
            "name": name,
            "contract": normalize_openapi(schema),
        }
        for name, schema in sorted(document.get("components", {}).get("schemas", {}).items())
    ]
    return {"operations": operations, "schemas": schemas, "error": None}


def discover_openapi_contract(project_root: Path) -> dict[str, Any]:
    contracts_dir = project_root / "contracts"
    primary = read_openapi_contract(contracts_dir / "openapi.json")
    if primary["error"]:
        return primary

    operations = {item["key"]: item for item in primary["operations"]}
    schemas = {item["key"]: item for item in primary["schemas"]}

    pc_contract_path = contracts_dir / "pc-consult.openapi.json"
    if pc_contract_path.is_file():
        pc_contract = read_openapi_contract(pc_contract_path)
        if pc_contract["error"]:
            return pc_contract
        operations.update({item["key"]: item for item in pc_contract["operations"]})
        schemas.update(
            {
                f"pc-consult::{item['key']}": {
                    **item,
                    "key": f"pc-consult::{item['key']}",
                }
                for item in pc_contract["schemas"]
            }
        )

    return {
        "operations": [operations[key] for key in sorted(operations)],
        "schemas": [schemas[key] for key in sorted(schemas)],
        "error": None,
    }


def discover_api_contract(project_root: Path, production_files: list[Path]) -> dict[str, Any]:
    declared_routes = discover_declared_routes(project_root, production_files)
    openapi = discover_openapi_contract(project_root)
    declared_keys = {route["key"] for route in declared_routes}
    openapi_keys = {operation["key"] for operation in openapi["operations"]}
    return {
        "declaredRoutes": declared_routes,
        "openApiOperations": openapi["operations"],
        "openApiSchemas": openapi["schemas"],
        "synchronization": {
            "missingFromOpenApi": sorted(declared_keys - openapi_keys),
            "missingFromSource": sorted(openapi_keys - declared_keys),
        },
        "error": openapi["error"],
    }


def discover_contracts(project_root: Path, production_files: list[Path]) -> dict[str, Any]:
    return {
        "environment": discover_environment_contract(project_root, production_files),
        "api": discover_api_contract(project_root, production_files),
    }


def build_inventory(project_root: Path) -> dict[str, Any]:
    validate_python_runtime()
    all_source_files = sorted(
        path
        for path in project_root.rglob("*")
        if path.is_file() and path.suffix.lower() in SOURCE_SUFFIXES and not is_excluded(path)
    )
    test_documents = load_test_documents(project_root, all_source_files)
    production_files = [path for path in all_source_files if not is_test_file(path)]

    items: list[dict[str, Any]] = []
    errors: list[str] = []
    for path in production_files:
        if path.suffix.lower() == ".py":
            discovered, error = discover_python(path, project_root, test_documents)
        else:
            discovered, error = discover_typescript(path, project_root, test_documents)
        items.extend(discovered)
        if error:
            errors.append(error)

    items.sort(key=lambda item: (item["source"], item["line"], item["qualifiedName"]))
    candidates = [item for item in items if item["candidate"]]
    existing = [item for item in candidates if item["existingUnitTestFiles"]]
    by_language = Counter(item["language"] for item in items)
    by_kind = Counter(item["kind"] for item in items)
    by_strategy = Counter(item["strategy"] for item in candidates)

    return {
        "schemaVersion": 2,
        "generatedAt": datetime.now(UTC).isoformat(),
        "pythonVersion": (
            f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        ),
        "requiredPython": ".".join(map(str, REQUIRED_PYTHON)),
        "projectRoot": str(project_root),
        "purpose": "현재 코드에서 경량 단위 테스트 후보를 최대한 수집한 정적 분석 결과",
        "limitations": [
            "TypeScript와 React 상세 정보는 정규식 기반 파일 단위 휴리스틱이므로 검토가 필요함",
            "기존 테스트 연결은 심볼 이름 참조를 기준으로 한 추정임",
            "요구사항 ID와 기대 결과는 담당자가 최종 확인해야 함",
            "브라우저 상호작용은 system_acceptance 대상으로 분류해야 함",
        ],
        "summary": {
            "sourceFiles": len(production_files),
            "testFiles": len(test_documents),
            "symbols": len(items),
            "candidates": len(candidates),
            "candidatesWithExistingUnitReference": len(existing),
            "candidatesWithoutUnitReference": len(candidates) - len(existing),
            "byLanguage": dict(sorted(by_language.items())),
            "byKind": dict(sorted(by_kind.items())),
            "byStrategy": dict(sorted(by_strategy.items())),
            "parseErrors": len(errors),
        },
        "errors": errors,
        "contracts": discover_contracts(project_root, production_files),
        "items": items,
    }


def symbol_key(item: dict[str, Any]) -> str:
    return "::".join(
        (
            str(item.get("language", "unknown")),
            str(item.get("source", "unknown")),
            str(item.get("qualifiedName", item.get("symbol", "unknown"))),
            str(item.get("kind", "unknown")),
        )
    )


def symbol_snapshot(item: dict[str, Any]) -> dict[str, Any]:
    return {field: item.get(field) for field in FINGERPRINT_FIELDS if field in item}


def snapshot_fingerprint(snapshot: dict[str, Any]) -> str:
    serialized = json.dumps(
        snapshot,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def baseline_entry(item: dict[str, Any]) -> dict[str, Any]:
    snapshot = symbol_snapshot(item)
    return {
        "key": symbol_key(item),
        "language": item.get("language"),
        "source": item.get("source"),
        "symbol": item.get("symbol"),
        "qualifiedName": item.get("qualifiedName"),
        "kind": item.get("kind"),
        "candidate": bool(item.get("candidate")),
        "snapshot": snapshot,
        "fingerprint": snapshot_fingerprint(snapshot),
    }


def build_baseline(inventory: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "generatedAt": datetime.now(UTC).isoformat(),
        "pythonVersion": inventory["pythonVersion"],
        "requiredPython": inventory["requiredPython"],
        "projectRoot": inventory["projectRoot"],
        "purpose": "승인된 코드·환경변수·API 구조와 이후 수집 결과를 비교하기 위한 기준 스냅샷",
        "contracts": inventory["contracts"],
        "items": [baseline_entry(item) for item in inventory["items"]],
    }


def write_baseline(baseline: dict[str, Any], baseline_path: Path) -> None:
    baseline_path.parent.mkdir(parents=True, exist_ok=True)
    baseline_path.write_text(
        json.dumps(baseline, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def load_baseline(baseline_path: Path, project_root: Path) -> dict[str, Any]:
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    if baseline.get("schemaVersion") not in {1, 2} or not isinstance(baseline.get("items"), list):
        raise RuntimeError(f"지원하지 않는 인벤토리 기준 파일입니다: {baseline_path}")
    if baseline.get("projectRoot") != str(project_root):
        raise RuntimeError(
            "인벤토리 기준 파일의 프로젝트가 현재 PROJECT_PATH와 다릅니다. "
            "확인 후 discover.py --accept-baseline을 실행하세요: "
            f"{baseline_path}"
        )
    return baseline


def comparison_descriptor(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": entry["key"],
        "language": entry.get("language"),
        "source": entry.get("source"),
        "symbol": entry.get("symbol"),
        "qualifiedName": entry.get("qualifiedName"),
        "kind": entry.get("kind"),
        "candidate": bool(entry.get("candidate")),
    }


def compare_inventory(inventory: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    current_by_key = {
        entry["key"]: entry for entry in (baseline_entry(item) for item in inventory["items"])
    }
    baseline_by_key = {entry["key"]: entry for entry in baseline["items"]}

    added_keys = sorted(current_by_key.keys() - baseline_by_key.keys())
    removed_keys = sorted(baseline_by_key.keys() - current_by_key.keys())
    shared_keys = sorted(current_by_key.keys() & baseline_by_key.keys())

    current_items_by_key = {symbol_key(item): item for item in inventory["items"]}
    added: list[dict[str, Any]] = []
    for key in added_keys:
        descriptor = comparison_descriptor(current_by_key[key])
        references = current_items_by_key[key].get("existingUnitTestFiles", [])
        descriptor["existingUnitTestFiles"] = references
        descriptor["hasExistingUnitTestReference"] = bool(references)
        added.append(descriptor)

    removed = [comparison_descriptor(baseline_by_key[key]) for key in removed_keys]
    changed: list[dict[str, Any]] = []
    for key in shared_keys:
        before = baseline_by_key[key]
        current = current_by_key[key]
        if before.get("fingerprint") == current.get("fingerprint"):
            continue
        before_snapshot = before.get("snapshot", {})
        current_snapshot = current.get("snapshot", {})
        changed_fields = sorted(
            field
            for field in before_snapshot.keys() | current_snapshot.keys()
            if before_snapshot.get(field) != current_snapshot.get(field)
        )
        descriptor = comparison_descriptor(current)
        descriptor["changedFields"] = changed_fields
        descriptor["changes"] = {
            field: {
                "before": before_snapshot.get(field),
                "current": current_snapshot.get(field),
            }
            for field in changed_fields
        }
        changed.append(descriptor)

    uncovered_added = [
        entry for entry in added if entry["candidate"] and not entry["hasExistingUnitTestReference"]
    ]
    return {
        "status": "compared",
        "baselineGeneratedAt": baseline.get("generatedAt"),
        "summary": {
            "added": len(added),
            "removed": len(removed),
            "changed": len(changed),
            "uncoveredAddedCandidates": len(uncovered_added),
        },
        "added": added,
        "removed": removed,
        "changed": changed,
        "uncoveredAddedCandidates": uncovered_added,
    }


def compare_contract_records(
    current_records: list[dict[str, Any]],
    baseline_records: list[dict[str, Any]],
    *,
    key_field: str,
    section: str,
    additions_breaking: bool,
    ignored_fields: set[str] | None = None,
) -> dict[str, Any]:
    ignored_fields = ignored_fields or set()
    current_by_key = {str(record[key_field]): record for record in current_records}
    baseline_by_key = {str(record[key_field]): record for record in baseline_records}
    added_keys = sorted(current_by_key.keys() - baseline_by_key.keys())
    removed_keys = sorted(baseline_by_key.keys() - current_by_key.keys())
    shared_keys = sorted(current_by_key.keys() & baseline_by_key.keys())

    added = [{"section": section, "key": key, "current": current_by_key[key]} for key in added_keys]
    removed = [
        {"section": section, "key": key, "before": baseline_by_key[key]} for key in removed_keys
    ]
    changed: list[dict[str, Any]] = []
    for key in shared_keys:
        before = {
            field: value
            for field, value in baseline_by_key[key].items()
            if field not in ignored_fields
        }
        current = {
            field: value
            for field, value in current_by_key[key].items()
            if field not in ignored_fields
        }
        if before != current:
            changed.append(
                {
                    "section": section,
                    "key": key,
                    "before": before,
                    "current": current,
                }
            )

    breaking_changes = [
        {
            "section": entry["section"],
            "key": entry["key"],
            "change": "added",
            "reason": "새 계약 항목은 실행 환경 준비가 필요함",
        }
        for entry in added
        if additions_breaking
    ]
    breaking_changes.extend(
        {
            "section": entry["section"],
            "key": entry["key"],
            "change": "removed",
            "reason": "기존 계약 항목 삭제",
        }
        for entry in removed
    )
    breaking_changes.extend(
        {
            "section": entry["section"],
            "key": entry["key"],
            "change": "changed",
            "reason": "기존 계약 구조 변경",
        }
        for entry in changed
    )
    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "breakingChanges": breaking_changes,
    }


def merge_contract_comparisons(
    comparisons: list[dict[str, Any]],
) -> dict[str, Any]:
    merged = {
        "added": [],
        "removed": [],
        "changed": [],
        "breakingChanges": [],
    }
    for comparison in comparisons:
        for key, values in merged.items():
            values.extend(comparison[key])
    merged["summary"] = {
        "added": len(merged["added"]),
        "removed": len(merged["removed"]),
        "changed": len(merged["changed"]),
        "breaking": len(merged["breakingChanges"]),
    }
    return merged


def compare_contracts(
    current_contracts: dict[str, Any], baseline_contracts: dict[str, Any]
) -> dict[str, Any]:
    environment = compare_contract_records(
        current_contracts["environment"]["variables"],
        baseline_contracts["environment"]["variables"],
        key_field="name",
        section="environment.variables",
        additions_breaking=False,
        ignored_fields={"origins"},
    )
    environment["summary"] = {
        "added": len(environment["added"]),
        "removed": len(environment["removed"]),
        "changed": len(environment["changed"]),
        "breaking": len(environment["breakingChanges"]),
    }

    current_api = current_contracts["api"]
    baseline_api = baseline_contracts["api"]
    api = merge_contract_comparisons(
        [
            compare_contract_records(
                current_api["declaredRoutes"],
                baseline_api["declaredRoutes"],
                key_field="key",
                section="api.declaredRoutes",
                additions_breaking=False,
            ),
            compare_contract_records(
                current_api["openApiOperations"],
                baseline_api["openApiOperations"],
                key_field="key",
                section="api.openApiOperations",
                additions_breaking=False,
            ),
            compare_contract_records(
                current_api["openApiSchemas"],
                baseline_api["openApiSchemas"],
                key_field="key",
                section="api.openApiSchemas",
                additions_breaking=False,
            ),
        ]
    )

    synchronization = current_api.get("synchronization", {})
    for key in ("missingFromOpenApi", "missingFromSource"):
        for route in synchronization.get(key, []):
            api["breakingChanges"].append(
                {
                    "section": "api.synchronization",
                    "key": route,
                    "change": key,
                    "reason": "API 소스와 저장된 OpenAPI 계약 불일치",
                }
            )
    if current_api.get("error"):
        api["breakingChanges"].append(
            {
                "section": "api.openapi",
                "key": "contracts/openapi.json",
                "change": "invalid",
                "reason": current_api["error"],
            }
        )
    api["summary"]["breaking"] = len(api["breakingChanges"])

    return {
        "environment": environment,
        "api": api,
        "summary": {
            "environmentBreaking": environment["summary"]["breaking"],
            "apiBreaking": api["summary"]["breaking"],
            "totalBreaking": (environment["summary"]["breaking"] + api["summary"]["breaking"]),
        },
    }


def write_inventory(
    project_root: Path,
    output_path: Path = DEFAULT_OUTPUT,
    baseline_path: Path = DEFAULT_BASELINE,
    *,
    accept_baseline: bool = False,
) -> dict[str, Any]:
    inventory = build_inventory(project_root)
    output_path = output_path.expanduser().resolve()
    baseline_path = baseline_path.expanduser().resolve()

    if accept_baseline or not baseline_path.is_file():
        baseline = build_baseline(inventory)
        write_baseline(baseline, baseline_path)
        comparison = compare_inventory(inventory, baseline)
        comparison["status"] = "accepted" if accept_baseline else "initialized"
    else:
        baseline = load_baseline(baseline_path, project_root)
        if "contracts" not in baseline:
            baseline["schemaVersion"] = 2
            baseline["contracts"] = inventory["contracts"]
            write_baseline(baseline, baseline_path)
        comparison = compare_inventory(inventory, baseline)

    comparison["baselinePath"] = str(baseline_path)
    inventory["comparison"] = comparison
    contract_comparison = compare_contracts(inventory["contracts"], baseline["contracts"])
    contract_comparison["status"] = comparison["status"]
    inventory["contractComparison"] = contract_comparison
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return inventory


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="단위 테스트 후보를 정적 분석합니다.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="인벤토리 JSON 출력 경로",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        default=DEFAULT_BASELINE,
        help="승인된 인벤토리 기준 JSON 경로",
    )
    parser.add_argument(
        "--accept-baseline",
        action="store_true",
        help="현재 코드 상태를 검토 완료된 비교 기준으로 저장합니다.",
    )
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    project_root = Path(PROJECT_PATH).expanduser().resolve()
    if not project_root.is_dir():
        raise RuntimeError(f"config.py의 PROJECT_PATH가 올바르지 않습니다: {project_root}")

    output_path = arguments.output.expanduser().resolve()
    baseline_path = arguments.baseline.expanduser().resolve()
    inventory = write_inventory(
        project_root,
        output_path,
        baseline_path,
        accept_baseline=arguments.accept_baseline,
    )

    summary = inventory["summary"]
    print(f"인벤토리 생성: {output_path}")
    print(
        "소스 파일 {sourceFiles}개, 심볼 {symbols}개, 후보 {candidates}개, "
        "기존 단위 테스트 참조 {candidatesWithExistingUnitReference}개".format(**summary)
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
    print(f"기준 파일: {comparison['baselinePath']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"ERROR: {error}")
        raise SystemExit(2) from error
