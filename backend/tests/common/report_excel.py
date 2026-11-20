"""JUnit XML을 같은 이름의 Excel로 내보냅니다. 외부 패키지를 사용하지 않습니다."""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
INVALID_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _number(value: str | None) -> float:
    number = float(value or 0)
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"유효하지 않은 JUnit 숫자: {value}")
    return number


def _sheet(rows: list[list], widths: list[int], freeze: int) -> bytes:
    root = ET.Element("worksheet", xmlns=NS)
    view = ET.SubElement(
        ET.SubElement(root, "sheetViews"),
        "sheetView",
        workbookViewId="0",
        showGridLines="0",
    )
    if freeze:
        ET.SubElement(
            view,
            "pane",
            ySplit=str(freeze),
            topLeftCell=f"A{freeze + 1}",
            activePane="bottomLeft",
            state="frozen",
        )
    cols = ET.SubElement(root, "cols")
    for i, width in enumerate(widths, 1):
        ET.SubElement(cols, "col", min=str(i), max=str(i), width=str(width), customWidth="1")
    data = ET.SubElement(root, "sheetData")
    for row_index, values in enumerate(rows, 1):
        row = ET.SubElement(
            data,
            "row",
            r=str(row_index),
            ht="36" if row_index > 1 and len(widths) > 2 else "24",
            customHeight="1",
        )
        for col_index, value in enumerate(values):
            # Both output sheets have fewer than 26 columns.
            cell = ET.SubElement(
                row,
                "c",
                r=f"{chr(65 + col_index)}{row_index}",
                s="1" if row_index == 1 else "0",
            )
            if isinstance(value, (int, float)):
                ET.SubElement(cell, "v").text = str(value)
            else:
                cell.set("t", "inlineStr")
                text = ET.SubElement(ET.SubElement(cell, "is"), "t")
                text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                # inlineStr also prevents XML-supplied text from becoming formulas.
                text.text = INVALID_XML.sub("", str(value or ""))[:32767]
    if len(widths) > 2 and len(rows) > 1:
        ET.SubElement(root, "autoFilter", ref=f"A1:{chr(64 + len(widths))}{len(rows)}")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def export_junit_excel(xml_path: Path) -> Path:
    """XML은 보존하고 .xlsx를 원자적으로 저장합니다. 잘못된 XML은 예외를 냅니다."""
    xml_path = Path(xml_path)
    try:
        root = ET.parse(xml_path).getroot()
    except ET.ParseError as error:
        raise ValueError(f"잘못된 JUnit XML: {error}") from error
    if root.tag not in {"testsuite", "testsuites"}:
        raise ValueError("JUnit testsuite/testsuites 형식이 아닙니다.")
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    if not suites:
        raise ValueError("JUnit testsuite가 없습니다.")
    # Only leaf suites own counters; aggregating parent counters double-counts tests.
    leaves = [suite for suite in suites if not suite.findall("testsuite")]
    total = sum(int(_number(s.get("tests"))) for s in leaves)
    failures = sum(int(_number(s.get("failures"))) for s in leaves)
    errors = sum(int(_number(s.get("errors"))) for s in leaves)
    skipped = sum(int(_number(s.get("skipped"))) for s in leaves)
    if failures + errors + skipped > total:
        raise ValueError("JUnit 결과 건수가 전체 건수를 초과합니다.")
    details = [
        [
            "번호",
            "스위트",
            "모듈/클래스",
            "테스트명",
            "결과",
            "시간(초)",
            "오류 상세",
            "검증 대상",
            "검증 기준",
            "기대값",
            "실제값",
            "입력/사전조건",
            "비교 방법",
            "검증 제외 범위",
            "테스트 위치",
            "오류 유형",
        ]
    ]
    checks_rows = [
        [
            "상위 ID",
            "상위 검증 그룹",
            "상위 결과",
            "하위 ID",
            "확인 요소",
            "기대값",
            "실제값",
            "비교 결과",
            "근거/확인 사항",
        ]
    ]
    for suite in suites:
        for case in suite.findall("testcase"):
            status, messages = "통과", []
            for tag, label in (
                ("failure", "실패"),
                ("error", "오류"),
                ("skipped", "건너뜀"),
            ):
                nodes = case.findall(tag)
                if nodes and status == "통과":
                    status = label
                for node in nodes:
                    messages.append(
                        "\n".join(
                            filter(
                                None,
                                [
                                    node.get("message", ""),
                                    "".join(node.itertext()).strip(),
                                ],
                            )
                        )
                    )
            properties = {
                p.get("name"): p.get("value", "") for p in case.findall("properties/property")
            }

            def property_text(value: str) -> str:
                try:
                    decoded = json.loads(value)
                    return (
                        decoded
                        if isinstance(decoded, str)
                        else json.dumps(decoded, ensure_ascii=False, indent=2)
                    )
                except ValueError, TypeError:
                    return value

            parent_id = len(details)
            checks = json.loads(properties.get("checks", "[]"))
            for index, check in enumerate(checks, 1):

                def display(value):
                    return (
                        value
                        if isinstance(value, str)
                        else json.dumps(value, ensure_ascii=False, indent=2)
                    )

                checks_rows.append(
                    [
                        parent_id,
                        property_text(properties.get("target", "")) or case.get("name", ""),
                        status,
                        f"{parent_id}.{index:03d}",
                        check.get("item", ""),
                        display(check.get("expected")),
                        display(check.get("actual")),
                        check.get("result", "미기록"),
                        display(check.get("evidence", "")),
                    ]
                )
            details.append(
                [
                    len(details),
                    suite.get("name", ""),
                    case.get("classname", ""),
                    case.get("name", ""),
                    status,
                    _number(case.get("time")),
                    "\n".join(messages),
                    *(
                        property_text(properties.get(k, ""))
                        for k in ("target", "criterion", "expected", "actual")
                    ),
                    *(
                        property_text(properties.get(k, "")) or "미기록"
                        for k in ("inputs", "method", "exclusions", "location")
                    ),
                    "; ".join(
                        dict.fromkeys(
                            node.get("type", tag)
                            for tag in ("failure", "error", "skipped")
                            for node in case.findall(tag)
                        )
                    ),
                ]
            )
    summary = [
        ["항목", "값"],
        ["소스 XML", xml_path.name],
        [
            "실행 시각(원본 시간대)",
            "; ".join(dict.fromkeys(s.get("timestamp", "") for s in leaves)),
        ],
        ["전체(XML 집계)", total],
        ["통과", total - failures - errors - skipped],
        ["실패", failures],
        ["오류", errors],
        ["건너뜀", skipped],
        ["총 시간(초)", sum(_number(s.get("time")) for s in leaves)],
        ["상세 testcase 수", len(details) - 1],
        ["집계와 상세 차이", total - (len(details) - 1)],
        [
            "집계 안내",
            "pytest subtests 등으로 XML 집계와 testcase 행 수가 다를 수 있습니다.",
        ],
    ]
    content_types = """<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"""
    workbook = f'''<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="요약" sheetId="1" r:id="rId1"/><sheet name="테스트 상세" sheetId="2" r:id="rId2"/></sheets></workbook>'''
    rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    rel_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    rels = f'''<Relationships xmlns="{rel_ns}"><Relationship Id="rId1" Type="{rel_type}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="{rel_type}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="{rel_type}/styles" Target="styles.xml"/></Relationships>'''
    styles = f'''<styleSheet xmlns="{NS}"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EAED"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'''
    summary.extend(
        [
            ["하위 요소 기록 testcase 수", len({row[0] for row in checks_rows[1:]})],
            [
                "하위 요소 미관측 testcase 수",
                len(details) - 1 - len({row[0] for row in checks_rows[1:]}),
            ],
            ["하위 비교 요소 수", len(checks_rows) - 1],
            ["하위 불일치 수", sum(row[7] == "불일치" for row in checks_rows[1:])],
            [
                "계층 집계 안내",
                "상위 testcase는 실제 pytest 실행 건수, 하위 요소는 내부 비교 내역입니다. 서로 합산하지 않습니다. 메타데이터가 없는 테스트는 하위 요소를 생성하지 않습니다.",
            ],
        ]
    )
    content_types = content_types.replace(
        "</Types>",
        '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    )
    workbook = workbook.replace(
        "</sheets>", '<sheet name="검증 요소 상세" sheetId="3" r:id="rId4"/></sheets>'
    )
    rels = rels.replace(
        "</Relationships>",
        f'<Relationship Id="rId4" Type="{rel_type}/worksheet" Target="worksheets/sheet3.xml"/></Relationships>',
    )
    destination = xml_path.with_suffix(".xlsx")
    fd, temp_name = tempfile.mkstemp(prefix=".excel-", suffix=".tmp", dir=destination.parent)
    os.close(fd)
    try:
        with ZipFile(temp_name, "w", ZIP_DEFLATED) as archive:
            archive.writestr("[Content_Types].xml", content_types)
            archive.writestr(
                "_rels/.rels",
                f'<Relationships xmlns="{rel_ns}"><Relationship Id="rId1" Type="{rel_type}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
            )
            archive.writestr("xl/workbook.xml", workbook)
            archive.writestr("xl/_rels/workbook.xml.rels", rels)
            archive.writestr("xl/styles.xml", styles)
            archive.writestr(
                "xl/worksheets/sheet3.xml",
                _sheet(checks_rows, [10, 50, 12, 14, 80, 70, 70, 14, 100], 1),
            )
            archive.writestr("xl/worksheets/sheet1.xml", _sheet(summary, [30, 90], 1))
            archive.writestr(
                "xl/worksheets/sheet2.xml",
                _sheet(details, [8, 36, 48, 70, 12, 14, 70, 48, 90, 70, 70, 70, 80, 80, 70, 28], 1),
            )
        os.replace(temp_name, destination)
    finally:
        Path(temp_name).unlink(missing_ok=True)
    return destination
