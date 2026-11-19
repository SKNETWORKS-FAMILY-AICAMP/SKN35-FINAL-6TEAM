"""Describe the measured scope of the selected CPU and cooler's thermal specifications."""

from .reviewed_documents import document


def supplement_cooling_check(selected, checks):
    cpu = selected.get("cpu", {})
    cooler = selected.get("cooler", {})
    if not (
        cpu.get("source_key") == "amd-ryzen-5-7600"
        and cpu.get("brand") == "AMD"
        and cpu.get("model_number") == "Ryzen 5 7600"
        and cooler.get("source_key") == "cooler-thermalright-peerless-assassin-120-se"
        and cooler.get("brand") == "Thermalright"
        and cooler.get("model_number") == "Peerless Assassin 120 SE"
        and cooler.get("specs", {}).get("color") == "Black / Silver"
    ):
        return
    for check in checks:
        if check["check_type"] == "COOLER_POWER" and check["result"] == "UNKNOWN":
            check.update(
                reason=(
                    "Ryzen 5 7600의 기본 TDP는 65 W입니다. 쿨러 도표의 125~260 W는 "
                    "별도 열 시험대에서 측정한 범위입니다. 이 CPU의 지속 부하에서 냉각 여유를 "
                    "판정하려면 같은 조합의 부하·온도 측정 결과가 필요합니다."
                ),
                sources=[document("AMD:RYZEN-5-7600"), document("THERMALRIGHT:PA120-SE:DTPC")],
            )
