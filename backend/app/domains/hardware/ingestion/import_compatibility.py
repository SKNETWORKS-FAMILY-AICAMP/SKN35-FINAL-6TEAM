"""Import reviewed official evidence. Does not infer support from missing rows."""

from app.domains.hardware.ingestion.common import (
    json_text,
    read_specs,
    sql_time,
)


def validate_records(records, matches):
    products = {part["source_key"]: part for part in matches}
    if len(products) != len(matches):
        raise ValueError("검토한 부품의 source_key가 중복됐습니다.")
    keys = set()
    cpu_pairs = set()
    for record in records:
        key = record["record_key"]
        if key in keys:
            raise ValueError("중복 호환성 근거 키: " + key)
        keys.add(key)
        a, b = products.get(record["part_a_key"]), products.get(record["part_b_key"])
        if not a or not b or a["category"] != "motherboard":
            raise ValueError(key + ": 기준 메인보드 또는 상대 부품이 없습니다.")
        kind = record["check_type"]
        if kind not in ("CPU_SUPPORT", "MEMORY_QVL", "KNOWN_CONFLICT"):
            raise ValueError(key + ": 알 수 없는 검사 유형입니다.")
        if kind == "CPU_SUPPORT":
            if b["category"] != "cpu":
                raise ValueError(key + ": CPU가 아닙니다.")
            pair = (record["part_a_key"], record["part_b_key"])
            if pair in cpu_pairs:
                raise ValueError(key + ": 같은 메인보드와 CPU의 지원 근거가 중복됐습니다.")
            cpu_pairs.add(pair)
        if record["support_status"] not in ("SUPPORTED", "CONDITIONAL", "UNSUPPORTED"):
            raise ValueError(key + ": 지원 상태를 확인하세요.")
        scope, minimum = record["bios_scope"], record.get("min_bios_version")
        if scope not in ("ALL", "MIN_VERSION", "NOT_SPECIFIED") or (
            (scope == "MIN_VERSION") != bool(minimum)
        ):
            raise ValueError(key + ": 최소 BIOS 조건이 일관되지 않습니다.")
        if not record.get("source_url", "").startswith("https://") or not record.get(
            "source_publisher"
        ):
            raise ValueError(key + ": 공식 출처가 필요합니다.")
        if kind == "MEMORY_QVL":
            if (
                b["category"] != "ram"
                or not b["model_number"]
                or record["conditions"].get("ram_model_number") != b["model_number"]
            ):
                raise ValueError(key + ": RAM의 정확한 품번이 일치하지 않습니다.")
            if not record["conditions"].get("cpu_family"):
                raise ValueError(key + ": QVL의 CPU 계열이 필요합니다.")
            if scope != "NOT_SPECIFIED" or minimum:
                raise ValueError(key + ": 현재 QVL 원본은 최소 BIOS를 명시하지 않습니다.")
    return records


def upsert_compatibility(connection, records, checked_at):
    counts = {"inserted": 0, "updated": 0, "withheld": []}
    with connection.cursor(dictionary=True) as cursor:
        cursor.execute("SELECT part_id,model_number,specs FROM parts")
        products = {}
        for row in cursor.fetchall():
            key = read_specs(row["specs"]).get("_provenance", {}).get("source_key")
            if key:
                if key in products:
                    raise ValueError("DB 부품 원본 키가 중복됐습니다: " + key)
                products[key] = row
        for record in records:
            a, b = products.get(record["part_a_key"]), products.get(record["part_b_key"])
            if not a or not b:
                counts["withheld"].append(
                    {"record_key": record["record_key"], "reason": "PART_NOT_IMPORTED"}
                )
                continue
            if (
                record["check_type"] == "MEMORY_QVL"
                and b["model_number"] != record["conditions"]["ram_model_number"]
            ):
                raise ValueError("DB RAM 품번과 QVL 품번이 다릅니다: " + record["record_key"])
            conditions = {
                **record["conditions"],
                "_record_key": record["record_key"],
                "evidence_checked_on": record["evidence_checked_on"],
                "evidence_kind": record.get("evidence_kind", "manually_reviewed_transcription"),
                "source_date_precision": "day" if record.get("source_updated_on") else None,
            }
            cursor.execute(
                "SELECT compatibility_id,conditions FROM part_compatibility WHERE part_a_id=%s AND part_b_id=%s AND check_type=%s FOR UPDATE",
                (a["part_id"], b["part_id"], record["check_type"]),
            )
            existing = [
                r
                for r in cursor.fetchall()
                if read_specs(r["conditions"]).get("_record_key") == record["record_key"]
            ]
            if len(existing) > 1:
                raise ValueError("DB 호환성 근거가 중복됐습니다: " + record["record_key"])
            source_date = record.get("source_updated_on")
            values = (
                record["support_status"],
                record["bios_scope"],
                record.get("min_bios_version"),
                json_text(conditions),
                record["source_publisher"],
                record["source_url"],
                source_date + " 00:00:00" if source_date else None,
                sql_time(checked_at),
            )
            if existing:
                cursor.execute(
                    "UPDATE part_compatibility SET support_status=%s,bios_scope=%s,min_bios_version=%s,conditions=%s,source_publisher=%s,source_url=%s,source_updated_at=%s,verified_at=%s WHERE compatibility_id=%s",
                    (*values, existing[0]["compatibility_id"]),
                )
                counts["updated"] += 1
            else:
                cursor.execute(
                    "INSERT INTO part_compatibility (part_a_id,part_b_id,check_type,support_status,bios_scope,min_bios_version,conditions,source_publisher,source_url,source_updated_at,verified_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (a["part_id"], b["part_id"], record["check_type"], *values),
                )
                counts["inserted"] += 1
    return counts
