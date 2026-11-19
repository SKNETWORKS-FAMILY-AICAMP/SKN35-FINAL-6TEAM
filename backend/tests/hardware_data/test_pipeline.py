import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import Mock

import pytest

from app.domains.hardware.ingestion.common import (
    DATA,
    compatibility_sources,
    price_value,
    read_json,
    sql_time,
)
from app.domains.hardware.ingestion.docyx import REVISION, prepare_parts
from app.domains.hardware.ingestion.import_compatibility import (
    upsert_compatibility,
    validate_records,
)
from app.domains.hardware.ingestion.part_images import (
    IMAGE_PLACEHOLDER_URL,
    match_images,
    resolve_image_url,
)
from app.domains.hardware.ingestion.part_power import resolve_catalog_power, resolve_part_power

CHECKED_AT = "2026-11-16T06:00:00Z"
REF_URL = "https://www.federalreserve.gov/releases/h10/hist/dat00_ko.htm"


class DocyxTests(unittest.TestCase):
    def normalize(self, snapshot, reviews=(), *, excluded_keys=()):
        return prepare_parts(
            snapshot,
            reviews,
            Decimal("1361.89"),
            date(2026, 11, 6),
            REF_URL,
            CHECKED_AT,
            excluded_keys=excluded_keys,
        )

    def test_only_priced_rows_are_prepared_with_exact_krw_and_provenance(self):
        cpu = [
            {"name": "AMD Ryzen 5 7600", "price": 196.97, "core_count": 6},
            {"name": "AMD Ryzen 5 7500F", "price": None, "core_count": 6},
            {"name": "AMD test zero", "price": 0},
        ]
        rows, counts, _ = self.normalize({"cpu": cpu})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["current_price"], Decimal("268251"))
        self.assertEqual(rows[0]["price_checked_at"], CHECKED_AT)
        self.assertNotIn("source_url", rows[0])
        self.assertNotIn("price_source_url", rows[0])
        self.assertEqual(counts["cpu"]["skipped_price"], 2)
        provenance = rows[0]["specs"]["_provenance"]
        self.assertEqual(provenance["source"], "docyx")
        self.assertEqual(provenance["revision"], REVISION)
        self.assertTrue(provenance["source_key"].startswith("docyx:"))
        self.assertEqual(provenance["price_usd"], "196.97")
        self.assertEqual(provenance["fx_date"], "2026-11-06")
        self.assertEqual(provenance["fx_source_url"], REF_URL)
        self.assertEqual(provenance["price_status"], "test")
        self.assertNotIn("socket", rows[0]["specs"])

    def test_same_gpu_name_cannot_merge_conflicting_variants(self):
        gpu = [
            {"name": "Sapphire PULSE", "chipset": "A", "memory": 16, "length": 240, "price": 380},
            {"name": "Sapphire PULSE", "chipset": "A", "memory": 16, "length": 240, "price": 379},
            {"name": "Sapphire PULSE", "chipset": "B", "memory": 16, "length": 320, "price": 749},
        ]
        rows, counts, _ = self.normalize({"video-card": gpu})
        self.assertEqual(len({r["name"] for r in rows}), 2)
        self.assertEqual(counts["gpu"]["duplicates"], 1)
        self.assertEqual({r["specs"]["length_mm"] for r in rows}, {240, 320})
        self.assertEqual(rows[0]["specs"]["_provenance"]["price_usd"], "379")

    def test_excluded_source_key_prevents_reimport_of_only_that_variant(self):
        snapshot = {
            "motherboard": [
                {"name": "Test motherboard", "socket": "AM1", "price": 30},
                {"name": "Test motherboard", "socket": "AM4", "price": 40},
            ]
        }
        original, _, _ = self.normalize(snapshot)
        excluded_key = original[0]["specs"]["_provenance"]["source_key"]
        rows, counts, _ = self.normalize(snapshot, excluded_keys=[excluded_key])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["specs"]["socket"], "AM4")
        self.assertEqual(rows[0]["name"], original[1]["name"])
        self.assertEqual(counts["motherboard"]["skipped_excluded"], 1)

    def test_manufacturer_review_uses_exact_model_and_variant(self):
        review = read_json(DATA / "docyx_compatibility.json")
        case = next(p for p in review["parts"] if p["category"] == "case")
        rows, _, missing = self.normalize(
            {
                "case": [
                    {"name": case["raw_name"], "color": "Black", "price": 129.99},
                    {"name": case["raw_name"], "color": "White", "price": 109.99},
                ]
            },
            [case],
        )
        self.assertEqual(missing, [])
        self.assertEqual(rows[0]["specs"]["max_gpu_length_mm"], 410)
        self.assertEqual(rows[0]["specs"]["_provenance"]["source_key"], case["source_key"])
        self.assertEqual(rows[0]["specs"]["_provenance"]["reviewed_specs_url"], case["source_url"])
        self.assertNotIn("max_gpu_length_mm", rows[1]["specs"])
        self.assertTrue(validate_records(review["records"], review["parts"]))

    def test_invalid_prices_and_explicit_utc(self):
        for value in (None, False, 0, -1, "NaN", "Infinity", "bad", "10000000000000", "0.001"):
            with self.subTest(value=value):
                self.assertIsNone(price_value(value))
        self.assertEqual(price_value("123.45"), Decimal("123.45"))
        self.assertEqual(sql_time("2026-11-16T15:00:00+09:00"), sql_time(CHECKED_AT))
        with self.assertRaises(ValueError):
            sql_time("2026-11-16T06:00:00")

    def test_qvl_test_bios_is_not_a_minimum(self):
        parts = [
            {"source_key": "board", "category": "motherboard"},
            {"source_key": "kit", "category": "ram", "model_number": "test-kit"},
        ]
        record = {
            "record_key": "test-qvl",
            "part_a_key": "board",
            "part_b_key": "kit",
            "check_type": "MEMORY_QVL",
            "support_status": "CONDITIONAL",
            "bios_scope": "MIN_VERSION",
            "min_bios_version": "3.50",
            "source_publisher": "test",
            "source_url": "https://example.com/test",
            "conditions": {
                "ram_model_number": "test-kit",
                "cpu_family": "test",
                "tested_bios": "3.50",
            },
        }
        with self.assertRaisesRegex(ValueError, "QVL"):
            validate_records([record], parts)


