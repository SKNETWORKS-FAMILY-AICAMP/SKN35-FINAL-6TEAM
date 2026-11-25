"""Company-scoped, read-only catalog checks for proposed assemblies."""

from math import ceil
from operator import contains, ge

from app.domains.hardware.assembly import AssemblyCheck, AssemblyPart, validate_assembly
from app.domains.hardware.power_planning import rated_watts
from app.domains.hardware.reviewed_fit import add_reviewed_fit

from .reviewed_documents import cooling_evidence

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


def _catalog_capacity(selected):
    """Size the PSU for the selected build. Each row represents one component or RAM kit."""
    total = 0
    for role, row in selected.items():
        if role == "psu":
            continue
        watts = rated_watts(row.get("power_draw_w"))
        if role == "cpu":
            watts = rated_watts(row["specs"].get("cpu_power_limit_w")) or watts
        if watts is None:
            if (
                role not in {"cpu", "gpu"}
                and type(row.get("power_draw_w")) in (int, float)
                and row["power_draw_w"] == 0
            ):
                continue
            return AssemblyCheck("PSU_CAPACITY", "UNKNOWN", f"{LABELS[role]} 소비전력 미확인")
        total += watts
    rating = rated_watts(selected["psu"]["specs"].get("wattage_w"))
    if rating is None:
        return AssemblyCheck("PSU_CAPACITY", "UNKNOWN", "파워 정격 출력 미확인")
    minimum = rated_watts(selected["gpu"]["specs"].get("recommended_psu_w"))
    required = max(ceil(total), minimum or 0)
    reason = f"DB 기준 부품 합계 {total:g}W / 파워 정격 {rating:g}W"
    if minimum:
        reason += f" / GPU 제조사 권장 {minimum:g}W"
    return AssemblyCheck("PSU_CAPACITY", "PASS" if rating >= required else "FAIL", reason)


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
    assembly = [
        AssemblyPart(
            row["id"], row["name"], role, row["specs"], power_draw_w=row.get("power_draw_w")
        )
        for role, row in selected.items()
    ]
    records = {row["compatibility_id"]: row for row in compatibility}
    checks = []
    radiator = selected.get("cooler", {}).get("specs", {}).get("radiator_size_mm")
    front_radiator = radiator if type(radiator) is int and radiator > 0 else None
    for check in validate_assembly(assembly, compatibility, front_radiator_mm=front_radiator):
        if check.check_type == "PSU_CAPACITY" and all(
            role in selected for role in CATEGORY_ORDER if role != "case"
        ):
            check = _catalog_capacity(selected)
        sources = []
        seen_urls = set()
        for record_id in check.compatibility_ids:
            row = records[record_id]
            url = row.get("source_url")
            if url and url.startswith("https://") and url not in seen_urls:
                seen_urls.add(url)
                board = selected["motherboard"]["name"]
                cpu = selected.get("cpu", {}).get("name", "CPU 정보 미입력")
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
    slots = selected.get("motherboard", {}).get("specs", {}).get("pcie_x16_slots")
    board_specs = selected.get("motherboard", {}).get("specs", {})
    slot_present = board_specs.get("pcie_x16_slot_present")
    slot_result = "UNKNOWN"
    slot_reason = "메인보드의 그래픽카드용 PCIe x16 슬롯을 확인해야 합니다."
    if "gpu" in selected and type(slots) is int and slots >= 0:
        slot_result = "PASS" if slots else "FAIL"
        slot_reason = f"메인보드 그래픽카드용 PCIe x16 슬롯 {slots}개"
    elif (
        "gpu" in selected
        and slot_present is True
        and board_specs.get("pcie_x16_slot_present_source_url")
    ):
        slot_result = "PASS"
        slot_reason = "제조사 사양에서 그래픽카드용 PCIe x16 슬롯을 확인했습니다."
    checks.append(
        {
            "check_type": "GPU_BOARD",
            "result": slot_result,
            "reason": slot_reason,
        }
    )
    if front_radiator:
        # A tower height limit cannot verify a radiator installation. Use the
        # case's documented installed GPU clearance for this front mount.
        clearance = next(c for c in checks if c["check_type"] == "GPU_CLEARANCE")
        case = selected.get("case", {}).get("specs", {})
        cooler = selected["cooler"]["specs"]
        stack = cooler.get("radiator_stack_mm")
        base = case.get("max_gpu_length_mm")
        gpu = selected.get("gpu", {}).get("specs", {})
        length = gpu.get("installation_length_mm") or gpu.get("length_mm")
        # When the case lists a supported stack, conservatively reserve its
        # entire depth even if stock fans occupy part of the same clearance.
        if (
            clearance["result"] == "UNKNOWN"
            and front_radiator in case.get("front_radiator_sizes_mm", ())
            and all(type(x) in (float, int) and x > 0 for x in (stack, base, length))
            and stack <= case.get("front_radiator_standard_stack_mm", 0)
        ):
            limit = base - stack
            clearance.update(
                result="PASS" if length <= limit else "FAIL",
                reason=f"전면 라디에이터와 팬 {stack}mm를 확보한 GPU 한도 {limit}mm / 카드 {length}mm",
            )
        cooler_fit = next(c for c in checks if c["check_type"] == "COOLER_CLEARANCE")
        cooler_fit.update(
            result=clearance["result"], reason=clearance["reason"], sources=clearance["sources"]
        )
    gpu = selected.get("gpu", {}).get("specs", {})
    if "psu" in selected and gpu.get("required_pcie_16pin"):
        checks.append(
            _fit(
                selected,
                "GPU_POWER_CONNECTORS",
                "16핀 케이블 용량(W)",
                "psu",
                "pcie_16pin_capacity_w",
                "gpu",
                "gpu_power_w",
                ge,
            )
        )
    qvl = next(c for c in checks if c["check_type"] == "RAM_QVL")
    shape = next(c for c in checks if c["check_type"] == "RAM_FORM_FACTOR")
    if shape["result"] == "UNKNOWN" and qvl["result"] == "CONDITIONAL" and qvl["sources"]:
        # An official test with this board and kit establishes physical fit for
        # the pair even when one catalog row omits the form-factor label.
        shape.update(
            result="PASS",
            reason="이 보드·메모리 키트의 실제 장착은 제조사 QVL에서 확인했습니다.",
            sources=qvl["sources"],
            compatibility_ids=qvl["compatibility_ids"],
        )
    add_reviewed_fit(selected, checks)
    cooler = selected.get("cooler", {})
    tested = cooler.get("specs", {})
    cpu_name = selected.get("cpu", {}).get("name")
    if cpu_name in tested.get("thermal_test_cpus", ()) and (
        url := tested.get("thermal_test_cpus_source_url")
    ):
        thermal = next(c for c in checks if c["check_type"] == "COOLER_POWER")
        if thermal["result"] == "UNKNOWN":
            reason = f"{cpu_name} · {cooler['name']} 조합의 CPU 부하 냉각 시험이 확인되었습니다."
            thermal.update(
                result="PASS",
                reason=reason,
                sources=[
                    {
                        "chunk_key": f"DB-COOLING-TEST-{cooler['id']}",
                        "url": url,
                        "title": f"{cooler['name']} 냉각 시험",
                        "text": reason,
                        "origin": "제품 실측",
                    }
                ],
            )
    if "cpu" in selected and "cooler" in selected:
        source = cooling_evidence(selected["cpu"], selected["cooler"])
        if source:
            for check in checks:
                if (
                    check["check_type"] in {"COOLER_SOCKET", "COOLER_POWER"}
                    and check["result"] == "UNKNOWN"
                ):
                    check.update(result="PASS", reason=source["text"], sources=[source])
    selected_ids = set(selection.values())
    for record in compatibility:
        if (
            record["check_type"] == "KNOWN_CONFLICT"
            and record["support_status"] == "UNSUPPORTED"
            and {record["part_a_id"], record["part_b_id"]} <= selected_ids
        ):
            checks.append(
                {
                    "check_type": "KNOWN_CONFLICT",
                    "result": "FAIL",
                    "reason": "선택한 부품 사이에 지원되지 않는 조합이 등록되어 있습니다.",
                    "compatibility_ids": [record["compatibility_id"]],
                }
            )
    return checks
