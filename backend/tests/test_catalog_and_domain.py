"""하드웨어 도메인 규칙 테스트."""

import pytest

from app.domains.hardware.pack import HardwarePack

PACK = HardwarePack()


def test_purpose_rules_merge() -> None:
    prefs = PACK.derive_preferences("영상 편집이랑 게임도 해요")
    assert prefs["min_ram_gb"] == 32
    assert prefs["min_vram_gb"] == 8
    assert prefs["min_refresh_hz"] == 144


def test_unknown_product_type_is_rejected() -> None:
    with pytest.raises(ValueError, match="sofa"):
        PACK.normalize_attributes("sofa", {})
