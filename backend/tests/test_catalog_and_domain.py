"""DB 없이 도는 테스트: 기업 데이터 적재 어댑터 · 하드웨어 도메인 규칙."""

import shutil
from pathlib import Path

import pytest

from app.catalog.loaders import CatalogLoadError, load_company_csv
from app.core.config import Settings
from app.domains.hardware.pack import HardwarePack
from app.seed import load_catalog, read_seeds

FIXTURES = Settings().fixtures_dir
PACK = HardwarePack()


def test_all_fixtures_load() -> None:
    counts = {seed.slug: len(load_catalog(seed, FIXTURES)) for seed in read_seeds(FIXTURES)}
    assert counts == {"public-demo": 20, "company-a": 9}


def test_company_csv_is_mapped_to_common_format() -> None:
    products = {
        p.sku: p
        for p in load_company_csv(
            FIXTURES, "company_a/products.csv", "company_a/mapping.json", PACK
        )
    }
    laptop = products["A-NB-1002"]
    assert laptop.product_type == "laptop"
    assert laptop.price_amount == 1_990_000
    assert laptop.attributes["ram_gb"] == 32 and laptop.attributes["weight_kg"] == 1.9
    assert products["A-DT-2003"].price_status == "unconfirmed"
    assert products["A-MN-3001"].attributes == {
        "size_inch": 27.0,
        "resolution": "2560x1440",
        "refresh_hz": 165,
        "panel": "IPS",
    }


def _copy_company_a(tmp_path: Path, csv_bytes: bytes) -> Path:
    (tmp_path / "company_a").mkdir()
    shutil.copy(FIXTURES / "company_a" / "mapping.json", tmp_path / "company_a" / "mapping.json")
    (tmp_path / "company_a" / "products.csv").write_bytes(csv_bytes)
    return tmp_path


def test_excel_bom_is_accepted(tmp_path: Path) -> None:
    text = (FIXTURES / "company_a" / "products.csv").read_text(encoding="utf-8")
    root = _copy_company_a(tmp_path, text.encode("utf-8-sig"))
    assert (
        len(load_company_csv(root, "company_a/products.csv", "company_a/mapping.json", PACK)) == 9
    )


def test_cp949_file_gives_clear_message(tmp_path: Path) -> None:
    text = (FIXTURES / "company_a" / "products.csv").read_text(encoding="utf-8")
    root = _copy_company_a(tmp_path, text.encode("cp949"))
    with pytest.raises(CatalogLoadError, match="UTF-8"):
        load_company_csv(root, "company_a/products.csv", "company_a/mapping.json", PACK)


def test_bad_spec_value_points_to_line(tmp_path: Path) -> None:
    text = (FIXTURES / "company_a" / "products.csv").read_text(encoding="utf-8")
    broken = text.replace(
        'A-NB-1002,노트북,하늘전자(가상),워크북 16,"1,990,000",테스트,가상 12코어,12,32',
        'A-NB-1002,노트북,하늘전자(가상),워크북 16,"1,990,000",테스트,가상 12코어,12,많음',
    )
    assert broken != text
    root = _copy_company_a(tmp_path, broken.encode("utf-8"))
    with pytest.raises(CatalogLoadError, match="3번째 줄"):
        load_company_csv(root, "company_a/products.csv", "company_a/mapping.json", PACK)


def test_purpose_rules_merge() -> None:
    prefs = PACK.derive_preferences("영상 편집이랑 게임도 해요")
    assert prefs["min_ram_gb"] == 32
    assert prefs["min_vram_gb"] == 8
    assert prefs["min_refresh_hz"] == 144


def test_unknown_product_type_is_rejected() -> None:
    with pytest.raises(ValueError, match="sofa"):
        PACK.normalize_attributes("sofa", {})