@pytest.mark.parametrize(
    ("field", "wrong_value"),
    [("source_url", "https://example.com/wrong-source"), ("source_publisher", "wrong-source")],
)
def test_compatibility_import_rejects_mismatched_source_before_writing(field, wrong_value):
    record_key, source = next(iter(compatibility_sources().items()))
    record = {"record_key": record_key, **source, field: wrong_value}
    connection = Mock()

    with pytest.raises(ValueError, match="출처와 일치하지 않습니다"):
        upsert_compatibility(connection, [record])

    connection.cursor.assert_not_called()


def test_cpu_tdp_moves_to_column_and_reviewed_limit_remains_separate():
    raw = {
        "category": "cpu",
        "name": "Specimen",
        "brand": "Specimen",
        "model_number": "MODEL",
        "power_draw_w": Decimal("117"),
        "specs": {
            "tdp_w": 65,
            "cores": 6,
            "_provenance": {
                "source": "docyx",
                "revision": REVISION,
                "raw_name": "Specimen",
                "source_key": "test-cpu",
            },
        },
    }
    evidence = {
        "test-cpu": {
            "category": "cpu",
            "raw_name": "Specimen",
            "catalog_brand": "Specimen",
            "catalog_model_number": "MODEL",
            "match_specs": {"cores": 6},
            "cpu_power_limit_w": 117,
        }
    }
    specs, power = resolve_part_power(raw, evidence)
    assert power == 65
    assert specs["cpu_power_limit_w"] == 117
    assert "tdp_w" not in specs
    assert raw["specs"]["tdp_w"] == 65
    assert resolve_part_power({**raw, "specs": specs, "power_draw_w": power}, evidence) == (
        specs,
        power,
    )


def test_gpu_requires_a_board_power_rating_and_matches_the_variant():
    gpu = {
        "category": "gpu",
        "name": "Specimen GPU",
        "brand": "Specimen",
        "model_number": None,
        "specs": {
            "vram_gb": 8,
            "recommended_psu_w": 550,
            "_provenance": {
                "source": "docyx",
                "revision": REVISION,
                "raw_name": "Specimen GPU",
                "source_key": "test-gpu",
            },
        },
    }
    evidence = {
        "test-gpu": {
            "category": "gpu",
            "raw_name": "Specimen GPU",
            "catalog_brand": "Specimen",
            "catalog_model_number": None,
            "match_specs": {"vram_gb": 8},
            "power_draw_w": 170.25,
        }
    }
    assert resolve_part_power(gpu, evidence)[1] == Decimal("170.25")
    assert resolve_part_power(gpu, {})[1] is None
    assert resolve_part_power({**gpu, "power_draw_w": Decimal(160)}, evidence)[1] == 160
    variant = {**gpu, "specs": {**gpu["specs"], "vram_gb": 16}}
    assert resolve_part_power(variant, evidence)[1] is None
    assert resolve_part_power({"category": "psu", "specs": {"wattage_w": 750}}, {})[1] is None
    for value in (True, -1, 0, float("inf"), 1.001, 1000000):
        assert (
            resolve_part_power({"category": "gpu", "specs": {"gpu_power_w": value}}, {})[1] is None
        )


