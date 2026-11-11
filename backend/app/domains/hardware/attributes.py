"""상품 유형별 사양 스키마.

새 상품 유형(예: SSD)을 지원하려면
1. 여기 스키마 클래스를 추가하고 ATTRIBUTE_SCHEMAS · PRODUCT_TYPE_LABELS 에 등록
2. 검증 규칙이 필요하면 rules.py 에 추가
3. data/fixtures 에 견본 데이터를 넣고 테스트를 추가합니다.
검증된 데이터가 없는 유형은 지원한다고 표시하지 않습니다.
"""

from pydantic import BaseModel, ConfigDict, Field


class _Spec(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LaptopSpec(_Spec):
    cpu: str
    cpu_cores: int = Field(ge=1)
    ram_gb: int = Field(ge=1)
    storage_gb: int = Field(ge=1)
    gpu: str
    gpu_vram_gb: int = Field(default=0, ge=0)
    display_inch: float = Field(gt=0)
    weight_kg: float = Field(gt=0)
    battery_wh: int | None = Field(default=None, ge=1)


class DesktopSpec(_Spec):
    cpu: str
    cpu_cores: int = Field(ge=1)
    ram_gb: int = Field(ge=1)
    storage_gb: int = Field(ge=1)
    gpu: str
    gpu_vram_gb: int = Field(default=0, ge=0)
    psu_w: int = Field(ge=1)
    form_factor: str


class GpuSpec(_Spec):
    chip: str
    vram_gb: int = Field(ge=1)
    tdp_w: int = Field(ge=1)
    length_mm: int = Field(ge=1)
    recommended_psu_w: int = Field(ge=1)
    interface: str


class ServerSpec(_Spec):
    cpu: str
    cpu_sockets: int = Field(ge=1)
    cpu_cores_total: int = Field(ge=1)
    ram_gb: int = Field(ge=1)
    storage_tb: float = Field(gt=0)
    rack_u: int = Field(ge=1)
    redundant_psu: bool


class MonitorSpec(_Spec):
    size_inch: float = Field(gt=0)
    resolution: str
    refresh_hz: int = Field(ge=1)
    panel: str


ATTRIBUTE_SCHEMAS: dict[str, type[_Spec]] = {
    "laptop": LaptopSpec,
    "desktop": DesktopSpec,
    "gpu": GpuSpec,
    "server": ServerSpec,
    "monitor": MonitorSpec,
}

PRODUCT_TYPE_LABELS: dict[str, str] = {
    "laptop": "노트북",
    "desktop": "데스크톱",
    "gpu": "그래픽카드",
    "server": "서버",
    "monitor": "모니터",
}
