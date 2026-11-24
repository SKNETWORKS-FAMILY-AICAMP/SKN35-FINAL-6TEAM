"""Interpret field-level manufacturer evidence on a resolved selection."""

from re import fullmatch


def m2_drive(drive):
    interface = str(drive.get("interface") or "")
    size = fullmatch(r"M\.2-(22\d{2,3})", str(drive.get("form_factor") or ""))
    if size and interface.startswith("M.2 PCIe "):
        return "pcie", size[1]
    if size and interface == "M.2 SATA":
        return "sata", size[1]
    legacy = fullmatch(r"M\.2 (22\d{2,3}) (NVMe|SATA)", interface)
    if legacy and (not drive.get("form_factor") or (size and size[1] == legacy[1])):
        return ("pcie" if legacy[2] == "NVMe" else "sata"), legacy[1]
    return None, None


def _native_storage(ports, drive, slots):
    interface = str(drive.get("interface") or "")
    if fullmatch(r"SATA (1\.5|3\.0|6\.0) Gb/s", interface) and ports.get("sata_6g_ports", 0) > 0:
        return "PASS", "드라이브와 보드 모두 SATA 데이터 포트를 사용합니다."
    if interface.startswith("SAS ") or interface.startswith("PATA "):
        return "FAIL", f"이 보드의 기본 SATA·M.2 포트에 {interface} 장치를 직접 연결할 수 없습니다."
    if interface.startswith("M.2 "):
        protocol, size = m2_drive(drive)
        if (interface == "M.2 SATA" or protocol == "sata") and ports.get("m2_sata") is False:
            return "FAIL", "이 보드의 저장장치용 M.2 슬롯은 SATA 방식을 지원하지 않습니다."
        if protocol:
            for slot in slots:
                if size in slot.get(protocol, ()):
                    return (
                        "PASS",
                        f"{slot['name']} 슬롯이 {protocol.upper()} 방식과 {size} 규격을 지원합니다.",
                    )
        return "UNKNOWN", "M.2 장치의 길이·키와 슬롯의 지원 모드·공유 포트를 확인하세요."
    return "UNKNOWN", "저장장치 연결 방식과 보드의 기본 포트를 대조할 근거가 부족합니다."


def add_reviewed_fit(selected, checks):
    fields = {
        "GPU_BOARD": (("motherboard", "pcie_x16_slots"), ("motherboard", "pcie_x16_slot_present")),
        "COOLER_SOCKET": (("cpu", "socket"), ("cooler", "sockets")),
        "COOLER_CLEARANCE": (("case", "max_cpu_cooler_mm"), ("cooler", "height_mm")),
        "BOARD_CASE": (("case", "board_sizes"), ("motherboard", "form_factor")),
        "PSU_CASE": (("case", "psu_sizes"), ("psu", "form_factor")),
        "PSU_CLEARANCE": (("case", "max_psu_length_mm"), ("psu", "length_mm")),
        "GPU_CLEARANCE": (
            ("case", "max_gpu_length_mm"),
            ("gpu", "installation_length_mm"),
            ("gpu", "length_mm"),
        ),
        "PSU_CAPACITY": (("gpu", "recommended_psu_w"), ("cpu", "cpu_power_limit_w")),
        "STORAGE_INTERFACE": (
            ("motherboard", "storage_ports"),
            ("motherboard", "m2_storage_slots"),
            ("storage", "drive_protocol"),
        ),
    }
    specs = {role: row.get("specs", {}) for role, row in selected.items()}
    limit = specs.get("case", {}).get("max_psu_length_mm")
    if "psu" in selected and type(limit) in (int, float) and limit > 0:
        length = specs["psu"].get("length_mm")
        verdict, reason = (
            "UNKNOWN",
            f"기본 배치의 파워 길이 한도는 {limit}mm입니다. 파워 길이를 확인하세요.",
        )
        if type(length) in (int, float) and length > 0:
            verdict = "PASS" if length <= limit else "FAIL"
            reason = f"기본 배치에서 파워 길이 {length}mm / 허용 {limit}mm"
        checks.append({"check_type": "PSU_CLEARANCE", "result": verdict, "reason": reason})
    ports = specs.get("motherboard", {}).get("storage_ports")
    slots = specs.get("motherboard", {}).get("m2_storage_slots") or []
    drive = specs.get("storage", {})
    for check in checks:
        code = check["check_type"]
        if (
            code == "BOARD_CASE"
            and specs.get("motherboard", {}).get("back_connect") is True
            and specs.get("case", {}).get("supports_back_connect") is False
        ):
            check.update(
                result="FAIL", reason="케이스가 보드의 후면 커넥터 배치를 지원하지 않습니다."
            )
        if (
            code == "STORAGE_INTERFACE"
            and (ports or slots)
            and drive
            and (
                check["result"] == "UNKNOWN"
                or (slots and str(drive.get("interface") or "").startswith("M.2 "))
            )
        ):
            check["result"], check["reason"] = _native_storage(ports or {}, drive, slots)
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
