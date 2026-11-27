"""Apply official fit specifications to the exact docyx identities reviewed for the shop."""

from app.domains.hardware.ingestion.common import DATA, json_text, read_json, read_specs

CASE_MOUNT_FIELDS = frozenset(
    {"board_sizes", "psu_sizes", "max_gpu_length_mm", "max_cpu_cooler_mm", "max_psu_length_mm"}
)


def load_fit_reviews():
    rows = read_json(DATA / "reviewed_fit_specs.json")
    reviews = {r["source_key"]: r for r in rows}
    if len(reviews) != len(rows):
        raise ValueError("중복된 조립 사양 원본 키입니다.")
    for row in rows:
        urls = [row["source_url"], *row.get("field_sources", {}).values()]
        if not all(url.startswith("https://") for url in urls):
            raise ValueError("제조사 HTTPS 출처가 필요합니다.")
        if set(row["specs"]).intersection(row.get("unverified", [])):
            raise ValueError("미확인 필드를 사양으로 적재할 수 없습니다.")
    return reviews


def fit_updates(specs, category, model, review, *, include_file_sources=False):
    origin = specs["_provenance"]
    if (
        origin.get("source") != "docyx"
        or origin.get("source_key") != review["source_key"]
        or origin.get("raw_name") != review["raw_name"]
        or category != review["category"]
        or ("match_model" in review and review["match_model"] != model)
    ):
        raise ValueError(f"{review['raw_name']}: 검토 제품의 식별자가 다릅니다.")
    updates = {}
    for field, value in review["specs"].items():
        if specs.get(field) is not None and specs[field] != value:
            raise ValueError(f"{review['raw_name']}: 기존 {field} 값과 제조사 자료가 다릅니다.")
        updates[field] = value
        file_source = review.get("file_sources_only") or (
            category == "case" and field in CASE_MOUNT_FIELDS
        )
        if include_file_sources or not file_source:
            updates[field + "_source_url"] = review.get("field_sources", {}).get(
                field, review["source_url"]
            )
    # Missing measurements stay absent, so consumers never compare a status string as a spec.
    status = dict(specs.get("fit_review_status", {}))
    for field in review["specs"]:
        status.pop(field, None)
    for field in review.get("unverified", ()):
        value = model if field == "model_number" else specs.get(field)
        if value is None:
            status[field] = "unverified"
        else:
            status.pop(field, None)
    if status or "fit_review_status" in specs:
        updates["fit_review_status"] = status
    return {k: v for k, v in updates.items() if specs.get(k) != v}


def refresh_fit_specs(connection, reviews, *, apply=False):
    diff = []
    with connection.cursor(dictionary=True) as cursor:
        for key, review in sorted(reviews.items()):
            cursor.execute(
                "SELECT part_id,category,model_number,specs FROM parts WHERE category=%s "
                "AND specs->>'$._provenance.source'='docyx' "
                "AND specs->>'$._provenance.source_key'=%s" + (" FOR UPDATE" if apply else ""),
                (review["category"], key),
            )
            hits = cursor.fetchall()
            if len(hits) != 1:
                raise ValueError(f"{key}: DB에서 정확히 한 제품을 식별해야 합니다.")
            row = hits[0]
            specs = read_specs(row["specs"])
            changes = fit_updates(specs, row["category"], row["model_number"], review)
            if changes:
                diff.append(
                    {
                        "part_id": row["part_id"],
                        "before": {k: specs.get(k) for k in changes},
                        "after": changes,
                    }
                )
                if apply:
                    cursor.execute(
                        "UPDATE parts SET specs=%s WHERE part_id=%s",
                        (json_text(specs | changes), row["part_id"]),
                    )
    return diff
