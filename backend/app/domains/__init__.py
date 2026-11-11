"""도메인 팩 등록부.

공통 엔진은 하드웨어를 모릅니다. 기업의 `domain` 값으로 여기서 팩을 골라 씁니다.
새 판매 도메인(가구 등)을 붙이려면 domains/<이름>/ 에 팩을 만들고 아래 PACKS 에 한 줄 추가합니다.
"""

from app.domains.base import DomainPack
from app.domains.hardware.pack import HardwarePack

PACKS: dict[str, DomainPack] = {
    "hardware": HardwarePack(),
}


def get_pack(domain: str) -> DomainPack:
    try:
        return PACKS[domain]
    except KeyError as exc:
        raise ValueError(f"등록되지 않은 도메인입니다: {domain}") from exc