def test_catalog_estimates_are_marked_and_replaced_by_exact_power():
    gpu = {
        "category": "gpu",
        "brand": "Specimen",
        "model_number": "A1",
        "specs": {
            "chipset": "Specimen GPU",
            "_provenance": {
                "source": "docyx",
                "revision": REVISION,
                "source_key": "gpu-a1",
                "raw_name": "GPU A1",
            },
        },
    }
    estimates = {"Specimen GPU": {"power_draw_w": 150, "source_url": REF_URL}}
    specs, power = resolve_catalog_power(gpu, {}, estimates)
    assert power == 165
    assert specs["_power_estimate"]["status"] == "unconfirmed"
    part = {**gpu, "specs": specs, "power_draw_w": power}
    assert resolve_catalog_power(part, {}, estimates) == (specs, power)
    review = {
        "category": "gpu",
        "raw_name": "GPU A1",
        "catalog_brand": "Specimen",
        "catalog_model_number": "A1",
        "match_specs": {"chipset": "Specimen GPU"},
        "power_draw_w": 142,
    }
    assert resolve_catalog_power(part, {"gpu-a1": review}, estimates) == (gpu["specs"], 142)
    assert resolve_catalog_power({**gpu, "power_draw_w": 140}, {}, estimates) == (gpu["specs"], 140)
    kit = {"category": "ram", "specs": {"modules_per_item": 2}}
    assert resolve_catalog_power(kit, {}, estimates)[1] == 20
    assert (
        resolve_catalog_power({"category": "psu", "specs": {"wattage_w": 750}}, {}, estimates)[1]
        is None
    )


def test_model_reviewed_gpu_estimate_uses_its_evidence_and_rejects_an_unknown_variant():
    part = {
        "category": "gpu",
        "brand": "Specimen",
        "model_number": "A1",
        "name": "Specimen A1",
        "power_draw_w": 600,
        "specs": {
            "chipset": "Specimen Graphics",
            "_power_estimate": {"status": "unconfirmed", "basis": "unknown_add_in_card_allowance"},
            "_provenance": {
                "source": "docyx",
                "revision": REVISION,
                "source_key": "gpu-a1",
                "raw_name": "Specimen A1",
            },
        },
    }
    estimates = {
        "gpu-a1": {
            "category": "gpu",
            "raw_name": "Specimen A1",
            "catalog_brand": "Specimen",
            "catalog_model_number": "A1",
            "manufacturer_model": "A1",
            "match_specs": {"chipset": "Specimen Graphics"},
            "basis": "pcie_x16_slot_power_limit",
            "evidence": "Model A1 is slot powered",
            "source_url": REF_URL,
            "power_draw_w": 75,
        }
    }
    specs, power = resolve_catalog_power(part, {}, estimates)
    assert power == 75
    assert specs["_power_estimate"]["basis"] == "pcie_x16_slot_power_limit"
    assert specs["_power_estimate"]["evidence"] == "Model A1 is slot powered"
    with pytest.raises(ValueError, match="GPU 전력 근거"):
        resolve_catalog_power({**part, "model_number": "A2"}, {}, estimates)


def test_image_matching_rejects_ambiguous_variants_and_placeholder_images():
    part = {
        "category": "gpu",
        "brand": "Specimen",
        "name": "Specimen GPU 8G",
        "specs": {"_provenance": {"raw_name": "Specimen  GPU 8G"}},
    }
    row = {
        "category": "video-card",
        "brand": "Specimen",
        "name": "specimen gpu 8g",
        "product_tag": "test-8g",
        "image_url": "https://example.com/8g.jpg",
    }
    key = ("gpu", "Specimen", "Specimen GPU 8G")
    assert match_images([part], [row, row]) == {key: row["image_url"]}
    assert match_images([part], [row, {**row, "product_tag": "other"}]) == {}
    assert match_images([part, {**part, "name": "Specimen GPU 8G [variant]"}], [row]) == {}
    assert match_images([part], [{**row, "image_url": "https://example.com/no-image.png"}]) == {}


