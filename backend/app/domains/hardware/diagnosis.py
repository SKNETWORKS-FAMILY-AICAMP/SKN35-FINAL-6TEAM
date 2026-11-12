"""보유 장비 진단 — "업그레이드로 충분 / 새 장비 필요" 판정과 이유.

부품별로 상태를 매기고, 가장 무거운 상태로 전체 판정을 냅니다.

| 부품 | ok | upgrade(업그레이드로 해결) | new_device(새 장비 필요) | unknown(확인 필요) |
|---|---|---|---|---|
| VRAM | 보유 ≥ 필요 | 데스크톱: 그래픽카드 교체 | 노트북: 그래픽 교체 불가 | VRAM 모름 |
| 램 | 보유 ≥ 필요 | 온보드 아님 · 최대 지원 ≥ 필요 | 온보드(납땜) · 최대 지원 < 필요 | 온보드 여부 · 최대 용량 모름 |
| 저장공간 | 보유 ≥ 필요 | 빈 M.2 에 SSD 추가 / SSD 교체 | (없음 — 외장 · 교체로 늘 수 있음) | 용량 · 빈 슬롯 모름 |

전체 판정 우선순위: new_device > unknown > upgrade > ok
"""

from dataclasses import dataclass, replace
from typing import Literal

from app.contracts.schemas import DiagnoseOut, DiagnosisItemOut, VramEstimateOut
from app.domains.hardware.sizing import describe, required_ram_gb, required_storage_gb

Status = Literal["ok", "upgrade", "new_device", "unknown"]
DeviceType = Literal["laptop", "desktop"]

VERDICTS: dict[str, tuple[str, str]] = {
    # 가장 무거운 부품 상태 → (판정 코드, 화면 문구)
    "new_device": ("new_device_needed", "새 장비 필요"),
    "unknown": ("needs_check", "확인 필요(정보 부족)"),
    "upgrade": ("upgrade_sufficient", "업그레이드로 충분"),
    "ok": ("no_change", "지금 장비로 충분"),
}
SEVERITY: dict[str, int] = {"ok": 0, "upgrade": 1, "unknown": 2, "new_device": 3}
DEVICE_LABELS = {"laptop": "노트북", "desktop": "데스크톱"}

ASSUMPTIONS = [
    "노트북의 그래픽(GPU)은 바꿀 수 없다고 봅니다(외장 그래픽 독은 고려하지 않음).",
    "데스크톱 그래픽카드 교체는 파워 용량 · 케이스 길이가 맞아야 합니다(호환성은 검증팀이 확인).",
    "시스템 램은 필요 VRAM 이상(최소 16GB), 저장공간은 원본 가중치 × 2 + 100GB 로 잡았습니다.",
]


@dataclass(frozen=True)
class OwnedDevice:
    device_type: DeviceType | None = None
    ram_gb: int | None = None
    ram_onboard: bool | None = None
    ram_max_gb: int | None = None
    ram_slots_free: int | None = None
    storage_gb: int | None = None
    m2_slots_free: int | None = None
    gpu_vram_gb: int | None = None

    @classmethod
    def from_attributes(cls, device_type: DeviceType, attributes: dict) -> OwnedDevice:
        """카탈로그 상품 사양(attributes)을 보유 장비로 읽습니다."""
        return cls(
            device_type=device_type,
            ram_gb=attributes.get("ram_gb"),
            ram_onboard=attributes.get("ram_onboard"),
            ram_max_gb=attributes.get("ram_max_gb"),
            ram_slots_free=attributes.get("ram_slots_free"),
            storage_gb=attributes.get("storage_gb"),
            m2_slots_free=attributes.get("m2_slots_free"),
            gpu_vram_gb=attributes.get("gpu_vram_gb"),
        )

    def overridden(self, **values: object) -> OwnedDevice:
        """직접 준 값(None 이 아닌 것)으로 덮어씁니다."""
        return replace(self, **{k: v for k, v in values.items() if v is not None})


def _gb(value: int | float | None) -> str:
    return "모름" if value is None else f"{value:g}GB"


