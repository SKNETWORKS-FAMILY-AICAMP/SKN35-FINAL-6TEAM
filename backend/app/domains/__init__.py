"""Mock 상담 엔진이 요청할 때 해당 도메인 팩을 불러옵니다."""

from functools import cache
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.domains.base import DomainPack


@cache
def get_pack(domain: str) -> DomainPack:
    if domain == "hardware":
        from app.domains.hardware.pack import HardwarePack

        return HardwarePack()
    raise ValueError(f"등록되지 않은 도메인입니다: {domain}")
