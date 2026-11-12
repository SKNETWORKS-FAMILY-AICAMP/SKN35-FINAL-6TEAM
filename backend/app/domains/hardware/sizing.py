"""AI 모델을 돌리는 데 필요한 VRAM · 램 · 저장공간 추정.

공식 (모두 근사입니다. 실측값이 아니므로 화면 · 문서에 '추정'으로 표시합니다)

    가중치(GB)   = 파라미터 수(B) × 정밀도별 바이트            # 1B 파라미터 × 1바이트 = 1GB(10^9 바이트)로 계산
    추론 VRAM    = 가중치 × 여유 계수 1.2                      # KV 캐시 · 활성값 · CUDA 런타임 몫
    LoRA VRAM    = 가중치 × 1.2 + 파라미터 수(B) × 0.5GB        # 어댑터 · 옵티마이저 상태 · 역전파 활성값
                                                               #   (배치 1 · 짧은 문맥 기준 · QLoRA 도 같은 식)
    정밀도별 바이트: fp32 4 · fp16(bf16) 2 · int8 1 · int4(4비트) 0.5

    시스템 램    = 필요 VRAM 이상인 표준 용량(8·16·32·64·128 …GB), 최소 16GB
                   # 모델을 GPU 로 올리기 전에 램에 한 번 읽어 들이기 때문
    저장공간     = 원본(fp16) 가중치 × 2(원본 + 변환본 · 체크포인트) + 100GB(OS · 도구 · 데이터셋)

예: 7B · int4 · 추론 → 7 × 0.5 = 3.5GB × 1.2 = 4.2GB
    7B · int4 · LoRA → 3.5 × 1.2 + 7 × 0.5 = 7.7GB
    7B · fp16 · 추론 → 14 × 1.2 = 16.8GB

설계팀은 이 값을 `min_vram_gb` 조건으로 바꿔 후보를 거릅니다(pack.derive_preferences).
"""

import math

from app.contracts.schemas import Precision, VramEstimateOut, Workload

BYTES_PER_PARAM: dict[Precision, float] = {
    Precision.fp32: 4.0,
    Precision.fp16: 2.0,
    Precision.int8: 1.0,
    Precision.int4: 0.5,
}
OVERHEAD_FACTOR = 1.2
LORA_EXTRA_GB_PER_B = 0.5
MIN_SYSTEM_RAM_GB = 16
STANDARD_RAM_SIZES_GB = (8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096)
STORAGE_BASE_GB = 100

PRECISION_LABELS: dict[Precision, str] = {
    Precision.fp32: "FP32",
    Precision.fp16: "FP16",
    Precision.int8: "INT8",
    Precision.int4: "4비트",
}
WORKLOAD_LABELS: dict[Workload, str] = {
    Workload.inference: "추론",
    Workload.lora: "LoRA 학습",
}

ASSUMPTIONS = [
    "1B 파라미터 × 1바이트 = 1GB(10^9 바이트)로 계산한 근사치입니다(실측 아님).",
    "여유 계수 1.2 는 KV 캐시 · 활성값 · 런타임 몫입니다. 긴 문맥 · 큰 배치는 더 필요합니다.",
    "LoRA 학습 추가분은 파라미터 10억 개당 0.5GB(배치 1 · 짧은 문맥)로 잡았습니다.",
]


def _round_up(value: float, digits: int = 1) -> float:
    scale = 10**digits
    return math.ceil(round(value * scale, 6)) / scale


def estimate_vram(
    model_params_b: float,
    precision: Precision = Precision.fp16,
    workload: Workload = Workload.inference,
) -> VramEstimateOut:
    if model_params_b <= 0:
        raise ValueError("모델 파라미터 수는 0보다 커야 합니다")
    bytes_per_param = BYTES_PER_PARAM[precision]
    weights = model_params_b * bytes_per_param
    extra = model_params_b * LORA_EXTRA_GB_PER_B if workload == Workload.lora else 0.0
    required = _round_up(weights * OVERHEAD_FACTOR + extra)
    formula = (
        f"{model_params_b:g}B × {bytes_per_param:g}바이트 = {weights:g}GB × {OVERHEAD_FACTOR:g}"
    )
    if extra:
        formula += f" + LoRA {extra:g}GB"
    formula += f" ≈ {required:g}GB"
    return VramEstimateOut(
        model_params_b=model_params_b,
        precision=precision,
        workload=workload,
        bytes_per_param=bytes_per_param,
        weights_gb=round(weights, 3),
        overhead_factor=OVERHEAD_FACTOR,
        training_extra_gb=round(extra, 3),
        required_vram_gb=required,
        formula=formula,
        assumptions=list(ASSUMPTIONS),
    )


def required_ram_gb(estimate: VramEstimateOut) -> int:
    for size in STANDARD_RAM_SIZES_GB:
        if size >= max(MIN_SYSTEM_RAM_GB, estimate.required_vram_gb):
            return size
    return STANDARD_RAM_SIZES_GB[-1]


def required_storage_gb(estimate: VramEstimateOut) -> int:
    original_fp16 = estimate.model_params_b * BYTES_PER_PARAM[Precision.fp16]
    return math.ceil(round(original_fp16 * 2 + STORAGE_BASE_GB, 6))


def describe(estimate: VramEstimateOut) -> str:
    """'7B · 4비트 · 추론' 처럼 사람이 읽을 이름."""
    return (
        f"{estimate.model_params_b:g}B · {PRECISION_LABELS[estimate.precision]}"
        f" · {WORKLOAD_LABELS[estimate.workload]}"
    )
