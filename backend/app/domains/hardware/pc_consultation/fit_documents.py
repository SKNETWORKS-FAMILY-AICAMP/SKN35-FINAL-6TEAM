"""Apply reviewed manufacturer specifications to their exact catalog variants."""


def _source(key, title, url, text):
    return dict(chunk_key=key, title=title, url=url, text=text, origin="제조사 규격 문서")


# These passages summarize parts of the original spec sheets. Keep their keys
# stable so the consultation can cite the same evidence as the fit checks.
_CASES = {
    "H5": (170, "https://support.nzxt.com/hc/en-us/articles/40225168535451-H5-Flow-2024-Specs"),
    "H7": (185, "https://support.nzxt.com/hc/en-us/articles/40379376386203-H7-Flow-2024-Specs"),
}
_BOARDS = {
    "mb-b650-tomahawk": (
        "MSI",
        "MAG B650 TOMAHAWK WIFI",
        6,
        "https://www.msi.com/Motherboard/MAG-B650-TOMAHAWK-WIFI/Specification",
    ),
    "mb-asus-tuf-gaming-b850-plus-wifi": (
        "ASUS",
        "TUF GAMING B850-PLUS WIFI",
        4,
        "https://dlcdnets.asus.com/pub/ASUS/mb/SocketAM5/TUF_GAMING_B850-PLUS_WIFI/E24425_TUF_GAMING_B850-PLUS_WIFI_UM_WEB.pdf",
    ),
}
_COOLER = _source(
    "FIT:PEERLESS-ASSASSIN-120-SE",
    "Thermalright Peerless Assassin 120 SE 규격",
    "https://www.thermalright.com/product/peerless-assassin-120-se/",
    "Peerless Assassin 120 SE의 방열판 높이는 155 mm다. 높은 RAM에 맞춰 팬을 올리면 "
    "실제 장착 높이와 케이스 여유 공간을 다시 확인해야 한다.",
)


def _case_facts(row):
    if row.get("brand") != "NZXT" or row.get("category") != "case":
        return None
    color = row["specs"].get("color")
    if color not in ("Black", "White"):
        return None
    for series, (height, url) in _CASES.items():
        name = f"{series} Flow (2024)"
        if (
            row.get("source_key") == f"case-nzxt-{series.lower()}-flow-2024-{color.lower()}"
            and row.get("model_number") == f"{name} {color}"
        ):
            return height, _source(
                f"FIT:NZXT-{series}-FLOW-2024",
                f"NZXT {name} 규격",
                url,
                f"{name}는 ATX, Micro-ATX, Mini-ITX 보드를 지원한다. 후면 커넥터 보드는 "
                f"지원하지 않는다. CPU 쿨러 높이 한도는 {height} mm, 파워 길이 한도는 200 mm다.",
            )
    return None


def _board_document(row):
    key = row.get("source_key")
    if key not in _BOARDS or row.get("category") != "motherboard":
        return None
    brand, model, sata_ports, url = _BOARDS[key]
    if (row.get("brand"), row.get("model_number")) != (brand, model):
        return None
    return _source(
        f"FIT:{key.upper()}",
        f"{brand} {model} 규격",
        url,
        f"{model}은 ATX 메인보드다. SATA 6 Gb/s 포트가 {sata_ports}개 있으며 "
        "M.2_1에는 2280 규격의 PCIe SSD를 장착할 수 있다.",
    )


def _agrees_with_options(specs, key, expected):
    options = specs.get(key)
    return options is None or (isinstance(options, (list, tuple)) and expected in options)


def supplement_checks(selected, checks):
    """Keep the DB verdict unless an exact, relevant document fills a missing field."""
    case = selected.get("case", {})
    case_facts = _case_facts(case)
    board = selected.get("motherboard", {})
    board_doc = _board_document(board)
    case_specs = case.get("specs", {})
    board_specs = board.get("specs", {})
    cooler = selected.get("cooler", {})
    drive_specs = selected.get("storage", {}).get("specs", {})
    result = []
    for check in checks:
        code = check["check_type"]
        if check["result"] not in ("PASS", "UNKNOWN"):
            result.append(check)
            continue
        verdict = check["result"]
        reason = check["reason"]
        sources = []
        if code == "BOARD_CASE" and case_facts and board_doc:
            if board_specs.get("form_factor") == "ATX" and _agrees_with_options(
                case_specs, "board_sizes", "ATX"
            ):
                verdict, reason = (
                    "PASS",
                    "메인보드는 ATX 규격이며 이 케이스가 ATX 장착을 지원합니다.",
                )
                sources = [case_facts[1], board_doc]
        elif code == "COOLER_CLEARANCE" and case_facts and cooler:
            limit, case_doc = case_facts
            height = cooler["specs"].get("height_mm")
            is_reviewed_cooler = (
                cooler.get("source_key") == "cooler-thermalright-peerless-assassin-120-se"
                and cooler.get("brand") == "Thermalright"
                and cooler.get("model_number") == "Peerless Assassin 120 SE"
                and cooler["specs"].get("color") == "Black / Silver"
            )
            recorded_limits = [
                case_specs[k]
                for k in ("max_cpu_cooler_mm", "max_cooler_height_mm")
                if case_specs.get(k) is not None
            ]
            if (
                is_reviewed_cooler
                and height == 155
                and all(recorded == limit for recorded in recorded_limits)
            ):
                verdict = "PASS"
                reason = (
                    f"기본 장착 높이 {height} mm가 케이스 한도 {limit} mm 이내입니다. "
                    "RAM 위로 팬을 올리면 장착 높이를 다시 확인하세요."
                )
                sources = [case_doc, _COOLER]
        elif code == "STORAGE_INTERFACE" and board_doc and drive_specs.get("type") == "SSD":
            interface = drive_specs.get("interface")
            form = drive_specs.get("form_factor")
            connector = None
            if interface == "SATA 6.0 Gb/s" and form in (2.5, "2.5"):
                connector = "2.5인치 SATA SSD와 보드의 SATA 6 Gb/s 포트가 일치합니다."
            elif interface in ("M.2 PCIe 3.0 X4", "M.2 PCIe 4.0 X4") and form == "M.2-2280":
                connector = "2280 PCIe SSD가 보드의 M.2_1 슬롯 규격과 일치합니다."
            if connector and _agrees_with_options(board_specs, "supported_drives", interface):
                verdict, reason, sources = (
                    "PASS",
                    connector + " 빈 포트를 기준으로 합니다.",
                    [board_doc],
                )
        elif (
            code == "PSU_CASE"
            and verdict == "UNKNOWN"
            and case_facts
            and selected.get("psu")
            and case_specs.get("max_psu_length_mm", 200) == 200
        ):
            reason = "케이스가 허용하는 파워 길이는 200 mm입니다. 파워 장착 규격과 실제 길이 대조가 필요합니다."
            sources = [case_facts[1]]
        result.append(
            {**check, "result": verdict, "reason": reason, "sources": sources} if sources else check
        )
    return result
