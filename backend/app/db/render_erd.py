"""Generate Mermaid and Graphviz ERDs from the existing parts_catalog.sql columns."""

import html
import re
import shutil
import subprocess
from pathlib import Path

from app.db.schema import SCHEMA_PATH

ERD = Path(__file__).resolve().parents[3] / "docs" / "database" / "erd"

LABELS = {
    "users": "사용자",
    "consultations": "상담",
    "messages": "대화",
    "parts": "부품",
    "quotes": "결제 완료 견적",
    "quote_items": "견적 항목",
    "part_compatibility": "공식 호환성 근거",
    "quote_validations": "견적 검증 결과",
}
RELATIONS = [
    ("users", "user_id", "consultations", "user_id", "상담 생성", False),
    ("consultations", "consultation_id", "messages", "consultation_id", "대화 기록", False),
    ("users", "user_id", "quotes", "user_id", "결제 견적", False),
    ("quotes", "quote_id", "quote_items", "quote_id", "견적 구성", False),
    ("parts", "part_id", "quote_items", "part_id", "선택 부품", False),
    ("parts", "part_id", "part_compatibility", "part_a_id", "부품 A", False),
    ("parts", "part_id", "part_compatibility", "part_b_id", "부품 B", False),
    ("quotes", "quote_id", "quote_validations", "quote_id", "견적 검증", False),
    ("quote_items", "quote_item_id", "quote_validations", "item_a_id", "검증 대상 A", True),
    ("quote_items", "quote_item_id", "quote_validations", "item_b_id", "검증 대상 B", True),
    (
        "part_compatibility",
        "compatibility_id",
        "quote_validations",
        "compatibility_id",
        "참조 근거",
        True,
    ),
]


def main():
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    definitions = re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\) ENGINE", sql, re.S)
    mermaid = ["erDiagram"]
    dot = [
        "digraph ERD {",
        f'graph [rankdir=LR, bgcolor="white", nodesep=0.7, ranksep=1.5, pad=0.4, splines=spline, fontname="Malgun Gothic", label="PC 견적 데이터베이스 | {len(definitions)} tables | 점선: 비식별관계 | 금액: 본체 부품만 합산", labelloc=t, fontsize=20];',
        'node [shape=plain, fontname="Malgun Gothic"];',
        'edge [style=dashed, color="#64748b", fontname="Malgun Gothic", fontsize=11, dir=both];',
    ]
    for name, definition in definitions:
        fields = re.findall(
            r"^    (\w+) ((?:BIGINT|VARCHAR|CHAR|INT|TEXT|JSON|DECIMAL|DATETIME)(?:\([^)]*\))?)([^\n]*)",
            definition,
            re.M,
        )
        pk = re.search(r"PRIMARY KEY \((\w+)\)", definition)[1]
        fks = {r[3] for r in RELATIONS if r[2] == name}
        unique_columns = set(re.findall(r"^    UNIQUE KEY \w+ \((\w+)\),?$", definition, re.M))
        mermaid.append(f"    {name} {{")
        table = [
            '<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="7" COLOR="#cbd5e1">',
            f'<TR><TD COLSPAN="3" BGCOLOR="#dbeafe"><B>{name} · {LABELS[name]}</B></TD></TR>',
            "<TR><TD><B>키</B></TD><TD><B>컬럼</B></TD><TD><B>자료형</B></TD></TR>",
        ]
        for field, dtype, rest in fields:
            keys = [
                key
                for applies, key in (
                    (field == pk, "PK"),
                    (field in fks, "FK"),
                    (field in unique_columns, "UK"),
                )
                if applies
            ]
            key = ", ".join(keys)
            mermaid.append(
                f"        {dtype.split('(')[0].lower()} {field}" + (f" {key}" if key else "")
            )
            nullable = " ?" if " NULL" in rest and "NOT NULL" not in rest else ""
            table.append(
                f'<TR><TD PORT="{field}_in">{key}</TD><TD ALIGN="LEFT">{html.escape(field)}</TD><TD PORT="{field}_out" ALIGN="LEFT">{html.escape(dtype + nullable)}</TD></TR>'
            )
        table.append("</TABLE>")
        dot.append(f"{name} [label=<" + "".join(table) + ">];")
        mermaid.append("    }")
    for parent, pk, child, fk, label, optional in RELATIONS:
        mermaid.append(
            f"    {parent} " + ("|o" if optional else "||") + f'..o{{ {child} : "{label}"'
        )
        dot.append(
            f'{parent}:{pk}_out:e -> {child}:{fk}_in:w [label="{label}", arrowtail="'
            + ("teeodot" if optional else "teetee")
            + '", arrowhead="crowodot"];'
        )
    dot.append("}")
    out = ERD
    out.mkdir(parents=True, exist_ok=True)
    (out / "schema.mmd").write_text("\n".join(mermaid) + "\n", encoding="utf-8", newline="\n")
    (out / "schema.dot").write_text("\n".join(dot) + "\n", encoding="utf-8", newline="\n")
    executable = shutil.which("dot")
    if not executable:
        raise ValueError("SVG/PNG 생성에는 Graphviz의 dot 명령이 필요합니다.")
    for extension in ("svg", "png"):
        subprocess.run(
            [
                executable,
                "-T" + extension,
                str(out / "schema.dot"),
                "-o",
                str(out / f"schema.{extension}"),
            ],
            check=True,
        )
    svg = out / "schema.svg"
    svg.write_text(svg.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    print("ERD 저장 완료: " + str(out / "schema.svg"))


if __name__ == "__main__":
    main()
