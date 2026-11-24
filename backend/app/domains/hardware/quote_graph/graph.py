"""Compile one read-only workflow; callers own the lifetime of its services."""

from functools import partial
from sys import maxsize

from langgraph.graph import END, START, StateGraph

from app.domains.hardware.quote_graph import nodes
from app.domains.hardware.quote_graph.state import QuoteInput, QuoteState


def build_graph(services):
    """Invoke with {"request": ...}. Only the graph can set validation and consent state."""
    builder = StateGraph(QuoteState, input_schema=QuoteInput)
    builder.add_node("consultation", nodes.consultation)
    builder.add_node("retrieve_rag", partial(nodes.retrieve_rag, services=services))
    builder.add_node("design", partial(nodes.design, services=services))
    builder.add_node("validation", partial(nodes.validation, services=services))
    builder.add_node("quotation", nodes.quotation)
    builder.add_edge(START, "consultation")
    for source, target in (
        ("consultation", "retrieve_rag"),
        ("retrieve_rag", "design"),
        ("design", "validation"),
    ):
        builder.add_conditional_edges(source, _can_proceed, {True: target, False: END})
    builder.add_conditional_edges(
        "validation", _after_validation, {"retry": "design", "ready": "quotation", "stop": END}
    )
    builder.add_edge("quotation", END)
    # The configured retry budget and exhausted candidate set bound this acyclic-per-attempt
    # workflow. A hidden framework step limit would cut off larger user-specified budgets.
    return builder.compile().with_config(recursion_limit=maxsize)


def _can_proceed(state: QuoteState) -> bool:
    return state["status"] == "running"


def _after_validation(state: QuoteState) -> str:
    if not _can_proceed(state):
        return "stop"
    return "retry" if state.get("replacement") is not None else "ready"
