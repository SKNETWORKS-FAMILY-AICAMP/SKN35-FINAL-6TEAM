"""Wire models for a single shop's anonymous, session-scoped PC consultation."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.contracts.schemas import UtcDatetime

type Category = Literal["cpu", "motherboard", "ram", "gpu", "storage", "cooler", "psu", "case"]
type PositiveId = Annotated[int, Field(strict=True, gt=0, le=9_007_199_254_740_991)]
type Money = Annotated[int, Field(strict=True, ge=0, le=1_000_000_000)]
type Text = Annotated[str, Field(max_length=300)]
type Selection = dict[Category, PositiveId]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OwnedPart(Input):
    category: Category
    name: Text
    part_id: PositiveId | None


class Survey(Input):
    mode: Literal["replacement", "new"]
    budget: Annotated[int, Field(strict=True, gt=0, le=1_000_000_000)]
    purposes: list[Literal["gaming", "image", "video", "other"]] = Field(min_length=1, max_length=4)
    resolution: Literal["fhd", "qhd", "4k"]
    frameRate: Literal["60", "144"]
    workScale: Literal["basic", "large"]
    problems: list[Text] = Field(max_length=20)
    problemNote: str = Field(max_length=1500)
    owned: dict[Category, OwnedPart]

    @model_validator(mode="after")
    def check_owned(self):
        if any(category != item.category for category, item in self.owned.items()):
            raise ValueError("보유 부품의 분류가 일치하지 않습니다.")
        if self.mode == "replacement" and not self.owned:
            raise ValueError("부품 교체 상담에는 보유 부품이 필요합니다.")
        return self


class PlanIn(Input):
    survey: Survey


class SelectionIn(PlanIn):
    selected: Selection


class CandidatesIn(SelectionIn):
    category: Category
    budget: Money
    color: Text | None = None
    note: str | None = Field(default=None, max_length=1500)


class RebalanceIn(CandidatesIn):
    amount: Money


class QuoteIn(SelectionIn):
    version: PositiveId


class ConfirmIn(Input):
    quote_id: str = Field(min_length=1, max_length=64)
    accept_conditions: Annotated[bool, Field(strict=True)]


class MessageIn(Input):
    text: str = Field(min_length=1, max_length=2000)
    survey: Survey | None = None
    selected: Selection = Field(default_factory=dict)


class SessionOut(BaseModel):
    session_id: str


class Part(BaseModel):
    part_id: PositiveId
    source_key: str
    category: Category
    brand: str
    name: str
    specs: dict[str, Any]
    current_price: int | None
    currency: str
    price_status: str
    price_basis: str | None = None
    data_status: str
    price_checked_at: str | None
    power_draw_w: float | None
    power_status: str | None = None
    image_url: str | None = None


class PlanOut(BaseModel):
    steps: list[Category]
    reasons: dict[Category, str]
    allocations: dict[Category, int]
    criteria: list[str]


class Source(BaseModel):
    title: str
    url: str


class ValidationCheck(BaseModel):
    code: str
    status: Literal["PASS", "CONDITIONAL", "UNKNOWN", "FAIL", "PENDING"]
    message: str
    source: str | None = None
    sources: list[Source] = Field(default_factory=list)


class ValidationOut(BaseModel):
    status: Literal["PASS", "CONDITIONAL", "UNKNOWN", "FAIL"]
    checks: list[ValidationCheck]
    basis: Literal["api"]
    workflow_status: Literal["completed", "needs_input", "needs_revision"] | None = None
    workflow_reason: str | None = None
    citations: list[dict[str, Any]] = Field(default_factory=list)


class Candidate(BaseModel):
    part: Part
    validation: ValidationOut
    recommended: bool
    reason: str


class CandidatesOut(BaseModel):
    passed: list[Candidate]
    needsReview: list[Candidate]
    rejectedCount: int
    missingColorCount: int
    sortLabel: str
    criteria: list[str]
    basis: Literal["api"]


class Alternative(BaseModel):
    category: Category
    before: Part
    after: Part
    validation: ValidationOut


class RebalanceOut(BaseModel):
    alternatives: list[Alternative]
    beforeTotal: int
    afterTotal: int
    allocations: dict[Category, int]
    feasible: bool
    explanation: str


class QuoteItem(BaseModel):
    part_id: PositiveId
    source_key: str
    category: Category
    part_name_snapshot: str
    unit_price: int
    quantity: int
    price_checked_at: str | None
    price_basis: str | None = None
    price_status: str | None = None


class QuoteOut(BaseModel):
    quote_id: str
    consultation_id: str
    version: PositiveId
    status: Literal["DRAFT", "CONFIRMED"]
    currency: Literal["KRW"]
    total_amount: int
    created_at: UtcDatetime
    items: list[QuoteItem]
    validation: ValidationOut


class ReceiptOut(BaseModel):
    quote: QuoteOut
    storage: Literal["session"] = "session"
    message: str


class MessageOut(BaseModel):
    id: PositiveId
    role: Literal["user", "assistant"]
    content: str
    created_at: UtcDatetime
    sources: list[Source] = Field(default_factory=list)


class ReplyOut(BaseModel):
    text: str
    sources: list[Source]
    messages: list[MessageOut]
