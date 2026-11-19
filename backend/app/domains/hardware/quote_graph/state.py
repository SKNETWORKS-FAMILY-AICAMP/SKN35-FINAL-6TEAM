"""Input and in-memory state for a single hardware quote request."""

from decimal import Decimal
from typing import Annotated, Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StringConstraints

from app.domains.hardware.assembly import DEFAULT_OTHER_LOAD_W
from app.domains.hardware.ingestion.common import CATEGORIES

type Category = Literal["cpu", "motherboard", "ram", "gpu", "storage", "psu", "case", "cooler"]
type Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
type Quantity = Annotated[StrictInt, Field(gt=0)]
type Specs = dict[Text, str | int | float | bool]
type Filter = Literal["brand", "category", "topic", "verification_status"]


class Requirements(BaseModel):
    """The consultation node validates these after resolving unambiguous question terms."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    question: Text
    purpose: Text
    budget_krw: Annotated[Decimal, Field(gt=0, max_digits=15, decimal_places=2)]
    categories: Annotated[list[Category], Field(min_length=1)] = Field(
        default_factory=lambda: list(CATEGORIES)
    )
    required_brands: dict[Category, Text] = Field(default_factory=dict)
    preferred_brands: dict[Category, Text] = Field(default_factory=dict)
    required_specs: dict[Category, Specs] = Field(default_factory=dict)
    preferred_specs: dict[Category, Specs] = Field(default_factory=dict)
    locked_parts: dict[Annotated[int, Field(gt=0)], Quantity] = Field(default_factory=dict)
    quantities: dict[Category, Quantity] = Field(default_factory=dict)
    rag_filters: dict[Filter, Text] = Field(default_factory=dict)
    bios_version: Annotated[str, Field(pattern=r"^[A-Za-z0-9._-]{1,50}$")] | None = None
    front_radiator_mm: Quantity | None = None
    other_load_w: Annotated[StrictInt, Field(ge=0)] = DEFAULT_OTHER_LOAD_W
    allow_conditional_qvl: StrictBool = False
    max_retries: Annotated[StrictInt, Field(ge=0)] = 3


class QuoteInput(TypedDict):
    request: dict


class QuoteState(QuoteInput, total=False):
    requirements: dict
    rag_filters: dict[str, str]
    rag_hits: list[dict]
    citations: list[dict]
    candidates: list[dict]
    selection: dict[int, int]
    selection_basis: dict[int, str]
    attempted_selections: list[dict[int, int]]
    replacement: tuple[dict[int, int], dict[int, str]] | None
    checks: list[dict]
    blocking_failures: list[dict]
    conditions: list[dict]
    retry_count: int
    max_retries: int
    status: Literal["running", "completed", "needs_input", "needs_revision"]
    reason: str
    quote_draft: dict | None
