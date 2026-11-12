"""하드웨어 상담 발화 규칙 — 의도 낱말표 · 슬롯 추출 정규식 (규칙 기준선, source="rules").

라벨 기준(평가셋 data/nlu/ 과 같은 기준)은 docs/ML_PLAN.md §2 에 있습니다. 요약:

의도
  new_recommendation      새 장비 추천 · 구매 상담
  upgrade_diagnosis       가진 장비를 업그레이드하면 되는지 · 지금 장비로 되는지
  compatibility_question  부품 · 장비끼리 맞는지(파워 · 케이스 · 슬롯 · 규격)
  quote_request           견적 · 총액 · 주문 · 견적서 출력
  cloud_comparison        클라우드 GPU 를 빌리는 것과 사는 것 비교
  other                   그 밖(인사 · 배송 · 환불 등)

슬롯
  budget_max(원) · purpose · model_params_b(10억 단위) · precision · product_types(사려는 유형)
  owned_device · owned_ram_gb · owned_vram_gb(가진 장비) · weekly_hours(주당 사용 시간)
"""

import re

from app.nlu.base import NluPipeline, Slots
from app.nlu.rules import IntentRule, KeywordIntentClassifier, normalize

INTENTS = (
    "new_recommendation",
    "upgrade_diagnosis",
    "compatibility_question",
    "quote_request",
    "cloud_comparison",
    "other",
)
# 점수가 같을 때 앞의 의도를 고릅니다(더 구체적인 의도 먼저).
INTENT_PRIORITY = (
    "cloud_comparison",
    "upgrade_diagnosis",
    "compatibility_question",
    "quote_request",
    "new_recommendation",
    "other",
)

INTENT_RULES = (
    IntentRule(
        "cloud_comparison",
        ("클라우드", "빌려", "빌리", "빌릴", "대여", "임대", "렌탈", "시간당", "손익분기", "구독"),
        2.0,
    ),
    IntentRule(
        "cloud_comparison",
        (
            "사는 게 나",
            "사는 게 낫",
            "사는게 나",
            "사는게 낫",
            "직접 사는",
            "원격 gpu",
            "gpu 서버를 빌",
        ),
        1.0,
    ),
    IntentRule("upgrade_diagnosis", ("업그레이드", "증설", "업글"), 2.0),
    IntentRule(
        "upgrade_diagnosis",
        (
            "늘리",
            "늘릴",
            "추가하면",
            "추가해도",
            "달면",
            "꽂으면",
            "교체하면",
            "바꾸면",
            "지금 쓰는",
            "쓰고 있는",
            "갖고 있는",
            "가지고 있는",
            "보유",
            "돌아갈까",
            "돌릴 수 있을까",
            "돌아가나",
            "돌아갈 수",
            "버틸",
            "충분할까",
            "충분한가",
            "가능할까",
        ),
        1.0,
    ),
    IntentRule("compatibility_question", ("호환",), 2.5),
    IntentRule(
        "compatibility_question",
        ("들어가", "장착", "꽂을 수", "맞나요", "맞을까", "맞는지", "지원하나", "지원되나", "인식"),
        1.5,
    ),
    IntentRule(
        "compatibility_question",
        ("파워", "케이스", "슬롯", "메인보드", "규격", "같이 쓸", "연결"),
        1.0,
    ),
    IntentRule("quote_request", ("견적",), 2.5),
    IntentRule(
        "quote_request",
        ("총액", "합계", "주문", "결제", "pdf", "인쇄", "출력", "구매할게", "살게요", "계산서"),
        1.5,
    ),
    IntentRule("quote_request", ("얼마", "가격", "금액", "할인", "배송비"), 1.0),
    IntentRule(
        "new_recommendation",
        ("추천", "골라", "고르", "사려고", "살까", "구매하려", "장만"),
        2.0,
    ),
    IntentRule(
        "new_recommendation",
        (
            "사고 싶",
            "구입",
            "새로",
            "새 ",
            "입문용",
            "뭐가 좋",
            "어떤 게 좋",
            "어떤게 좋",
            "어떤 걸",
            "어떤 거",
            "찾고 있",
            "맞춰 주",
            "맞춰줘",
            "구성해",
        ),
        1.0,
    ),
    IntentRule(
        "other",
        (
            "안녕",
            "감사",
            "고마",
            "환불",
            "반품",
            "교환",
            "영업시간",
            "상담원",
            "a/s",
            "매장",
            "배송은 언제",
            "배송 언제",
            "언제 와",
            "언제 도착",
        ),
        2.0,
    ),
)

