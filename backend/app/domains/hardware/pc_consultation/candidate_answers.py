"""Answer a customer's question using the shortlist their session actually received."""

import re

from . import parts_db
from .catalog import LABELS

_MISSING = re.compile(
    r"안\s*(?:나오|나와|뜨|떠|보이|보여|추천)|못\s*(?:찾|보)|없|제외|빠[졌진]|누락"
)
_ASK = re.compile(r"왜|이유|까닭|근거|어째서|어떤\s*기준|추천\s*기준")
_MODEL = re.compile(
    r"(?<![a-z0-9])(?:rtx\s*|gtx\s*|rx\s*|[a-z]{1,5}[- ]?)?\d{3,5}[a-z0-9]*(?:\s*(?:ti|xtx|xt|super)\b)*",
    re.I | re.ASCII,
)
_ROLES = {
    "그래픽카드": "gpu",
    "메모리": "ram",
    "저장장치": "storage",
    "ssd": "storage",
    **{v.lower(): k for k, v in LABELS.items()},
}


def _recommendation(snapshot):
    evidence = snapshot["evidence"]
    return {
        "text": " ".join(
            filter(
                None,
                [
                    f"첫 추천 모델은 {snapshot['shown'][0]}입니다.",
                    snapshot["reason"],
                    evidence.get("message"),
                ],
            )
        ),
        "sources": evidence.get("sources", []),
    }


def _model_key(value):
    return re.sub(r"^(?:rtx|gtx|rx|gpu)", "", re.sub(r"\s+", "", value.lower()))


def _same_model(name, token):
    return any(_model_key(m[0]) == token for m in _MODEL.finditer(name))


def _catalog_reason(snapshot, model, survey):
    # SQL already filters price and performance before compatibility evaluation.
    # A targeted lookup can explain these cases without re-running the shortlist.
    token = _model_key(model)
    rows = parts_db.load_catalog(
        parts_db.SHOP_COMPANY_ID,
        category=snapshot["category"],
        query=re.sub(r"(?<=\d)(?=ti|xt|super)", " ", token),
        limit=20,
    ).parts
    for row in rows:
        if not _same_model(row["name"], token):
            continue
        if row["price"] > snapshot["budget"]:
            return f"{row['name']}의 현재 가격은 {row['price']:,}원으로, 조회 한도 {snapshot['budget']:,}원을 넘어요."
    return None


def answer_question(question, snapshots, survey):
    text = question.strip().lower()
    missing = _MISSING.search(text)
    model = _MODEL.search(text)
    role = next((r for label, r in _ROLES.items() if label in text), None)
    topic = re.search(r"추천|후보|목록|이\s*(?:거|제품|부품)", text)
    hidden = re.search(r"안\s*(?:보|떠|뜨|나와|나오)|제외|누락", text)
    if not (_ASK.search(text) or hidden) or not (topic or hidden or (missing and (role or model))):
        return None
    if not role and model and model[0].startswith(("rtx", "gtx", "rx")):
        role = "gpu"
    if not snapshots:
        return {"text": "부품 후보를 조회하면 해당 목록의 추천·제외 이유를 알려드릴 수 있어요."}
    if role and role not in snapshots:
        return {"text": f"아직 {LABELS[role]} 후보를 조회한 기록이 없어요."}
    current = snapshots[role or next(reversed(snapshots))]
    label = LABELS[current["category"]]
    shown = current["shown"]
    # Prefer an explicitly named SKU over the most recent category. Keep separate
    # board-partner variants separate when their fit or price differs.
    history = [current] if role else list(reversed(snapshots.values()))
    for snapshot in history:
        matches = [(n, why) for n, why in snapshot["excluded"] if n.casefold() in text]
        visible = [n for n in snapshot["shown"] if n.casefold() in text]
        if model and not (matches or visible):
            token = _model_key(model[0])
            matches = [(n, why) for n, why in snapshot["excluded"] if _same_model(n, token)]
            visible = [n for n in snapshot["shown"] if _same_model(n, token)]
        if visible or matches:
            name = visible[0] if visible else matches[0][0]
            if visible and name == snapshot["shown"][0]:
                return _recommendation(snapshot)
            if visible:
                return {
                    "text": f"조회한 후보 목록에 {name} 모델이 있어요. 첫 추천은 {snapshot['shown'][0]}입니다. {snapshot['reason']}"
                }
            return {"text": f"{name}의 제외 사유입니다. {matches[0][1]}"}
    filters = [f"{current['budget']:,}원 이하", *current["criteria"]]
    if current["color"]:
        filters.append(current["color"])
    scope = f"{label} 조회 조건은 {', '.join(filters)}입니다."
    if model:
        if missing and survey:
            reason = _catalog_reason(current, model[0], survey)
            if reason:
                return {"text": reason}
        return {"text": f"{model[0].upper()}의 개별 판정 기록은 없어요. {scope}"}
    if missing or not shown:
        result = scope + " "
        if current["reasons"]:
            result += "검사에서 확인한 제외 사유는 다음과 같아요. " + " ".join(current["reasons"])
        elif not shown:
            result += "조회 조건을 모두 충족한 상품이 없어요."
        else:
            result += "어떤 모델이 보이지 않는지 알려 주세요."
        return {"text": result}
    return _recommendation(current)
