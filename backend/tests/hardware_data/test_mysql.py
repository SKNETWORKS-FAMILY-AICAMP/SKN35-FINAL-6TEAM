"""Set RUN_MYSQL_TESTS=1 to exercise real constraints; all DML is rolled back."""

import os
import unittest
import uuid

import mysql.connector

from app.db.connection import get_connection
from app.domains.hardware.check_assembly import check_catalog_assembly
from app.domains.hardware.ingestion.common import DATA, read_json, read_specs
from app.domains.hardware.ingestion.import_compatibility import upsert_compatibility
from app.domains.hardware.ingestion.import_parts import upsert_parts


@unittest.skipUnless(os.getenv("RUN_MYSQL_TESTS") == "1", "MySQL 통합 검사는 명시적으로 실행")
class MySQLTests(unittest.TestCase):
    def setUp(self):
        self.connection = get_connection()
        self.cursor = self.connection.cursor()

    def tearDown(self):
        self.connection.rollback()
        self.cursor.close()
        self.connection.close()

    def make_quotes(self):
        self.cursor.execute(
            "INSERT INTO users (display_name) VALUES (%s)", ("__rollback_test_" + uuid.uuid4().hex,)
        )
        uid = self.cursor.lastrowid
        ids = []
        for _ in range(2):
            self.cursor.execute(
                "INSERT INTO quotes (user_id,consultation_type,payment_reference,paid_at,"
                "total_amount,performance_goal_snapshot) "
                "VALUES (%s,'UPGRADE',%s,UTC_TIMESTAMP(6),0,JSON_OBJECT('purpose','test'))",
                (uid, uuid.uuid4().hex),
            )
            ids.append(self.cursor.lastrowid)
        self.cursor.execute("SELECT part_id FROM parts ORDER BY part_id LIMIT 1")
        return ids, self.cursor.fetchone()[0]

    def test_item_cannot_reference_another_quote(self):
        quotes, part = self.make_quotes()
        self.cursor.execute(
            "INSERT INTO quote_items (quote_id,part_id,part_name_snapshot,quantity,unit_price,configuration,selection_basis) "
            "VALUES (%s,%s,'test',1,0,JSON_OBJECT(),JSON_OBJECT('reason','test'))",
            (quotes[0], part),
        )
        item = self.cursor.lastrowid
        with self.assertRaises(mysql.connector.IntegrityError):
            self.cursor.execute(
                "INSERT INTO quote_validations (quote_id,item_a_id,check_type,result,reason,input_snapshot,evidence_snapshot) "
                "VALUES (%s,%s,'SOCKET','UNKNOWN','test',JSON_OBJECT(),JSON_OBJECT())",
                (quotes[1], item),
            )

    def test_zero_quantity_is_rejected(self):
        quotes, part = self.make_quotes()
        with self.assertRaises(mysql.connector.Error):
            self.cursor.execute(
                "INSERT INTO quote_items (quote_id,part_id,part_name_snapshot,quantity,unit_price,configuration,selection_basis) "
                "VALUES (%s,%s,'test',0,0,JSON_OBJECT(),JSON_OBJECT('reason','test'))",
                (quotes[0], part),
            )

    def docyx_part(self):
        with self.connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                "SELECT * FROM parts WHERE category='cpu' AND model_number='Ryzen 5 7600'"
            )
            row = cursor.fetchone()
        self.assertIsNotNone(row, "Run the docyx importer before the integration tests")
        row["specs"] = read_specs(row["specs"])
        row["price_checked_at"] = row["price_checked_at"].isoformat() + "Z"
        return row

    def test_repeated_import_keeps_ids_and_rows(self):
        part = self.docyx_part()
        evidence = read_json(DATA / "docyx_compatibility.json")["records"]
        self.cursor.execute("SELECT COUNT(*) FROM parts")
        original_count = self.cursor.fetchone()[0]
        self.cursor.execute(
            "SELECT compatibility_id FROM part_compatibility ORDER BY compatibility_id"
        )
        original_evidence = self.cursor.fetchall()
        self.assertTrue(original_evidence)
        for _ in range(2):
            upsert_parts(self.connection, [part])
            refresh = upsert_compatibility(self.connection, evidence, "2026-11-16T06:00:00Z")
            self.assertEqual(refresh["inserted"], 0)
            self.assertEqual(refresh["withheld"], [])
        self.cursor.execute("SELECT COUNT(*) FROM parts")
        self.assertEqual(self.cursor.fetchone()[0], original_count)
        self.assertEqual(self.docyx_part()["part_id"], part["part_id"])
        self.cursor.execute(
            "SELECT compatibility_id FROM part_compatibility ORDER BY compatibility_id"
        )
        self.assertEqual(self.cursor.fetchall(), original_evidence)

    def test_price_refresh_preserves_quote_snapshot(self):
        quotes, _ = self.make_quotes()
        row = self.docyx_part()
        self.cursor.execute(
            "INSERT INTO quote_items (quote_id,part_id,part_name_snapshot,quantity,unit_price,price_source_url,price_checked_at,configuration,selection_basis) "
            "VALUES (%s,%s,%s,1,80,'https://example.com/old','2026-11-10 06:00:00',JSON_OBJECT(),JSON_OBJECT('reason','test'))",
            (quotes[0], row["part_id"], row["name"]),
        )
        row.update(current_price="120", price_checked_at="2026-11-16T07:00:00Z")
        upsert_parts(self.connection, [row])
        self.assertEqual(self.docyx_part()["current_price"], 120)
        self.cursor.execute("SELECT unit_price FROM quote_items WHERE quote_id=%s", (quotes[0],))
        self.assertEqual(self.cursor.fetchone()[0], 80)

    def test_stored_quote_uses_real_catalog_specs_and_item_quantity(self):
        quotes, _ = self.make_quotes()
        self.cursor.execute(
            "SELECT part_id,name,category FROM parts "
            "WHERE model_number IN ('i5-12400F','B760 GAMING PLUS WIFI','F5-6000J3636F32GX2-FX5',"
            "'GeForce RTX 3060 VENTUS 2X 12G','North Black TG') "
            "OR (category='psu' AND name='MSI MAG A750GL PCIE5')"
        )
        parts = self.cursor.fetchall()
        self.assertEqual(len(parts), 6)
        for part_id, name, category in parts:
            self.cursor.execute(
                "INSERT INTO quote_items (quote_id,part_id,part_name_snapshot,quantity,unit_price,configuration,selection_basis) "
                "VALUES (%s,%s,%s,%s,0,JSON_OBJECT(),JSON_OBJECT('reason','test'))",
                (quotes[0], part_id, name, 2 if category == "ram" else 1),
            )
        report = check_catalog_assembly(self.connection, quote_id=quotes[0])
        self.assertEqual(report["quote_id"], quotes[0])
        by_type = {check["check_type"]: check for check in report["checks"]}
        for check in (
            "RAM_TYPE",
            "RAM_FORM_FACTOR",
            "RAM_SLOTS",
            "RAM_CAPACITY",
            "GPU_CLEARANCE",
            "PSU_CAPACITY",
        ):
            self.assertEqual(by_type[check]["result"], "PASS")
        self.assertIn("4개", by_type["RAM_SLOTS"]["reason"])
        self.assertIn("128GB", by_type["RAM_CAPACITY"]["reason"])


if __name__ == "__main__":
    unittest.main()
