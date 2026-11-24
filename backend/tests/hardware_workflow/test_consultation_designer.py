"""Catalog-grounded decisions must survive selection and approval without a SKU allowlist."""

from copy import deepcopy
from unittest.mock import Mock

import pytest

from app.domains.hardware.pc_consultation import advisor, designer


@pytest.fixture
def survey(monkeypatch):
    monkeypatch.setattr(designer, "documents", lambda _: [])
    return {
        "mode": "replacement",
        "purposes": ["gaming"],
        "resolution": "qhd",
        "frameRate": "144",
        "workScale": "large",
        "_design": {"documents": [], "reasons": {"gpu": "게임 목표"}},
    }


def card(score):
    return {"name": f"가상 부품 {score}", "specs": {"measured_qhd_fps": score}}


def verdict(**overrides):
    return designer.Assessments(
        decisions=[
            designer.Assessment(
                **{
                    "index": 0,
                    "suitable": True,
                    "improves": True,
                    "reason": "가상 실측 결과 비교",
                    "spec_fields": ["measured_qhd_fps"],
                    "citations": [],
                    **overrides,
                }
            )
        ]
    )


def test_newly_cataloged_model_and_recheck_after_spec_or_preference_change(survey, monkeypatch):
    provider = Mock(return_value=verdict())
    monkeypatch.setattr(designer, "generate", provider)
    original, candidate = card(65), card(155)
    assert designer.assess(survey, "gpu", [candidate], original)[0][0]
    assert designer.assess(survey, "gpu", [deepcopy(candidate)], original)[0][0]
    assert provider.call_count == 1
    candidate["specs"]["measured_qhd_fps"] = 65
    assert not designer.assess(survey, "gpu", [candidate], original)[0][0]
    survey["_preferences"] = {"gpu": "다른 조건"}
    designer.assess(survey, "gpu", [candidate], original)
    assert provider.call_count == 3


@pytest.mark.parametrize(
    "changes",
    [{"index": 7}, {"citations": ["unreturned-document"]}, {"spec_fields": ["invented_score"]}],
)
def test_invalid_model_evidence_cannot_enter_a_quote(survey, monkeypatch, changes):
    monkeypatch.setattr(designer, "generate", Mock(return_value=verdict(**changes)))
    with pytest.raises(advisor.AdvisorError):
        designer.assess(survey, "gpu", [card(155)], card(65))
    assert not survey["_assessments"]


def test_unidentified_owned_part_or_absent_evidence_never_recommended(survey, monkeypatch):
    provider = Mock(return_value=verdict(spec_fields=[]))
    monkeypatch.setattr(designer, "generate", provider)
    assert not designer.assess(survey, "gpu", [card(155)], None)[0][0]
    provider.assert_not_called()
    assert not designer.assess(survey, "gpu", [card(155)], card(65))[0][0]


def test_provider_disabled_has_no_recommendation_fallback(monkeypatch):
    monkeypatch.setenv("BUILDWISE_CONSULTATION_PROVIDER", "local")
    provider = Mock()
    monkeypatch.setattr(advisor, "_request_openai", provider)
    with pytest.raises(advisor.AdvisorError, match="연결"):
        designer.generate(designer.Design, "test", {})
    provider.assert_not_called()


def test_general_gaming_references_match_target_without_claiming_a_named_game(survey):
    refs = designer._gaming_references(survey)
    assert refs and all("1440p" in r["text"] and "144 FPS" in r["text"] for r in refs)
    survey["problemNote"] = "스파이더맨 2"
    assert designer._gaming_references(survey) == []


def test_model_floor_is_scoped_and_missing_specs_still_get_review(survey):
    survey["_design"]["minimum_specs"] = {"cpu": 6}
    assert designer.below_minimum(survey, {"category": "cpu", "specs": {"cores": 4}})
    assert not designer.below_minimum(survey, {"category": "cpu", "specs": {"cores": 8}})
    assert not designer.below_minimum(survey, {"category": "cpu", "specs": {}})


def test_ai_designed_primary_drive_requirement_applies_before_price_sort(survey):
    disk = {"category": "storage", "specs": {"type": "5400 RPM", "capacity_gb": 1000}}
    assert not designer.below_minimum(survey, disk)
    survey["_design"]["requires_ssd"] = True
    assert designer.below_minimum(survey, disk)
    assert not designer.below_minimum(survey, {**disk, "specs": {"type": "SSD"}})


def test_verified_new_build_ram_cannot_be_vetoed_for_unrequested_channel_count(survey, monkeypatch):
    survey["mode"] = "new"
    survey["_design"]["reasons"]["ram"] = "듀얼 채널 선호"
    survey["_design"]["minimum_specs"] = {"ram": 32}
    row = {"name": "fictional single module", "specs": {"capacity_gb": 32, "modules_per_item": 1}}
    provider = Mock(side_effect=AssertionError("unexpected second model decision"))
    monkeypatch.setattr(designer, "generate", provider)
    assert designer.assess(survey, "ram", [row], None)[0][0]
    provider.assert_not_called()


def test_gpu_design_considers_chipsets_across_the_price_order(survey, monkeypatch):
    rows = [{"specs": {"chipset": f"fixture-{i}", "vram_gb": 8}} for i in range(18)]
    generate = Mock(return_value=designer.GpuScreen(plausible_indices=[14, 17]))
    monkeypatch.setattr(designer, "generate", generate)
    for _ in range(2):
        assert designer.screen_gpu_families(survey, rows, None) == {
            ("fixture-14", 8),
            ("fixture-17", 8),
        }
    generate.assert_called_once()


def test_new_gpu_family_decision_is_reused_for_partner_cards(survey, monkeypatch):
    survey["mode"] = "new"
    cards = [
        {"name": name, "specs": {"chipset": "fixture chip", "vram_gb": 16}}
        for name in ("fictional card A", "fictional card B")
    ]
    generate = Mock(
        return_value=designer.GpuDesign(
            suitable=[designer.GpuFit(index=0, reason="가상 칩셋 등급 비교", citations=[])]
        )
    )
    monkeypatch.setattr(designer, "generate", generate)
    assert ("fixture chip", 16) in designer.screen_gpu_families(survey, cards, None)
    assert all(fit for fit, _, _ in designer.assess(survey, "gpu", cards, None))
    generate.assert_called_once()
