"""Company-scoped, read-only demo catalog and checks for proposed assemblies."""

from operator import contains, ge

from app.domains.hardware.assembly import validate_assembly

from .cooling_documents import supplement_cooling_check
from .fit_documents import supplement_checks
from .memory_document import supplement_memory_check
from .power_documents import assembly_power_parts, supplement_power_checks

LABELS = {
    "cpu": "CPU",
    "motherboard": "메인보드",
    "ram": "RAM",
    "gpu": "GPU",
    "storage": "저장소",
    "cooler": "쿨러",
    "psu": "파워",
    "case": "케이스",
}
CATEGORY_ORDER = tuple(LABELS)


def _fit(selected, code, label, host, limit_key, component, size_key, accepts):
    limits = selected.get(host, {}).get("specs", {})
    limit = limits.get(limit_key)
    if limit_key == "max_cpu_cooler_mm" and limit is None:
        limit = limits.get("max_cooler_height_mm")
    size = selected.get(component, {}).get("specs", {}).get(size_key)
    if accepts is contains:
        comparable = isinstance(limit, (list, tuple)) and isinstance(size, str)
    else:
        comparable = all(type(value) in {int, float} and value > 0 for value in (limit, size))
    if not comparable:
        return {
            "check_type": code,
            "result": "UNKNOWN",
            "reason": f"{label} 비교에 필요한 사양이 없습니다.",
        }
    limit_text = ", ".join(limit) if isinstance(limit, list) else str(limit)
    return {
        "check_type": code,
        "result": "PASS" if accepts(limit, size) else "FAIL",
        "reason": f"{label} · {LABELS[component]} {size} / {LABELS[host]} 허용 {limit_text}",
    }


def validate_selection(selection: dict[str, int], parts, compatibility=()) -> list[dict]:
    """Evaluate the complete or partial configuration. Each selected ID is one SKU or kit."""
    indexed = parts if isinstance(parts, dict) else {part["id"]: part for part in parts}
    selected = {}
    for category, part_id in selection.items():
        row = indexed.get(part_id) if type(part_id) is int else None
        if category not in CATEGORY_ORDER or not row or row["category"] != category:
            raise ValueError("부품 ID와 분류가 해당 기업의 카탈로그와 일치하지 않습니다.")
        selected[category] = row
    assembly = assembly_power_parts(selected)
    records = {row["compatibility_id"]: row for row in compatibility}
    checks = []
    for check in validate_assembly(assembly, compatibility):
        sources = []
        seen_urls = set()
        for record_id in check.compatibility_ids:
            row = records[record_id]
            url = row.get("source_url")
            if url and url.startswith("https://") and url not in seen_urls:
                seen_urls.add(url)
                board = selected["motherboard"]["name"]
                cpu = selected["cpu"]["name"]
                is_memory = check.check_type == "RAM_QVL"
                target = f"{cpu} · {selected['ram']['name']}" if is_memory else cpu
                label = "메모리 QVL" if is_memory else "CPU 지원 목록"
                sources.append(
                    {
                        "chunk_key": f"DB-COMPAT-{record_id}",
                        "title": f"{board} {label}",
                        "url": url,
                        "origin": "부품 DB의 제조사 호환 근거",
                        "text": f"{board} / {target}. {check.reason}",
                    }
                )
        checks.append(
            {
                "check_type": check.check_type,
                "result": check.result,
                "reason": check.reason,
                "compatibility_ids": list(check.compatibility_ids),
                "sources": sources,
            }
        )
    checks.extend(
        [
            _fit(
                selected,
                "BOARD_CASE",
                "보드 규격",
                "case",
                "board_sizes",
                "motherboard",
                "form_factor",
                contains,
            ),
            _fit(
                selected,
                "COOLER_SOCKET",
                "쿨러 소켓",
                "cooler",
                "sockets",
                "cpu",
                "socket",
                contains,
            ),
            _fit(
                selected,
                "COOLER_CLEARANCE",
                "쿨러 높이(mm)",
                "case",
                "max_cpu_cooler_mm",
                "cooler",
                "height_mm",
                ge,
            ),
            _fit(
                selected,
                "COOLER_POWER",
                "냉각 용량(W)",
                "cooler",
                "cooling_limit_w",
                "cpu",
                "cpu_power_limit_w",
                ge,
            ),
            _fit(
                selected,
                "STORAGE_INTERFACE",
                "SSD 규격",
                "motherboard",
                "supported_drives",
                "storage",
                "interface",
                contains,
            ),
            _fit(
                selected,
                "PSU_CASE",
                "파워 규격",
                "case",
                "psu_sizes",
                "psu",
                "form_factor",
                contains,
            ),
        ]
    )
    checks = supplement_checks(selected, checks)
    supplement_memory_check(selected, checks)
    supplement_cooling_check(selected, checks)
    supplement_power_checks(selected, checks)
    return checks
