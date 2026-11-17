import unittest
from datetime import date
from decimal import Decimal

from app.domains.hardware.ingestion.common import DATA, price_value, read_json, sql_time
from app.domains.hardware.ingestion.docyx import prepare_parts
from app.domains.hardware.ingestion.import_compatibility import validate_records

CHECKED_AT = "2026-11-16T06:00:00Z"
REF_URL = "https://www.federalreserve.gov/releases/h10/hist/dat00_ko.htm"


class DocyxTests(unittest.TestCase):
    def normalize(self, snapshot, reviews=()):
        return prepare_parts(
            snapshot, reviews, Decimal("1361.89"), date(2026, 11, 6), REF_URL, CHECKED_AT
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
        self.assertIn("/data/json/cpu.json", rows[0]["price_source_url"])
        self.assertEqual(counts["cpu"]["skipped_price"], 2)
        provenance = rows[0]["specs"]["_provenance"]
        self.assertEqual(provenance["price_usd"], "196.97")
        self.assertEqual(provenance["fx_date"], "2026-11-06")
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