# ── 슬롯 ──────────────────────────────────────────────────────────────

PURPOSES: dict[str, str] = {
    # 코드 → 요구사항 purpose 문장(사람이 읽는 이름)
    "llm_finetune": "LLM 파인튜닝(LoRA)",
    "llm_inference": "LLM 실행(추론)",
    "image_generation": "이미지 생성 AI",
    "dl_study": "딥러닝 공부",
    "general_dev": "개발 · 코딩",
}
PURPOSE_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    # 앞에 있는 것이 우선입니다.
    (
        "llm_finetune",
        (
            "파인튜닝",
            "파인 튜닝",
            "미세조정",
            "미세 조정",
            "fine-tun",
            "finetun",
            "lora",
            "추가 학습",
            "학습시키",
            "학습 시키",
            "학습을 시키",
            "튜닝",
        ),
    ),
    (
        "image_generation",
        (
            "이미지 생성",
            "그림 생성",
            "이미지 만들",
            "그림 그리",
            "스테이블",
            "디퓨전",
            "diffusion",
            "이미지 ai",
        ),
    ),
    (
        "llm_inference",
        ("추론", "돌리", "돌려", "돌릴", "돌아가", "실행", "서빙", "챗봇", "inference", "구동"),
    ),
    (
        "dl_study",
        (
            "공부",
            "입문",
            "수업",
            "강의",
            "과제",
            "캐글",
            "kaggle",
            "부트캠프",
            "실습",
            "배우",
            "튜토리얼",
        ),
    ),
    ("general_dev", ("코딩", "프로그래밍", "개발용", "웹 개발", "앱 개발", "파이썬")),
)
# LLM 실행(추론)은 AI 모델 이야기가 있을 때만 봅니다("게임 돌릴" 같은 말을 빼려고).
AI_CONTEXT = ("llm", "모델", "언어모델", "언어 모델", "ai", "gpt", "챗봇", "인공지능", "딥러닝")

DEVICE_WORDS: tuple[tuple[str, str], ...] = (
    ("노트북", "laptop"),
    ("랩탑", "laptop"),
    ("랩톱", "laptop"),
    ("데스크톱", "desktop"),
    ("데스크탑", "desktop"),
    ("본체", "desktop"),
    ("조립 pc", "desktop"),
    ("조립pc", "desktop"),
    ("그래픽카드", "gpu"),
    ("그래픽 카드", "gpu"),
    ("글카", "gpu"),
    ("gpu", "gpu"),
    ("워크스테이션", "server"),
    ("서버", "server"),
    ("모니터", "monitor"),
)
CLOUD_WORDS = ("클라우드", "빌려", "빌리", "빌릴", "대여", "임대", "렌탈", "시간당")
OWNED_MARKERS = (
    "제 ",
    "제가",
    "저의",
    "내 ",
    "나의",
    "집에 있는",
    "지금 쓰",
    "현재 쓰",
    "쓰고 있",
    "쓰던",
    "갖고 있",
    "가지고 있",
    "보유",
    "기존",
    "사용 중",
    "사용중",
)
# 장비가 아니라 현재 상태를 말할 때(→ 램 · VRAM 숫자는 '가진 장비' 값)
STATE_MARKERS = (*OWNED_MARKERS, "인데", "이라서", "라서", "밖에 없")
UPGRADE_WORDS = ("업그레이드", "증설", "업글", "늘리", "늘릴", "교체", "추가하면", "추가해도")
BUY_WORDS = ("추천", "사려", "살까", "구매", "새로", "새 ", "장만", "구입")

