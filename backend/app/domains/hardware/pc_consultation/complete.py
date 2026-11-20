"""Run the official quote graph with exactly the parts resolved for this shop."""

from threading import Lock

from app.domains.hardware.quote_graph import build_graph
from app.domains.hardware.quote_graph.adapters import LocalServices
from app.domains.hardware.quote_graph.nodes import ASSEMBLY_CHECK_TYPES

from .flow import purpose

_index_lock = Lock()


class _SelectedBuild:
    def __init__(self, parts, checks):
        self.parts = parts
        self.checks = checks

    def catalog(self, categories, *, locked_ids):
        return [
            {
                "part_id": row["id"],
                "category": row["category"],
                "name": row["name"],
                "brand": row["brand"],
                "currency": row["currency"],
                "current_price": row["price"],
                "price_checked_at": row["price_checked_at"],
                "specs": {
                    **row["specs"],
                    "_provenance": {
                        "source_key": row["source_key"],
                        "price_status": row["price_status"],
                        "price_basis": row.get("price_basis"),
                    },
                },
            }
            for row in self.parts
            if row["category"] in categories and row["id"] in locked_ids
        ]

    def validate(self, selection, **params):
        if selection != {p["id"]: 1 for p in self.parts}:
            raise ValueError("선택한 부품과 검증할 조합이 다릅니다.")
        return [
            dict(check, source_urls=[s["url"] for s in check.get("sources", ())])
            for check in self.checks
            if check["check_type"] in ASSEMBLY_CHECK_TYPES
        ]

    def retrieve(self, question, filters):
        # Qdrant's embedded implementation permits one client per index directory at a time.
        with _index_lock:
            return LocalServices().retrieve(question, filters)


def inspect_build(survey, parts, buy, checks):
    services = _SelectedBuild(parts, checks)
    # The graph prices every locked component. Account for the existing equipment once,
    # then keep only purchased replacements in the customer's quote and budget.
    existing_value = sum(row["price"] for row in parts if row["category"] not in buy)
    request = {
        "question": f"{purpose(survey)} PC 조립 호환성 검증 "
        + " ".join(
            row["name"] for row in parts if row["category"] in {"cpu", "motherboard", "ram"}
        ),
        "purpose": purpose(survey),
        "budget_krw": survey["budget"] + existing_value,
        "locked_parts": {row["id"]: 1 for row in parts},
        "max_retries": 0,
        # A conditional draft still requires the customer's explicit consent at confirmation.
        "allow_conditional_qvl": True,
    }
    state = build_graph(services).invoke({"request": request})
    return {
        "workflow_status": state["status"],
        "workflow_reason": state["reason"],
        "citations": state["citations"],
    }
