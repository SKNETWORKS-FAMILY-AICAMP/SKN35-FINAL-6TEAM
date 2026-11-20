"""테스트를 재평가하지 않고 실행된 assertion 근거를 JUnit 속성에 기록합니다."""

from __future__ import annotations

import ast
import functools
import inspect
import json
import re
import unittest
from pathlib import Path
from unittest.mock import NonCallableMock

import pytest

_active = None
_busy = False
_patches = []
_secret = re.compile(r"password|secret|token|api.?key|authorization", re.IGNORECASE)


def safe(value, key="", depth=0):
    if _secret.search(str(key)):
        return "[비밀값 제외]"
    if depth > 3:
        return "[중첩 생략]"
    if value is None or type(value) in (str, int, float, bool):
        return str(value)[:4000] if isinstance(value, str) else value
    if type(value) is dict:
        return {str(k): safe(v, str(k), depth + 1) for k, v in list(value.items())[:30]}
    if type(value) in (list, tuple):
        return [safe(v, key, depth + 1) for v in value[:30]]
    if isinstance(value, type):
        return value.__name__
    return f"[{type(value).__name__}: 객체 전체는 수집하지 않음]"


def append_check(name, expected, actual, passed, evidence):
    if _active is None:
        return
    hidden = bool(_secret.search(name)) or _active[2]
    _active[1].append(
        {
            "item": "비밀값 관련 검증 (표현식 생략)" if hidden else name,
            "expected": "[비밀값 제외]" if hidden else safe(expected),
            "actual": "[비밀값 제외]" if hidden else safe(actual),
            "result": "일치" if passed else "불일치",
            "evidence": evidence,
        }
    )


def expected_condition(expression):
    try:
        node = ast.parse(expression, mode="eval").body
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            right = node.comparators[0]
            try:
                return {"operator": type(node.ops[0]).__name__, "right": ast.literal_eval(right)}
            except ValueError, TypeError:
                return {
                    "operator": type(node.ops[0]).__name__,
                    "right_expression": ast.unparse(right),
                }
    except SyntaxError:
        pass
    return "assert 조건이 참이어야 함"


def pytest_assertion_pass(item, lineno, orig, expl):
    append_check(
        orig,
        expected_condition(orig),
        expl,
        True,
        f"{item.location[0]}:{lineno} / pytest의 실행 시점 설명. actual은 재평가한 값이 아닌 pytest 비교 근거입니다.",
    )


def wrap_assertion(original, name, drop_self):
    @functools.wraps(original)
    def wrapped(*args, **kwargs):
        global _busy
        if _active is None or _busy:
            return original(*args, **kwargs)
        _busy = True
        values = args[1:] if drop_self else args
        expected = {"검증 함수": name, "인수": safe(values[1:]), "옵션": safe(kwargs)}
        actual = safe(values[:1])
        if isinstance(args[0], NonCallableMock):
            actual = {"call_count": args[0].call_count, "call_args": safe(args[0].call_args_list)}
        try:
            result = original(*args, **kwargs)
        except AssertionError:
            append_check(
                name,
                expected,
                actual,
                False,
                "원래 검증 함수를 1회 호출한 결과. 예외는 그대로 전달합니다.",
            )
            raise
        else:
            append_check(
                name,
                expected,
                actual,
                True,
                "원래 검증 함수를 1회 호출한 결과. 내부 중복 호출은 집계하지 않습니다.",
            )
            return result
        finally:
            _busy = False

    return wrapped


class RaisesContext:
    def __init__(self, context, expected):
        self.context = context
        self.expected = expected

    def __enter__(self):
        return self.context.__enter__()

    def __exit__(self, kind, value, traceback):
        try:
            result = self.context.__exit__(kind, value, traceback)
        except BaseException:
            append_check(
                "pytest.raises",
                self.expected,
                safe(kind),
                False,
                "예상 예외 검증이 원래 예외를 발생시켰습니다.",
            )
            raise
        append_check(
            "pytest.raises",
            self.expected,
            safe(kind),
            bool(result),
            "원래 예외 컨텍스트의 판정 결과. 예외 발생 코드 재실행 없음.",
        )
        return result


