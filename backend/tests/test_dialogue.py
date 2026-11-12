"""DB 없이 도는 테스트: 채팅 상담의 다음 답(되묻기 · 요구사항 확정 · 진단 · 비교)과 선택지 값 검사."""

import pytest

from app.core.config import Settings
from app.domains.base import DialogueContext
from app.domains.hardware.pack import HardwarePack
from app.nlu.base import Slots
from app.seed import load_catalog, read_seeds

PACK = HardwarePack()
FIXTURES = Settings().fixtures_dir
ALL_TYPES = ["laptop", "desktop", "gpu", "server", "monitor"]


def _ctx(intent: str, slots: Slots, supported: list[str] = ALL_TYPES, has_quote: bool = False):
    seed = next(s for s in read_seeds(FIXTURES) if s.slug == "public-demo")
    return DialogueContext(
        intent=intent,
        slots=slots,
        supported_product_types=supported,
        has_quotation=has_quote,
        catalog=lambda: load_catalog(seed, FIXTURES),
        fixtures_dir=FIXTURES,
    )


def test_missing_slots_are_asked_one_at_a_time_with_chips() -> None:
    first = PACK.respond(_ctx("new_recommendation", {}))
    assert first.requirements is None and "장비" in first.text
    assert [c.value for c in first.quick_replies] == ALL_TYPES

    second = PACK.respond(_ctx("new_recommendation", {"product_types": ["laptop"]}))
    assert "예산" in second.text
    assert {c.slot for c in second.quick_replies} == {"budget_max"}


def test_complete_slots_become_requirements_with_model_preferences() -> None:
    reply = PACK.respond(
        _ctx(
            "new_recommendation",
            {
                "product_types": ["desktop"],
                "budget_max": 4_000_000,
                "purpose": "llm_finetune",
                "model_params_b": 7,
                "precision": "int4",
            },
        )
    )
    assert reply.requirements is not None
    assert reply.requirements.product_types == ["desktop"]
    assert reply.requirements.budget_max == 4_000_000
    assert reply.requirements.preferences == {
        "model_params_b": 7.0,
        "precision": "int4",
        "workload": "lora",
    }
    assert "7.7GB" in reply.text
    assert any(c.slot == "budget_max" for c in reply.quick_replies)


def test_unsupported_product_type_is_reasked_with_company_types() -> None:
    reply = PACK.respond(
        _ctx("new_recommendation", {"product_types": ["gpu"]}, supported=["laptop", "desktop"])
    )
    assert reply.requirements is None and "취급하지 않아요" in reply.text
    assert [c.value for c in reply.quick_replies] == ["laptop", "desktop"]


def test_upgrade_diagnosis_reply() -> None:
    reply = PACK.respond(
        _ctx(
            "upgrade_diagnosis",
            {"owned_device": "laptop", "owned_ram_gb": 16, "owned_vram_gb": 0, "model_params_b": 7},
        )
    )
    assert reply.requirements is None
    assert reply.text.startswith("새 장비 필요")
    assert {c.value for c in reply.quick_replies} >= {"new_recommendation", "int4"}


def test_cloud_comparison_reply_uses_catalog_price() -> None:
    reply = PACK.respond(_ctx("cloud_comparison", {"model_params_b": 7, "weekly_hours": 10}))
    assert "개월" in reply.text and "테스트 데이터" in reply.text


def test_quote_request_with_existing_quote_points_to_print() -> None:
    reply = PACK.respond(_ctx("quote_request", {"budget_max": 2_000_000}, has_quote=True))
    assert "PDF" in reply.text and reply.requirements is None


@pytest.mark.parametrize(
    ("slot", "value", "expected"),
    [
        ("budget_max", "2000000", 2_000_000),
        ("model_params_b", "7", 7),
        ("model_params_b", "1.5", 1.5),
        ("precision", "int4", "int4"),
        ("product_types", "laptop,monitor", ["laptop", "monitor"]),
        ("owned_vram_gb", "0", 0),
        ("weekly_hours", "10", 10),
    ],
)
def test_quick_reply_values_are_parsed(slot: str, value: str, expected: object) -> None:
    assert PACK.parse_slot_value(slot, value) == expected


@pytest.mark.parametrize(
    ("slot", "value"),
    [
        ("budget_max", "abc"),
        ("budget_max", "5"),
        ("precision", "int3"),
        ("product_types", "sofa"),
        ("owned_device", "phone"),
        ("unknown_slot", "1"),
    ],
)
def test_bad_quick_reply_values_are_rejected(slot: str, value: str) -> None:
    with pytest.raises(ValueError):
        PACK.parse_slot_value(slot, value)
