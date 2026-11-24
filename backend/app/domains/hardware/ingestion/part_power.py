"""Resolve catalog power from legacy CPU TDP and exact manufacturer evidence."""

from decimal import Decimal
from math import ceil

from app.domains.hardware.ingestion.common import DATA, read_json
from app.domains.hardware.ingestion.docyx import REVISION
from app.domains.hardware.power_planning import (
    ESTIMATE_FIELD,
    PERIPHERAL_CATEGORIES,
    peripheral_estimate,
    rated_watts,
)


def load_power_reviews():
    manifest = read_json(DATA / "reviewed_power_specs.json")
    if manifest["catalog_revision"] != REVISION:
        raise ValueError("전력 검토 데이터의 카탈로그 리비전이 현재 적재 원본과 다릅니다.")
    reviews = {}
    for review in manifest["records"]:
        key = review["source_key"]
        field = "cpu_power_limit_w" if review["category"] == "cpu" else "power_draw_w"
        if key in reviews or rated_watts(review.get(field)) is None:
            raise ValueError(f"{key}: 전력 검토 데이터의 식별자 또는 와트 값이 잘못됐습니다.")
        reviews[key] = review
    return reviews


def load_gpu_estimates(reviews):
    estimates = read_json(DATA / "gpu_power_references.json")
    for chipset, reference in estimates.items():
        if rated_watts(reference["power_draw_w"]) is None or not reference["source_url"].startswith(
            "https://"
        ):
            raise ValueError(f"{chipset}: GPU 전력 추정 기준을 확인하세요.")
    for review in reviews.values():
        if review["category"] != "gpu" or not (chipset := review["match_specs"].get("chipset")):
            continue
        if review["power_draw_w"] > estimates.get(chipset, {}).get("power_draw_w", 0):
            estimates[chipset] = {
                "power_draw_w": review["power_draw_w"],
                "source_url": review["source_url"],
                "metric": "highest_reviewed_board_for_chipset",
            }
    model_estimates = read_json(DATA / "reviewed_gpu_estimates.json")
    if model_estimates["catalog_revision"] != REVISION:
        raise ValueError("GPU 모델별 전력 추정 데이터의 카탈로그 리비전이 현재 원본과 다릅니다.")
    for record in model_estimates["records"]:
        key = record["source_key"]
        if (
            key in estimates
            or record["category"] != "gpu"
            or rated_watts(record["power_draw_w"]) is None
            or not record["source_url"].startswith("https://")
            or not record["match_specs"].get("chipset")
            or not record["evidence"]
        ):
            raise ValueError(f"{key}: GPU 모델별 전력 추정 근거가 잘못됐습니다.")
        estimates[key] = record
    return estimates


def matching_power_review(part, reviews):
    specs = part["specs"]
    provenance = specs.get("_provenance", {})
    review = reviews.get(provenance.get("source_key"))
    if (
        review
        and provenance.get("source") == "docyx"
        and provenance.get("revision") == REVISION
        and provenance.get("raw_name") == review["raw_name"]
        and part["category"] == review["category"]
        and part["brand"] == review["catalog_brand"]
        and part["model_number"] == review["catalog_model_number"]
        and all(specs.get(key) == value for key, value in review["match_specs"].items())
    ):
        return review
    return None


def resolve_part_power(part, reviews):
    """Return the persisted specs and watts without mutating the source identity."""
    specs = part["specs"]
    estimated = ESTIMATE_FIELD in specs
    power = None if estimated else rated_watts(part.get("power_draw_w"))
    review = matching_power_review(part, reviews)
    if part["category"] == "cpu":
        if "tdp_w" in specs:
            specs = specs.copy()
            power = rated_watts(specs.pop("tdp_w"))
            if power is None:
                raise ValueError(f"{part['name']}: CPU TDP를 와트 값으로 옮길 수 없습니다.")
        if review and rated_watts(specs.get("cpu_power_limit_w")) is None:
            specs = {**specs, "cpu_power_limit_w": review["cpu_power_limit_w"]}
    elif power is None:
        if part["category"] == "gpu":
            power = rated_watts(specs.get("gpu_power_w"))
        if power is None and review:
            power = rated_watts(review["power_draw_w"])
    if estimated and power is not None:
        specs = {key: value for key, value in specs.items() if key != ESTIMATE_FIELD}
    return specs, power


def resolve_catalog_power(part, reviews, gpu_estimates):
    """Prefer documented values; label every inferred load stored in the catalog."""
    specs, power = resolve_part_power(part, reviews)
    if power is not None or gpu_estimates is None:
        return specs, power
    category = part["category"]
    if specs.get("cooling_type") == "case_fan":
        return specs, rated_watts(specs.get("fan_w"))
    if category == "gpu":
        chipset = specs.get("chipset")
        reference = gpu_estimates.get(chipset)
        if model_estimate := matching_power_review(part, gpu_estimates):
            power = model_estimate["power_draw_w"]
            source_url = model_estimate["source_url"]
            basis = model_estimate["basis"]
            detail = {
                field: model_estimate[field]
                for field in ("manufacturer_model", "evidence", "supporting_urls")
                if field in model_estimate
            }
            detail["chipset"] = chipset
        elif reference:
            reference_w = reference["power_draw_w"]
            power = ceil(Decimal(str(reference_w)) * Decimal("1.10") / 5) * 5
            detail = {"chipset": chipset, "reference_w": reference_w, "margin_percent": 10}
            basis = "gpu_chipset_and_reviewed_board_allowance"
            source_url = reference["source_url"]
        else:
            raise ValueError(f"{part['name']}: 모델 또는 칩셋의 GPU 전력 근거가 필요합니다.")
    elif category in PERIPHERAL_CATEGORIES:
        power, basis, source_url = peripheral_estimate(category, specs)
        detail = {}
    else:
        return specs, power
    return {
        **specs,
        ESTIMATE_FIELD: {
            "status": "unconfirmed",
            "basis": basis,
            "source_url": source_url,
            **detail,
        },
    }, rated_watts(power)
