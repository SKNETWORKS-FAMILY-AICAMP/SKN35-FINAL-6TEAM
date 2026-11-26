"""Deterministic catalog inputs for offline consultation workflow tests."""

import json
from pathlib import Path

import pytest

from app.domains.hardware.pc_consultation import advisor, designer
from app.domains.hardware.pc_consultation.catalog import CATEGORY_ORDER, validate_selection
from app.domains.hardware.pc_consultation.parts_db import CatalogSnapshot


@pytest.fixture
def catalog_snapshot(monkeypatch):
    fixture_path = Path(__file__).parent / "fixtures" / "consultation_catalog.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    parts = fixture["parts"]
    evidence = []
    monkeypatch.setattr(advisor, "_retrieve", lambda *_: ("test", []))
    monkeypatch.setattr(designer, "enabled", lambda: True)
    monkeypatch.setattr(designer, "generate", fixture_model)
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


@pytest.fixture
def validate_parts():
    """Evaluate isolated catalog fixtures through the same public physical validator."""

    def run(selected, evidence=()):
        parts = {
            role: {
                "id": i,
                "name": row.get("model_number") or role,
                "specs": {},
                **row,
                "category": role,
            }
            for i, (role, row) in enumerate(selected.items(), 1)
        }
        return {
            c["check_type"]: c
            for c in validate_selection(
                {k: r["id"] for k, r in parts.items()}, list(parts.values()), evidence
            )
        }

    return run


def fixture_model(schema, instruction, data):
    """Scripted model transport for the fictional catalog only."""
    if schema is designer.CoolingChoice:
        return schema(
            index=0, reason="테스트 냉각 근거", liquid_alternative=None, additional_fan=None
        )
    if schema is designer.Design:
        survey = data["survey"]
        targets = {"gaming": "gpu", "multitasking": "ram", "heat": "cooler", "storage": "storage"}
        roles = (
            CATEGORY_ORDER if survey["mode"] == "new" else [targets[s] for s in survey["problems"]]
        )
        return schema(
            steps=[
                designer.Step(
                    category=r, reason="가상 설문 목표", budget_weight=1, minimum_spec=None
                )
                for r in roles
            ],
            clarification="",
            requires_ssd=False,
        )
    if schema is designer.Preference:
        text = data["question"]
        if "Ti" in text or "9999" in text:
            return schema(
                category=None, requirement="", clarification="메모리 용량과 성능 자료가 필요합니다."
            )
        for brand in ("AMD", "Intel"):
            if brand in text:
                return schema(category="cpu", requirement=brand, clarification="")
        model = next((m for m in ("4060", "3060", "6600") if m in text), None)
        return schema(
            category="gpu" if model else None,
            requirement={"4060": "RTX 4060 8GB", "3060": "RTX 3060 12GB", "6600": "RX 6600 XT"}.get(
                model, ""
            ),
            clarification="",
        )
    decisions = []
    for i, row in data["candidates"]:
        specs = row["specs"]
        target = data["preference"]
        tier = specs.get("tier", 0)
        suitable = True
        if data["role"] == "gpu" and "gaming" in data["purposes"]:
            suitable = 45 * tier >= int(data["target_fps"])
        if target and data["role"] == "cpu":
            suitable = row["brand"] == target
        if target and data["role"] == "gpu":
            chip = specs["chipset"]
            # Simulated independent measurements used by the API preference integration fixture.
            scores = {"GeForce RTX 4060": 3, "Radeon RX 6600 XT": 2, "GeForce RTX 3060 12GB": 1}
            suitable = (
                scores.get(chip, 0)
                >= {"RTX 4060 8GB": 3, "RX 6600 XT": 2, "RTX 3060 12GB": 1}[target]
            )
        original = (data["original"] or {}).get("specs", {})
        field = "tier" if data["role"] == "gpu" else "capacity_gb"
        improves = original.get(field) is not None and specs.get(field, 0) > original[field]
        decisions.append(
            designer.Assessment(
                index=i,
                suitable=suitable,
                improves=improves,
                reason=target or "기존 부품과 가상 측정값 비교",
                spec_fields=[field if field in specs else next(iter(specs))],
                citations=[],
            )
        )
    return schema(decisions=decisions)
