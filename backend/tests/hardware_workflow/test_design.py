"""All names, prices, and specs below are synthetic catalog fixtures."""

from decimal import Decimal

import pytest

from app.domains.hardware.quote_graph.design import choose


def part(part_id, category, price, *, brand="Fixture", **specs):
    return {
        "part_id": part_id,
        "name": f"Test {category} {part_id}",
        "brand": brand,
        "category": category,
        "current_price": Decimal(price) if price is not None else None,
        "currency": "KRW",
        "specs": specs,
    }


def request(*categories, budget="1000", **conditions):
    return {"categories": list(categories), "budget_krw": Decimal(budget), **conditions}


def initial(rows, req):
    return choose(rows, req, selection={}, failures=[], attempted=[])


def repair(rows, req, current, code, attempted=()):
    return choose(
        rows,
        req,
        selection=current,
        failures=[{"check_type": code, "result": "FAIL"}],
        attempted=list(attempted),
    )


def test_entire_build_optimizes_preferences_then_price_and_id():
    rows = [
        part(15, "storage", "100", brand="Preferred"),
        part(10, "storage", "100", brand="Preferred"),
        part(11, "storage", "25"),
        part(14, "cooler", "50", brand="Preferred", color="white"),
        part(12, "cooler", "15"),
    ]
    req = request(
        "storage",
        "cooler",
        budget="150",
        quantities={"storage": 2},
        preferred_brands={"storage": "Preferred", "cooler": "Preferred"},
        preferred_specs={"cooler": {"color": "white"}},
    )
    expected = {11: 2, 14: 1}
    selection, basis = initial(rows, req)
    assert selection == expected
    assert "선호 브랜드=Preferred" in basis[14] and "선호 color=white" in basis[14]
    assert initial(rows[::-1], req)[0] == expected
    assert initial(rows, {**req, "budget_krw": Decimal("250")})[0] == {10: 2, 14: 1}
    assert initial(rows, {**req, "budget_krw": Decimal("64.99")}) is None


def test_hard_filters_require_exact_model_and_specs_and_a_known_krw_price():
    rows = [
        {**part(1, "motherboard", "90"), "model_number": "BOARD WIFI II"},
        {**part(2, "motherboard", None), "model_number": "BOARD WIFI"},
        {**part(3, "motherboard", "91", brand="Other"), "model_number": "BOARD WIFI"},
        {**part(4, "motherboard", "92"), "currency": "USD", "model_number": "BOARD WIFI"},
        {**part(5, "motherboard", "93", socket="AM4"), "model_number": "BOARD WIFI"},
        {**part(6, "motherboard", "94", socket="AM5"), "model_number": "BOARD WIFI"},
    ]
    req = request(
        "motherboard",
        required_brands={"motherboard": "fixture"},
        required_specs={"motherboard": {"model_number": "BOARD WIFI", "socket": "am5"}},
    )
    selection, basis = initial(rows, req)
    assert selection == {6: 1}
    assert "필수 model_number=BOARD WIFI" in basis[6]
    assert initial(rows[:-1], req) is None


def test_locked_ids_and_quantities_are_never_dropped_and_cost_their_full_amount():
    rows = [part(1, "ram", "20.10"), part(2, "storage", "9.99"), part(3, "storage", "10.01")]
    req = request("ram", locked_parts={2: 2, 3: 1}, budget="50.09")
    assert initial(rows, req)[0] == {1: 1, 2: 2, 3: 1}
    assert initial(rows, {**req, "budget_krw": Decimal("50.08")}) is None
    assert initial(rows, {**req, "quantities": {"storage": 2}}) is None
    assert initial(rows, {**req, "locked_parts": {200: 1}}) is None
    assert initial(rows, {**req, "required_brands": {"storage": "other"}}) is None


def test_explicit_total_above_locked_quantity_requires_another_sku():
    rows = [
        part(1, "storage", "5.50"),
        part(2, "storage", "10.05"),
        part(3, "storage", "10.04"),
        part(4, "cpu", "20.20"),
    ]
    req = request("cpu", quantities={"storage": 4}, locked_parts={1: 2}, budget="51.28")
    assert initial(rows, req)[0] == {1: 2, 3: 2, 4: 1}
    assert initial(rows, {**req, "budget_krw": Decimal("51.27")}) is None
    assert initial([rows[0], rows[3]], req) is None
    assert initial(rows, {**req, "quantities": {"storage": 1}}) is None
    assert initial(rows, {**req, "quantities": {"cpu": 2}, "locked_parts": {4: 1}}) is None


def test_psu_repair_preserves_quantity_checks_assembly_and_avoids_visited_selections():
    rows = [
        part(1, "psu", "40", wattage_w=500),
        part(2, "psu", "41", wattage_w=510),
        part(3, "psu", "45", wattage_w=550),
        part(4, "psu", "49", wattage_w=600),
        part(5, "gpu", "30", gpu_power_w=100, recommended_psu_w=550),
        part(6, "cpu", "19", cpu_power_limit_w=100),
        part(7, "storage", "3", type="SSD"),
    ]
    current = {1: 1, 5: 1, 6: 1, 7: 2}
    req = request("psu", "cpu", "gpu", "storage", quantities={"storage": 2})
    selection, basis = repair(rows, req, current, "PSU_CAPACITY")
    assert selection == {3: 1, 5: 1, 6: 1, 7: 2}
    assert "PSU_CAPACITY" in basis[3] and "1 → 3" in basis[3]
    second, _ = repair(rows, req, current, "PSU_CAPACITY", attempted=[selection])
    assert second == {4: 1, 5: 1, 6: 1, 7: 2}
    assert repair(rows, req, current, "PSU_CAPACITY", attempted=[selection, second]) is None
    assert repair(rows, {**req, "locked_parts": {1: 1}}, current, "PSU_CAPACITY") is None
    assert repair(rows, {**req, "budget_krw": Decimal("99")}, current, "PSU_CAPACITY") is None
    assert current == {1: 1, 5: 1, 6: 1, 7: 2}


@pytest.mark.parametrize(
    ("code", "rows", "req", "current", "expected"),
    [
        (
            "RAM_TYPE",
            [
                part(1, "ram", "20", ram_type="DDR4"),
                part(2, "ram", "22", ram_type="DDR5"),
                part(3, "motherboard", "99", ram_type="DDR5"),
            ],
            request("ram", "motherboard"),
            {1: 1, 3: 1},
            {2: 1, 3: 1},
        ),
        (
            "CPU_SUPPORT",
            [
                part(1, "cpu", "20", socket="A"),
                part(2, "motherboard", "99", socket="B"),
                part(3, "motherboard", "100", socket="A"),
            ],
            request("cpu", "motherboard", locked_parts={1: 1}),
            {1: 1, 2: 1},
            {1: 1, 3: 1},
        ),
        (
            "GPU_CLEARANCE",
            [
                part(1, "gpu", "20", length_mm=300),
                part(2, "case", "10", max_gpu_length_mm=290),
                part(3, "case", "15", max_gpu_length_mm=350),
                part(4, "gpu", "15", length_mm=260),
            ],
            request("gpu", "case", locked_parts={2: 1}),
            {1: 1, 2: 1},
            {4: 1, 2: 1},
        ),
    ],
)
def test_repair_uses_only_categories_implicated_in_the_failed_check(
    code, rows, req, current, expected
):
    assert repair(rows, req, current, code)[0] == expected
