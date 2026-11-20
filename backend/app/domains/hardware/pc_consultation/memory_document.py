"""Apply reviewed module-shape and board-specific QVL documents to matching parts."""

from .reviewed_documents import document

_SKU = "CT32G48C40U5"
_QVL_SKU = "CT32G48C40U5.M16A1"
_FORM_SOURCE = "MSI:S1102-01-AVL:CT32G48C40U5"
_QVL_SOURCE = "ASUS:B850-PLUS-WIFI:RYZEN7000:CT32G48C40U5.M16A1"


def supplement_memory_check(selected, checks):
    ram = selected.get("ram", {})
    specs = ram.get("specs", {})
    # Some imported modules carry the order code only in the product name.
    words = ram.get("name", "").split()
    supported_skus = (_SKU, _QVL_SKU)
    if not (
        ram.get("brand") == "Crucial"
        and len(words) >= 2
        and words[0] == "Crucial"
        and words[1] in supported_skus
        and ram.get("model_number") in (None, *supported_skus)
        and specs.get("ram_type") == "DDR5"
        and specs.get("capacity_gb") == 32
        and specs.get("modules_per_item") == 1
        and specs.get("speed_mtps") == 4800
        and specs.get("ram_form_factor") in (None, "DIMM")
    ):
        return
    board = selected.get("motherboard", {})
    board_form = board.get("specs", {}).get("ram_form_factor")
    if board_form not in {"DIMM", "SO-DIMM"}:
        return
    cpu = selected.get("cpu", {})
    matches_qvl_platform = (
        board_form == "DIMM"
        and board.get("source_key") == "mb-asus-tuf-gaming-b850-plus-wifi"
        and board.get("brand") == "ASUS"
        and board.get("model_number") == "TUF GAMING B850-PLUS WIFI"
        and cpu.get("source_key") == "amd-ryzen-5-7600"
        and cpu.get("brand") == "AMD"
        and cpu.get("model_number") == "Ryzen 5 7600"
        and cpu.get("specs", {}).get("cpu_family") == "Ryzen 7000"
    )
    for check in checks:
        if check["result"] != "UNKNOWN":
            continue
        if check["check_type"] == "RAM_FORM_FACTOR" and specs.get("ram_form_factor") is None:
            fits = board_form == "DIMM"
            check.update(
                result="PASS" if fits else "FAIL",
                reason=f"메모리 {_SKU}는 UDIMM이고 메인보드 슬롯은 {board_form}입니다. "
                + ("장착 형태가 일치합니다." if fits else "장착 형태가 다릅니다."),
                sources=[document(_FORM_SOURCE)],
            )
        elif check["check_type"] == "RAM_QVL" and matches_qvl_platform:
            revision_known = _QVL_SKU in (words[1], ram.get("model_number"))
            label = (
                "선택한 RAM의 전체 품번이 일치합니다."
                if revision_known
                else f"DB에는 {_SKU}까지만 있어 실물 라벨의 .M16A1을 확인해야 합니다."
            )
            check.update(
                result="CONDITIONAL",
                reason=f"ASUS의 Ryzen 7000용 QVL에 {_QVL_SKU} 32GB가 1개·2개 장착, "
                f"4800 MT/s(XMP, 1.1 V)로 등재됐습니다. {label} "
                "장착 후 BIOS에서 적용 속도와 설정을 확인하세요.",
                sources=[document(_QVL_SOURCE)],
            )
