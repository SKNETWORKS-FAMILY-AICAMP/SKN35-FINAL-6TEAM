"""Match manufacturer power evidence to the selected DB variants."""

from app.domains.hardware.assembly import AssemblyPart
from app.domains.hardware.power_planning import ESTIMATE_FIELD, rated_watts

from .reviewed_documents import document

_TWIN_EDGE = "docyx:f9039c30cb23d1ae258bd6f637c65e3f72fdac360dcdfe550e47fe5d0805d8b9"
_APX = "docyx:b47683f9e9c8793111a3cfefdd951b1962ece49c4399c668a9cbd98c464b3772"
_ZOTAC_BROCHURES = {
    "ZT-A30600E-10M": "POWER:ZOTAC-3060-TWIN-EDGE-E",
    "ZT-A30600E2-10M": "POWER:ZOTAC-3060-TWIN-EDGE-E2",
}


def _gpu_documents(row):
    specs = row.get("specs", {})
    if not (
        row.get("source_key") == _TWIN_EDGE
        and row.get("brand") == "Zotac"
        and specs.get("chipset") == "GeForce RTX 3060 12GB"
        and specs.get("vram_gb") == 12
        and specs.get("boost_clock_mhz") == 1777
        and specs.get("length_mm") in (224, 224.1)
    ):
        return ()
    revision = row.get("model_number")
    if revision is None:
        # The DB identifies the non-OC model but does not distinguish these two
        # revisions. Both brochures give the same wattages and connector.
        return tuple(_ZOTAC_BROCHURES.values())
    if revision in _ZOTAC_BROCHURES:
        return (_ZOTAC_BROCHURES[revision],)
    return ()


def _gpu_power_agrees(row):
    specs = row["specs"]
    return (
        row.get("power_draw_w") in (None, 170)
        and specs.get("gpu_power_w") in (None, 170)
        and specs.get("recommended_psu_w") in (None, 600)
    )


def _is_apx_650(row):
    specs = row.get("specs", {})
    return (
        row.get("source_key") == _APX
        and row.get("brand") == "Montech"
        and row.get("model_number") in (None, "APX 650W")
        and specs.get("wattage_w") == 650
        and specs.get("form_factor") == "ATX"
        and specs.get("modular") is False
        and specs.get("efficiency") == "plus"
    )


def _is_h5_2024(row):
    color = row.get("specs", {}).get("color")
    return (
        row.get("brand") == "NZXT"
        and color in ("White", "Black")
        and row.get("source_key") == f"case-nzxt-h5-flow-2024-{color.lower()}"
        and row.get("model_number") == f"H5 Flow (2024) {color}"
    )


def assembly_power_parts(selected):
    """Pass verified power fields into the existing calculation without changing DB rows."""
    parts = []
    for kind, row in selected.items():
        specs = row["specs"]
        draw = row.get("power_draw_w")
        if kind == "gpu" and _gpu_documents(row) and _gpu_power_agrees(row):
            specs = dict(specs, recommended_psu_w=600, gpu_power_w=170)
            specs.pop(ESTIMATE_FIELD, None)
            draw = 170
        parts.append(AssemblyPart(row["id"], row["name"], kind, specs, power_draw_w=draw))
    return parts


def supplement_power_checks(selected, checks):
    """Attach the evidence for stock capacity planning and the PSU body fit."""
    psu = selected.get("psu", {})
    case = selected.get("case", {})
    gpu = selected.get("gpu", {})
    cpu = selected.get("cpu", {})
    for check in checks:
        if check["check_type"] == "PSU_CASE" and _is_h5_2024(case) and _is_apx_650(psu):
            if check["result"] == "FAIL":
                continue
            case_specs = case["specs"]
            if (
                case_specs.get("max_psu_length_mm") not in (None, 200)
                or psu["specs"].get("length_mm") not in (None, 140, 150)
                or ("psu_sizes" in case_specs and "ATX" not in (case_specs["psu_sizes"] or []))
            ):
                check.update(
                    result="UNKNOWN", reason="DB 장착 사양과 제조사 규격이 달라 확인이 필요합니다."
                )
            else:
                check.update(
                    result="PASS",
                    reason="케이스와 파워의 ATX 장착 규격이 일치합니다. "
                    "MONTECH의 두 APX 650W 사양표에서 길이와 폭의 순서가 다릅니다. "
                    "길이 표기 140 mm와 150 mm 중 큰 값을 적용해도 케이스 한도 200 mm까지 50 mm 여유가 있습니다.",
                )
            check["sources"] = [
                document("POWER:NZXT-H5-FLOW-2024-PSU"),
                document("POWER:MONTECH-APX-650W"),
                document("POWER:MONTECH-APX-650W-SECOND-SPEC"),
            ]
        elif check["check_type"] == "PSU_CAPACITY":
            keys = list(_gpu_documents(gpu))
            if keys and not _gpu_power_agrees(gpu):
                check["reason"] += (
                    " DB 전력값과 ZOTAC의 170 W·권장 600 W 사양이 달라 확인이 필요합니다."
                )
                if check["result"] == "PASS":
                    check["result"] = "CONDITIONAL"
                watts = rated_watts(psu.get("specs", {}).get("wattage_w"))
                if watts is not None and watts < 600:
                    check["result"] = "FAIL"
                    check["reason"] += f" 파워 정격 {watts} W가 GPU 권장 600 W에 미달합니다."
            if _is_apx_650(psu):
                if keys:
                    check["reason"] += (
                        " 파워의 기본 PCIe 6+2핀 커넥터가 GPU의 8핀 1개 요구를 충족합니다."
                    )
                keys.append("POWER:MONTECH-APX-650W")
            if (
                cpu.get("source_key") == "amd-ryzen-5-7600"
                and cpu.get("brand") == "AMD"
                and cpu.get("model_number") == "Ryzen 5 7600"
                and cpu["specs"].get("cpu_power_limit_w") is None
            ):
                keys.extend(("AMD:RYZEN-5-7600", "POWER:AMD-RYZEN-MASTER-PPT"))
                check["reason"] += (
                    " Ryzen 5 7600의 기본 TDP는 65 W입니다. 실제 CPU 소켓 전력 한도(PPT)는 BIOS 또는 Ryzen Master에서 확인하세요."
                )
            if keys:
                check["sources"] = [document(key) for key in keys]
