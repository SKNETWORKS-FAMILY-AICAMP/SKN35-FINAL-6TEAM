"""Deterministic catalog inputs for offline consultation workflow tests."""

import json
from pathlib import Path

import pytest

from app.domains.hardware.pc_consultation.parts_db import CatalogSnapshot


@pytest.fixture
def catalog_snapshot():
    fixture_path = Path(__file__).parent / "fixtures" / "consultation_catalog.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    parts = fixture["parts"]
    evidence = []
    for row in parts:
        row.update(
            price_status="test",
            price_basis=fixture["price_basis"],
            currency="KRW",
            price_checked_at="2026-11-01T00:00:00+00:00",
            brand="Test",
            model_number=None,
            data_status="test",
            source_key=f"fixture-{row['id']}",
            power_status=None,
            image_url=None,
        )
        if row["category"] != "motherboard":
            continue
        spec = row["specs"]
        for cpu_id in spec["fixture_cpu_ids"]:
            evidence.append(
                dict(
                    compatibility_id=len(evidence) + 1,
                    check_type="CPU_SUPPORT",
                    part_a_id=row["id"],
                    part_b_id=cpu_id,
                    support_status="SUPPORTED",
                    bios_scope="ALL",
                    conditions={},
                )
            )
        profile = spec["fixture_memory_test"]
        for ram_id in profile["tested_mtps_by_ram_id"]:
            evidence.append(
                dict(
                    compatibility_id=len(evidence) + 1,
                    check_type="MEMORY_QVL",
                    part_a_id=row["id"],
                    part_b_id=int(ram_id),
                    support_status="CONDITIONAL",
                    conditions={"cpu_family": profile["cpu_family"], "kits": profile["kits"]},
                )
            )
    return CatalogSnapshot(parts, evidence)
