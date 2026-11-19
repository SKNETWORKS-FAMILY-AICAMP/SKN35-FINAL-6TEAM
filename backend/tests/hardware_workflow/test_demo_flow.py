import pytest

from app.domains.hardware.consultation_demo.advisor import AdvisorError
from app.domains.hardware.consultation_demo.catalog import CATEGORY_ORDER, validate_selection
from app.domains.hardware.consultation_demo.flow import Consultation, InputError, perform


def sample_advisor(question, context, history):
    intent, amount = {
        "GPU 업그레이드": ("ask_gpu_budget", None),
        "45만원": ("gpu_budget", 450000),
        "화이트 케이스": ("white_case", None),
    }.get(question, ("chat", None))
    return dict(
        text="시연 응답",
        model="test",
        response_id="test-id",
        sources=[],
        intent=intent,
        amount=amount,
    )


def start(planner, mode, budget, **fields):
    return perform(
        planner,
        Consultation(),
        dict(action="start", mode=mode, budget=str(budget), purpose="고성능 게임", **fields),
        sample_advisor,
    )


def act(planner, state, action, **fields):
    return perform(planner, state, {"action": action, **fields}, sample_advisor)


def test_upgrade_only_charges_replacements_and_requires_memory_consent(planner):
    state = start(planner, "upgrade", 550000)
    assert state.steps == ["gpu", "ram"]
    assert planner.view(state)["total"] == 0
    gpu, excluded = planner.candidates(state)
    assert [r["price"] for r in gpu] == sorted(r["price"] for r in gpu)
    assert gpu[0]["recommended"] and gpu[0]["conditional"]
    assert 404 in [r["id"] for r in excluded]
    with pytest.raises(InputError):
        act(planner, state, "choose", part_id="404")
    state = act(planner, state, "choose", part_id="402")
    assert state.category == "ram" and planner.view(state)["remaining"] == 200000
    state = act(planner, state, "choose", part_id="302")
    view = planner.view(state)
    assert view["phase"] == "quote" and view["total"] == 440000
    assert {r["category"] for r in view["lines"]} == {"gpu", "ram"}
    with pytest.raises(InputError, match="RAM"):
        act(planner, state, "approve")
    assert act(planner, state, "approve", accept_qvl="1").phase == "payment"


def test_new_build_reallocation_and_case_change(planner):
    state = start(planner, "new", 1200000)
    default_build = dict(
        cpu=101, motherboard=201, ram=302, gpu=402, storage=502, cooler=601, psu=701, case=801
    )
    for category in CATEGORY_ORDER:
        assert state.category == category
        state = act(planner, state, "choose", part_id=str(default_build[category]))
    assert state.phase == "quote"
    state = act(planner, state, "chat", question="GPU 업그레이드")
    assert state.awaiting_gpu_budget and state.proposal is None
    state = act(planner, state, "chat", question="45만원")
    assert planner.view(state)["total"] == 1200000
    assert [(r["category"], r["delta"]) for r in state.proposal["changes"]] == [
        ("gpu", 100000),
        ("storage", -120000),
    ]
    with pytest.raises(InputError, match="변경안"):
        act(planner, state, "approve", accept_qvl="1")
    state = act(planner, state, "apply")
    assert planner.view(state)["total"] == 1180000
    state = act(planner, state, "chat", question="화이트 케이스")
    state = act(planner, state, "apply")
    assert state.selection["gpu"] == 403 and state.selection["storage"] == 501
    assert state.selection["case"] == 802 and planner.view(state)["total"] == 1190000
    assert act(planner, state, "approve", accept_qvl="1").phase == "payment"


def test_survey_rejects_invalid_budget_wrong_sku_or_unaffordable_build(planner):
    for budget in ("1", "NaN", "0"):
        with pytest.raises(InputError):
            start(planner, "new", budget)
    with pytest.raises(InputError):
        start(planner, "upgrade", 550000, owned_gpu="101")
    state = start(planner, "upgrade", 500000)
    eligible, _ = planner.candidates(state)
    assert 403 not in [r["id"] for r in eligible]


def test_service_failure_retains_quote_and_supports_explicit_retry(planner):
    def unavailable(*args):
        raise AdvisorError("OpenAI 응답을 받지 못했습니다.")

    state = perform(
        planner,
        Consultation(),
        dict(
            action="start",
            mode="upgrade",
            budget=550000,
            purpose="고성능 게임",
            question="무엇을 바꿀까요?",
        ),
        unavailable,
    )
    assert state.retry_question and len(state.messages) == 1
    assert planner.view(state)["can_retry"] and planner.view(state)["candidates"]
    retried = act(planner, state, "retry")
    assert len(retried.messages) == 2 and retried.messages[-1]["response_id"] == "test-id"
    assert retried.selection == state.selection and not retried.retry_question


def test_follow_up_question_keeps_pending_tradeoff_visible(planner):
    state = start(planner, "new", 1200000, question="GPU 업그레이드")
    assert state.awaiting_gpu_budget
    state = act(planner, state, "chat", question="45만원")
    proposal = state.proposal

    def explain(question, context, history):
        assert context["pending_proposal"]["total"] == 1180000
        return sample_advisor(question, context, history)

    state = perform(planner, state, dict(action="chat", question="왜 SSD가 바뀌나요?"), explain)
    assert state.proposal == proposal
    assert planner.view(state)["total"] == 1200000
    assert planner.targets("사무와 동영상 편집")["ram"] == 32


def test_missing_database_evidence_is_reported_as_unknown(planner):
    selected = {"cpu": 101, "motherboard": 201, "ram": 302}
    # Fixture-only fields in specs must never be treated as persisted compatibility rows.
    checks = {item["check_type"]: item for item in validate_selection(selected, planner.parts, [])}
    for kind in ("CPU_SUPPORT", "RAM_QVL"):
        assert checks[kind]["result"] == "UNKNOWN"
        assert checks[kind]["compatibility_ids"] == []
    assert "RAM_PROFILE_TEST" not in checks