def test_image_matching_checks_shared_specs_to_resolve_named_gpu_variants():
    specs = {
        "chipset": "Test graphics processor",
        "core_clock_mhz": 2000,
        "boost_clock_mhz": 2400,
        "length_mm": 240,
        "color": "Black",
        "_provenance": {"raw_name": "Specimen GPU"},
    }
    parts = [
        {
            "category": "gpu",
            "brand": "Specimen",
            "name": f"Specimen GPU [{capacity}G]",
            "specs": {**specs, "vram_gb": capacity},
        }
        for capacity in (8, 16)
    ]
    rows = [
        {
            "category": "video-card",
            "brand": "Specimen",
            "name": "Specimen GPU",
            "product_tag": f"test-{capacity}g",
            "image_url": f"https://example.com/{capacity}g.jpg",
            "specs": {
                "Chipset": specs["chipset"],
                "Core Clock": "2000 MHz",
                "Boost Clock": "2400 MHz",
                "Length": "240 mm",
                "Color": "Black",
                "Memory": f"{capacity} GB",
            },
        }
        for capacity in (8, 16)
    ]
    assert match_images(parts, rows) == {
        ("gpu", "Specimen", part["name"]): row["image_url"]
        for part, row in zip(parts, rows, strict=True)
    }
    duplicate_tag = {**rows[1], "product_tag": rows[0]["product_tag"]}
    assert match_images(parts, [rows[0], duplicate_tag]) == {}


def test_image_matching_distinguishes_same_name_cases_by_color():
    parts = [
        {
            "category": "case",
            "brand": "Specimen",
            "name": f"Specimen Tower [{color}]",
            "specs": {
                "_provenance": {"raw_name": "Specimen Tower"},
                "type": "ATX Mid Tower",
                "color": color,
                "external_volume_l": 45,
            },
        }
        for color in ("Black", "White")
    ]
    rows = [
        {
            "category": "case",
            "brand": "Specimen",
            "name": "Specimen Tower",
            "product_tag": color,
            "image_url": f"https://example.com/{color}.jpg",
            "specs": {
                "Type": "ATX Mid Tower",
                "Color": color,
                "External Volume": "45.0 L",
                "Power Supply": "None",
            },
        }
        for color in ("White", "Black")
    ]
    assert match_images(parts, rows) == {
        ("case", "Specimen", f"Specimen Tower [{color}]"): f"https://example.com/{color}.jpg"
        for color in ("Black", "White")
    }


def test_image_matching_normalizes_storage_units_and_requires_variant_agreement():
    part = {
        "category": "storage",
        "brand": "Specimen",
        "name": "Specimen Drive",
        "specs": {
            "capacity_gb": 2000,
            "type": 7200,
            "form_factor": 3.5,
            "interface": "SATA 6.0 Gb/s",
        },
    }
    row = {
        "category": "internal-hard-drive",
        "brand": "Specimen",
        "name": "Specimen Drive",
        "product_tag": "model-a",
        "image_url": "https://example.com/drive.jpg",
        "specs": {
            "Capacity": "2 TB",
            "Type": "7200 RPM",
            "Form Factor": '3.5"',
            "Interface": "SATA 6.0 Gb/s",
            "Cache": "64 MB",
        },
    }
    same_photo = {**row, "product_tag": "model-b"}
    assert match_images([part], [row, same_photo]) == {
        ("storage", "Specimen", "Specimen Drive"): row["image_url"]
    }
    different_photo = {**same_photo, "image_url": "https://example.com/other.jpg"}
    assert match_images([part], [row, different_photo]) == {}


def test_image_placeholder_is_replaced_when_exact_photo_becomes_available():
    photo = "https://example.com/product.jpg"
    assert resolve_image_url(None, None) == IMAGE_PLACEHOLDER_URL
    assert resolve_image_url(IMAGE_PLACEHOLDER_URL, photo) == photo
    assert resolve_image_url(photo, "https://example.com/another.jpg") == photo
    assert resolve_image_url(None, None, fill_missing=False) is None


def test_reviewed_image_matches_the_pinned_catalog_source_key():
    part = {
        "category": "case",
        "brand": "Specimen",
        "name": "Specimen Tower",
        "specs": {"_provenance": {"source": "docyx", "revision": REVISION, "source_key": "key"}},
    }
    photo = "https://example.com/product.jpg"
    reviews = {"key": ("case", photo)}
    assert match_images([part], [], reviewed_images=reviews) == {
        ("case", "Specimen", "Specimen Tower"): photo
    }
    part["specs"]["_provenance"]["revision"] = "other-revision"
    assert match_images([part], [], reviewed_images=reviews) == {}