def pytest_configure(config):
    for owner, names in (
        (
            unittest.TestCase,
            (
                "assertEqual",
                "assertNotEqual",
                "assertTrue",
                "assertFalse",
                "assertIs",
                "assertIsNot",
                "assertIsNone",
                "assertIsNotNone",
                "assertIn",
                "assertNotIn",
                "assertGreater",
                "assertGreaterEqual",
                "assertLess",
                "assertLessEqual",
                "assertAlmostEqual",
                "assertIsInstance",
            ),
        ),
        (
            NonCallableMock,
            (
                "assert_called",
                "assert_called_once",
                "assert_called_with",
                "assert_called_once_with",
                "assert_any_call",
                "assert_has_calls",
                "assert_not_called",
            ),
        ),
    ):
        for name in names:
            original = getattr(owner, name)
            _patches.append((owner, name, original))
            setattr(owner, name, wrap_assertion(original, name, True))
    original = pytest.raises

    @functools.wraps(original)
    def raises(*args, **kwargs):
        result = original(*args, **kwargs)
        if _active is None:
            return result
        expected = {
            "exception": safe(args[0]) if args else "미지정",
            "match": safe(kwargs.get("match")),
        }
        if len(args) > 1 and callable(args[1]):
            append_check(
                "pytest.raises",
                expected,
                "예외 검증 완료",
                True,
                "함수형 pytest.raises 원래 반환 결과",
            )
            return result
        return RaisesContext(result, expected)

    _patches.append((pytest, "raises", original))
    pytest.raises = raises
    context_type = unittest.case._AssertRaisesContext
    original_exit = context_type.__exit__

    def context_exit(self, kind, value, traceback):
        try:
            result = original_exit(self, kind, value, traceback)
        except BaseException:
            append_check(
                "unittest.assertRaises",
                safe(self.expected),
                safe(kind),
                False,
                "원래 예외 컨텍스트 판정",
            )
            raise
        append_check(
            "unittest.assertRaises",
            safe(self.expected),
            safe(kind),
            bool(result),
            "원래 예외 컨텍스트 판정",
        )
        return result

    _patches.append((context_type, "__exit__", original_exit))
    context_type.__exit__ = context_exit


def pytest_unconfigure(config):
    while _patches:
        owner, name, original = _patches.pop()
        setattr(owner, name, original)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item, nextitem):
    global _active
    # BASE already owns manually authored comparison details. Do not duplicate them.
    parts = Path(str(item.path)).parts
    previous = _active
    try:
        sensitive = bool(_secret.search(inspect.getsource(item.obj)))
    except OSError, TypeError:
        sensitive = True
    _active = None if "contracts" in parts else (item, [], sensitive)
    try:
        yield
    finally:
        _active = previous


@pytest.hookimpl(hookwrapper=True, tryfirst=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if _active is None or _active[0] is not item:
        return
    rows = _active[1]
    if report.failed and call.when == "call" and not any(r["result"] == "불일치" for r in rows):
        append_check(
            "테스트 실행 중 실패",
            "테스트 검증 성공",
            str(report.longrepr)[:4000],
            False,
            "첫 실패 이후 검증은 실행되지 않았을 수 있습니다. 원래 pytest 실패 보고입니다.",
        )
    props = {
        "target": item.nodeid,
        "criterion": "실제로 실행된 assert·unittest·Mock·pytest.raises 검증을 하위 항목으로 기록",
        "expected": "각 하위 항목의 기대 조건 참조",
        "actual": {
            "관측한 검증 횟수": len(rows),
            "하위 불일치": sum(r["result"] == "불일치" for r in rows),
        },
        "inputs": safe(getattr(getattr(item, "callspec", None), "params", {})),
        "method": "pytest assertion-pass hook 및 기존 검증 함수의 원래 호출 결과 수집. 조건 재평가 없음",
        "exclusions": "fixture/일반 지역변수/실제 환경변수 값은 수집하지 않음. subprocess 내부·미지원 검증·실행되지 않은 분기는 관측 대상 아님. 입력은 매개변수화 인수만 기록",
        "location": f"{item.location[0]}:{item.location[1] + 1}",
        "checks": rows,
    }
    item.user_properties[:] = [(k, v) for k, v in item.user_properties if k not in props]
    item.user_properties.extend((k, json.dumps(v, ensure_ascii=False)) for k, v in props.items())
    report.user_properties = list(item.user_properties)
