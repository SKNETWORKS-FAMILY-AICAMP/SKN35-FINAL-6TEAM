"""모듈 연결의 명시적 입출력 기록. 공통 수집기·JUnit 집계는 변경하지 않습니다."""

from __future__ import annotations

import json
import os
import re
import tempfile
import xml.etree.ElementTree as ET
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

_SECRET = re.compile(r"password|secret|token|api.?key|authorization", re.I)


def visible(value, key=""):
    """명시적으로 전달한 검증 값만 직렬화하며 비밀값 필드는 제외합니다."""
    if _SECRET.search(str(key)):
        return "[비밀값 제외]"
    if isinstance(value, dict):
        return {str(k): visible(v, str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [visible(v) for v in value]
    if isinstance(value, Decimal):
        return {"type": "Decimal", "value": str(value)}
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value is None or type(value) in (str, int, float, bool):
        return value
    return f"[{type(value).__name__}: 객체 전체 미기록]"


class ModuleFlow:
    def __init__(self, item):
        self.item = item
        self.data = {"connections": [], "checks": []}
        self.connection = None

    def _publish(self):
        self.item.user_properties[:] = [
            (k, v) for k, v in self.item.user_properties if k != "module_flow"
        ]
        self.item.user_properties.append(
            ("module_flow", json.dumps(self.data, ensure_ascii=False, allow_nan=False))
        )

    def begin(self, source, destination, *, inputs, mode, exclusions):
        self.connection = {
            "source": source,
            "destination": destination,
            "inputs": visible(inputs),
            "mode": mode,
            "exclusions": exclusions,
        }
        self.data["connections"].append(self.connection)
        self._publish()

    def equal(self, field, expected, actual):
        if self.connection is None:
            raise RuntimeError("검증 전에 begin으로 모듈 연결을 지정하세요.")
        passed = actual == expected
        link = f"{self.connection['source']} → {self.connection['destination']}"
        self.data["checks"].append(
            {
                "item": f"{link} : {field}",
                "expected": visible(expected, field),
                "actual": visible(actual, field),
                "result": "일치" if passed else "불일치",
                "evidence": self.connection,
            }
        )
        # 첫 비교 실패도 XML에 남긴 다음 원래 테스트를 실패시킵니다.
        self._publish()
        if not passed:
            raise AssertionError(f"{link} / {field}: 기대값과 실제값 불일치 (module_flow 참조)")


def enrich_report(xml_path: Path) -> int:
    """명시적 연결 기록을 공통 Excel이 읽는 속성에 투영합니다. 상태·건수는 보존합니다."""
    tree = ET.parse(xml_path)
    count = 0
    for case in tree.getroot().iter("testcase"):
        properties = case.find("properties")
        if properties is None:
            continue
        values = {p.get("name"): p.get("value", "") for p in properties}
        if "module_flow" not in values:
            continue
        data = json.loads(values["module_flow"])
        connections, checks = data["connections"], data["checks"]
        if not checks:
            checks = [
                {
                    "item": "연결 설정 이후의 입출력 비교 도달 여부",
                    "expected": "검증 대상 모듈의 실제 입출력 비교",
                    "actual": "비교값 미관측. JUnit 오류·실패·skip 사유 확인 필요",
                    "result": "미관측",
                    "evidence": connections,
                }
            ]
        # 자동 수집 근거도 남깁니다. 명시적 상세와 별도 관측이므로 추가 테스트 건수는 아닙니다.
        if "automatic_checks" not in values:
            ET.SubElement(
                properties, "property", name="automatic_checks", value=values.get("checks", "[]")
            )
        links = list(dict.fromkeys(f"{c['source']} → {c['destination']}" for c in connections))
        replacements = {
            "target": " / ".join(links),
            "criterion": "모듈 연결별 실제 호출 인수·반환 PK/필드·설정 적용 결과를 기대값과 비교",
            "inputs": connections,
            "expected": [{"item": c["item"], "value": c["expected"]} for c in checks],
            "actual": [
                {"item": c["item"], "value": c["actual"], "result": c["result"]} for c in checks
            ],
            "method": "실제 실행 직후의 명시적 비교값 기록. Mock/실제 DB/순수 모듈을 연결별로 구분",
            "exclusions": list(dict.fromkeys(c["exclusions"] for c in connections)),
            "checks": checks,
        }
        for name, value in replacements.items():
            for old in list(properties):
                if old.get("name") == name:
                    properties.remove(old)
            ET.SubElement(
                properties,
                "property",
                name=name,
                value=json.dumps(value, ensure_ascii=False, allow_nan=False),
            )
        count += 1
    if count:
        fd, name = tempfile.mkstemp(prefix=".module-", suffix=".xml", dir=xml_path.parent)
        os.close(fd)
        try:
            tree.write(name, encoding="utf-8", xml_declaration=True)
            os.replace(name, xml_path)
        finally:
            Path(name).unlink(missing_ok=True)
    return count


def print_connections(xml_path: Path) -> None:
    """콘솔에는 연결별 상태만, 실제 필드 값은 XML/Excel에 출력합니다."""
    for case in ET.parse(xml_path).getroot().iter("testcase"):
        prop = case.find("properties/property[@name='module_flow']")
        if prop is None:
            continue
        data = json.loads(prop.get("value", "{}"))
        status = next(
            (
                label
                for tag, label in [("error", "ERROR"), ("failure", "FAIL"), ("skipped", "SKIP")]
                if case.find(tag) is not None
            ),
            "PASS",
        )
        for connection in data["connections"]:
            checks = [c for c in data["checks"] if c["evidence"] == connection]
            observed = f"비교 {len(checks)}개" if checks else "비교 미관측"
            print(
                f"[연결] {connection['source']} → {connection['destination']} : "
                f"{status} / {observed}"
            )