_GB = r"\s*(?:gb|기가|g)(?![a-z])"
VRAM_PATTERNS = (
    re.compile(
        r"(?:vram|브이램|비램|그래픽\s*메모리|gpu\s*메모리|그래픽카드\s*메모리)\s*"
        r"(?:은|는|이|가|도|이랑)?\s*(\d+)" + _GB
    ),
    re.compile(r"(\d+)" + _GB + r"\s*(?:짜리\s*)?(?:vram|브이램|비램|그래픽\s*메모리)"),
    re.compile(r"(?:그래픽카드|그래픽 카드|글카|gpu)\D{0,8}?(\d+)" + _GB),
)
RAM_PATTERNS = (
    re.compile(r"(?:램|ram|메모리)\s*(?:은|는|이|가|도|을|를)?\s*(\d+)" + _GB),
    re.compile(r"(\d+)" + _GB + r"\s*(?:짜리\s*)?(?:램|ram|메모리)"),
)
INTEGRATED_GPU = re.compile(r"내장\s*(?:그래픽|gpu)")

MODEL_PATTERNS = (
    (re.compile(r"(\d+(?:\.\d+)?)\s*b(?![a-z])"), 1.0),
    (re.compile(r"(\d+(?:\.\d+)?)\s*억\s*(?:개의?\s*)?(?:파라미터|매개변수)"), 0.1),
    (re.compile(r"(\d+(?:\.\d+)?)\s*(?:십억|billion)"), 1.0),
)
PRECISION_PATTERNS = (
    ("int4", re.compile(r"(?<!\d)4\s*(?:bit|비트)|int4|qlora|gptq|awq|gguf|q4|nf4")),
    ("int8", re.compile(r"(?<!\d)8\s*(?:bit|비트)|int8|q8")),
    ("fp16", re.compile(r"fp16|bf16|(?<!\d)16\s*(?:bit|비트)|반정밀도")),
    ("fp32", re.compile(r"fp32|(?<!\d)32\s*(?:bit|비트)|단정밀도")),
)
BUDGET_PATTERNS = (
    (re.compile(r"(\d+(?:\.\d+)?)\s*억(?!\s*(?:개|파라미터|매개변수))"), 100_000_000),
    (re.compile(r"(\d+(?:\.\d+)?)\s*천\s*만"), 10_000_000),
    (re.compile(r"(\d+(?:\.\d+)?)\s*백\s*만"), 1_000_000),
    (re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*만"), 10_000),
    (re.compile(r"(\d{1,3}(?:,\d{3})+|\d{5,})\s*원"), 1),
    (re.compile(r"(?<![\d.])백\s*만\s*원"), 1_000_000),
    (re.compile(r"(?<![\d.])천\s*만\s*원"), 10_000_000),
)
HOURLY_PRICE = re.compile(r"시간당\s*$")
HOURS_PATTERNS = (
    (
        re.compile(r"(?:일주일|\d\s*주일|한\s*주|주)\s*(?:에|당|마다)?\s*(\d+(?:\.\d+)?)\s*시간"),
        1.0,
    ),
    (re.compile(r"(?:하루|매일|날마다)\s*(?:에|당)?\s*(\d+(?:\.\d+)?)\s*시간"), 7.0),
    (re.compile(r"(?:한\s*달|월)\s*(?:에|당)?\s*(\d+(?:\.\d+)?)\s*시간"), 12 / 52),
    (re.compile(r"주말(?:에만?|마다)?\s*(\d+(?:\.\d+)?)\s*시간"), 1.0),
)


def _number(value: float) -> int | float:
    return int(value) if float(value).is_integer() else round(value, 1)


def _owned_device_at(text: str, start: int) -> bool:
    window = text[max(0, start - 12) : start]
    return any(marker in window for marker in OWNED_MARKERS)


def _has_any(text: str, words: tuple[str, ...]) -> bool:
    return any(word in text for word in words)


class HardwareSlotExtractor:
    source = "rules"

    def extract(self, text: str) -> Slots:
        t = normalize(text)
        slots: Slots = {}
        for name, value in (
            ("budget_max", self._budget(t)),
            ("purpose", self._purpose(t)),
            ("model_params_b", self._model_size(t)),
            ("precision", self._precision(t)),
            ("weekly_hours", self._weekly_hours(t)),
        ):
            if value is not None:
                slots[name] = value
        product_types, owned_device = self._devices(t)
        if product_types:
            slots["product_types"] = product_types
        if owned_device:
            slots["owned_device"] = owned_device
        slots.update(self._owned_specs(t))
        return slots

    def _budget(self, t: str) -> int | None:
        amounts: list[float] = []
        remaining = t
        for pattern, unit in BUDGET_PATTERNS:
            for match in pattern.finditer(remaining):
                if HOURLY_PRICE.search(remaining[max(0, match.start() - 8) : match.start()]):
                    continue
                number = (float(match.group(1).replace(",", "")) if pattern.groups else 1.0) * unit
                amounts.append(number)
            remaining = pattern.sub(" ", remaining)
        valid = [a for a in amounts if 10_000 <= a <= 1_000_000_000]
        return int(max(valid)) if valid else None

    def _purpose(self, t: str) -> str | None:
        has_ai = _has_any(t, AI_CONTEXT) or self._model_size(t) is not None
        for code, words in PURPOSE_KEYWORDS:
            if code == "llm_inference" and not has_ai:
                continue
            if _has_any(t, words):
                return code
        return None

    def _model_size(self, t: str) -> int | float | None:
        for pattern, scale in MODEL_PATTERNS:
            match = pattern.search(t)
            if match:
                value = round(float(match.group(1)) * scale, 3)
                if 0.1 <= value <= 2000:
                    return _number(value)
        return None

    def _precision(self, t: str) -> str | None:
        found: list[tuple[int, str]] = []
        for code, pattern in PRECISION_PATTERNS:
            found += [(m.start(), code) for m in pattern.finditer(t)]
        if found:
            return max(found)[1]  # 마지막에 말한 정밀도("FP16 말고 4비트")
        return "int4" if "양자화" in t else None  # 비트를 말하지 않은 '양자화'는 4비트로 봅니다

    def _weekly_hours(self, t: str) -> int | float | None:
        for pattern, scale in HOURS_PATTERNS:
            match = pattern.search(t)
            if match:
                value = float(match.group(1)) * scale
                if 0 < value <= 168:
                    return _number(value)
        return None

    def _devices(self, t: str) -> tuple[list[str], str | None]:
        cloud = _has_any(t, CLOUD_WORDS)
        upgrade_only = _has_any(t, UPGRADE_WORDS) and not _has_any(t, BUY_WORDS)
        product_types: list[str] = []
        owned: str | None = None
        taken: list[tuple[int, int]] = []
        for word, code in DEVICE_WORDS:
            for match in re.finditer(re.escape(word), t):
                start, end = match.span()
                if any(s <= start < e for s, e in taken):
                    continue  # '그래픽카드' 안의 'gpu' 처럼 겹친 낱말
                taken.append((start, end))
                after = t[end : end + 4]
                if code == "gpu" and (cloud or re.match(r"\s*(?:메모리|vram|램)", after)):
                    continue
                if code == "server" and cloud:
                    continue
                if _owned_device_at(t, start) or (upgrade_only and code in ("laptop", "desktop")):
                    if code in ("laptop", "desktop") and owned is None:
                        owned = code
                    continue
                if code not in product_types:
                    product_types.append(code)
        return product_types, owned

    def _owned_specs(self, t: str) -> Slots:
        if not (_has_any(t, STATE_MARKERS) or _has_any(t, UPGRADE_WORDS)):
            return {}
        slots: Slots = {}
        remaining = t
        for pattern in VRAM_PATTERNS:
            match = pattern.search(remaining)
            if match:
                slots["owned_vram_gb"] = int(match.group(1))
                remaining = remaining[: match.start()] + " " + remaining[match.end() :]
                break
        if "owned_vram_gb" not in slots and INTEGRATED_GPU.search(remaining):
            slots["owned_vram_gb"] = 0
        for pattern in RAM_PATTERNS:
            match = pattern.search(remaining)
            if match:
                slots["owned_ram_gb"] = int(match.group(1))
                break
        return slots


def build_nlu() -> NluPipeline:
    return NluPipeline(
        KeywordIntentClassifier(INTENT_RULES, INTENT_PRIORITY, fallback="other"),
        HardwareSlotExtractor(),
    )