def _vram(device: OwnedDevice, need: float) -> DiagnosisItemOut:
    have = device.gpu_vram_gb
    status: Status
    if have is None:
        status, detail = "unknown", "그래픽 메모리(VRAM)를 알려 주세요"
    elif have >= need:
        status, detail = "ok", "그래픽 메모리가 충분합니다"
    elif device.device_type == "desktop":
        status = "upgrade"
        detail = f"그래픽카드를 VRAM {need:g}GB 이상으로 바꾸면 됩니다(파워 용량 · 케이스 길이 확인 필요)"
    elif device.device_type == "laptop":
        status = "new_device"
        detail = "노트북은 그래픽(GPU)을 바꿀 수 없어 새 장비가 필요합니다"
    else:
        status, detail = "unknown", "장비 종류(노트북 · 데스크톱)를 알려 주세요"
    return DiagnosisItemOut(
        component="vram",
        status=status,
        have="내장 그래픽(0GB)" if have == 0 else _gb(have),
        need=_gb(need),
        detail=detail,
    )


def _ram(device: OwnedDevice, need: int) -> DiagnosisItemOut:
    have = device.ram_gb
    status: Status
    if have is None:
        status, detail = "unknown", "램 용량을 알려 주세요"
    elif have >= need:
        status, detail = "ok", "램이 충분합니다"
    elif device.ram_onboard is True:
        status, detail = "new_device", "램이 기판에 붙어 있어(온보드) 늘릴 수 없습니다"
    elif device.ram_max_gb is not None and device.ram_max_gb < need:
        status, detail = (
            "new_device",
            f"이 장비는 램을 최대 {device.ram_max_gb}GB 까지만 지원합니다",
        )
    elif device.ram_onboard is None:
        status, detail = "unknown", "램이 온보드(납땜)인지 확인해야 합니다"
    elif device.ram_max_gb is None:
        status, detail = "unknown", "지원 최대 램 용량을 확인해야 합니다"
    else:
        status = "upgrade"
        if device.ram_slots_free:
            detail = f"빈 램 슬롯 {device.ram_slots_free}개에 추가하면 {need}GB 이상으로 늘릴 수 있습니다"
        else:
            detail = f"빈 슬롯이 없어 기존 램을 더 큰 것으로 바꾸면 {need}GB 이상이 됩니다"
    return DiagnosisItemOut(
        component="ram", status=status, have=_gb(have), need=_gb(need), detail=detail
    )


def _storage(device: OwnedDevice, need: int) -> DiagnosisItemOut:
    have = device.storage_gb
    status: Status
    if have is None:
        status, detail = "unknown", "저장공간 용량을 알려 주세요"
    elif have >= need:
        status, detail = "ok", "저장공간이 충분합니다"
    elif device.m2_slots_free:
        status, detail = "upgrade", "빈 M.2 슬롯에 SSD 를 추가하면 됩니다"
    elif device.m2_slots_free == 0:
        status, detail = (
            "upgrade",
            "빈 M.2 슬롯이 없어 SSD 를 더 큰 것으로 바꾸거나 외장 SSD 를 씁니다",
        )
    else:
        status, detail = "unknown", "빈 M.2 슬롯이 있는지 확인해야 합니다"
    return DiagnosisItemOut(
        component="storage", status=status, have=_gb(have), need=_gb(need), detail=detail
    )


def diagnose(
    device: OwnedDevice, estimate: VramEstimateOut, needed_storage_gb: int | None = None
) -> DiagnoseOut:
    ram_need = required_ram_gb(estimate)
    storage_need = needed_storage_gb or required_storage_gb(estimate)
    items = [
        _vram(device, estimate.required_vram_gb),
        _ram(device, ram_need),
        _storage(device, storage_need),
    ]
    worst = max(items, key=lambda item: SEVERITY[item.status]).status
    verdict, label = VERDICTS[worst]
    device_label = DEVICE_LABELS.get(device.device_type or "", "보유 장비")
    reasons = [f"목표: {describe(estimate)} — 필요 VRAM 약 {estimate.required_vram_gb:g}GB"]
    reasons += [f"{item.detail} (보유 {item.have} / 필요 {item.need})" for item in items]
    reasons.append(f"판정: {device_label} — {label}")
    return DiagnoseOut(
        verdict=verdict,
        verdict_label=label,
        device_type=device.device_type,
        items=items,
        estimate=estimate,
        required_ram_gb=ram_need,
        required_storage_gb=storage_need,
        reasons=reasons,
        assumptions=list(ASSUMPTIONS),
    )
