"""Interpret field-level manufacturer evidence on a resolved selection."""

from re import fullmatch


def _native_storage(ports, drive):
    interface = drive.get("interface") or ""
    if fullmatch(r"SATA (1\.5|3\.0|6\.0) Gb/s", interface) and ports["sata_6g_ports"] > 0:
        return "PASS", "드라이브와 보드 모두 SATA 데이터 포트를 사용합니다."
    if interface.startswith("SAS ") or interface.startswith("PATA "):
        return "FAIL", f"이 보드의 기본 SATA·M.2 포트에 {interface} 장치를 직접 연결할 수 없습니다."
    if interface.startswith("M.2 "):
        if interface == "M.2 SATA" and not ports["m2_sata"]:
            return "FAIL", "이 보드의 저장장치용 M.2 슬롯은 SATA 방식을 지원하지 않습니다."
        return "UNKNOWN", "M.2 장치의 길이·키와 슬롯의 지원 모드·공유 포트를 확인하세요."
    return "UNKNOWN", "저장장치 연결 방식과 보드의 기본 포트를 대조할 근거가 부족합니다."


def add_reviewed_fit(selected, checks):
    fields = {
        "COOLER_SOCKET": (("cpu", "socket"), ("cooler", "sockets")),
        "COOLER_CLEARANCE": (("case", "max_cpu_cooler_mm"), ("cooler", "height_mm")),
        "BOARD_CASE": (("case", "board_sizes"), ("motherboard", "form_factor")),
        "PSU_CASE": (("case", "psu_sizes"), ("psu", "form_factor")),
        "PSU_CLEARANCE": (("case", "max_psu_length_mm"), ("psu", "length_mm")),
        "GPU_CLEARANCE": (("case", "max_gpu_length_mm"), ("gpu", "length_mm")),
        "PSU_CAPACITY": (("gpu", "recommended_psu_w"), ("cpu", "cpu_power_limit_w")),
        "STORAGE_INTERFACE": (("motherboard", "storage_ports"), ("storage", "drive_protocol")),
        "GPU_POWER_CONNECTORS": (("gpu", "required_pcie_8pin"), ("psu", "pcie_8pin_available")),
    }
    specs = {role: row.get("specs", {}) for role, row in selected.items()}
    limit = specs.get("case", {}).get("max_psu_length_mm")
    if "psu" in selected and specs.get("case", {}).get("max_psu_length_mm_source_url"):
        length = specs["psu"].get("length_mm")
        verdict, reason = (
            "UNKNOWN",
            f"기본 배치의 파워 길이 한도는 {limit}mm입니다. 파워 길이를 확인하세요.",
        )
        if type(length) in (int, float) and length > 0:
            verdict = "PASS" if length <= limit else "FAIL"
            reason = f"기본 배치에서 파워 길이 {length}mm / 허용 {limit}mm"
        checks.append({"check_type": "PSU_CLEARANCE", "result": verdict, "reason": reason})
    required = specs.get("gpu", {}).get("required_pcie_8pin")
    if "psu" in selected and type(required) is int and required > 0:
        supplied = specs["psu"].get("pcie_8pin_available")
        verdict, reason = (
            "UNKNOWN",
            f"GPU에 PCIe 8핀 {required}개가 필요합니다. 파워의 케이블 구성을 확인하세요.",
        )
        if type(supplied) is int and supplied >= 0:
            verdict = "PASS" if supplied >= required else "FAIL"
            reason = f"PCIe 보조전원 8핀 필요 {required}개 / 제공 {supplied}개"
        checks.append({"check_type": "GPU_POWER_CONNECTORS", "result": verdict, "reason": reason})
    ports = specs.get("motherboard", {}).get("storage_ports")
    for check in checks:
        code = check["check_type"]
        if (
            code == "STORAGE_INTERFACE"
            and ports
            and "storage" in specs
            and check["result"] == "UNKNOWN"
        ):
            check["result"], check["reason"] = _native_storage(ports, specs["storage"])
        for role, field in fields.get(code, ()):
            row = selected.get(role)
            url = specs.get(role, {}).get(field + "_source_url")
            if not row or not url:
                continue
            sources = check.setdefault("sources", [])
            if any(source["url"] == url for source in sources):
                continue
            sources.append(
                {
                    "chunk_key": f"DB-SPEC-{row['id']}-{field}",
                    "title": row["name"] + " 제조사 사양",
                    "url": url,
                    "origin": "부품 DB의 제조사 사양",
                    "text": f"{field} = {specs[role][field]}",
                }
            )
