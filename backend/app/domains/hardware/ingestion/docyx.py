"""Read the pinned PCPartPicker snapshot published by docyx."""

import hashlib
import json
import unicodedata
from collections import Counter
from decimal import ROUND_HALF_UP, Decimal
from urllib.request import urlopen

from app.domains.hardware.ingestion.common import json_text, price_value

REVISION = "06ffc8eec068db5e8145e012ad2ec11e56a7c969"
RAW = "https://raw.githubusercontent.com/docyx/pc-part-dataset"
FILES = {
    "cpu": ("cpu", "1e3fd9ba6bf11fca4217675d67ed5edd0d60cc6cb2604418c443cf474fe58c1c"),
    "motherboard": (
        "motherboard",
        "7bf4ecb66756c40234ccc1f6e2e43ca477dea7ef3f6e5c92d9b432d5776c6a1b",
    ),
    "memory": ("ram", "2c70f628bebd31bb47ef5b46b39de52c41a417b17dfcc0c63991b2d27310de63"),
    "video-card": ("gpu", "bb0d199e880d02d512f312132d68dbe70b4bf7079bbc18b850b1f40513874575"),
    "internal-hard-drive": (
        "storage",
        "0634f9c8157d649cf4e6a67ffcaa69ae22695f7a0befb1c60fdfffe921845d3b",
    ),
    "power-supply": ("psu", "e9fee8572ae99f9dad5cee37d5f4bdb32e80d92e3f2783912d6e55ff62ecf261"),
    "case": ("case", "a925fb93039d5db492bc35ba08bde445b4d855dbd3d2c9ce9cae4f2fe35e68ac"),
    "cpu-cooler": ("cooler", "c06fa7387cf1accff1ed6889cfe6e9bcec358d3a6eac014448877dd2aa680798"),
    "case-fan": ("cooler", "502c52c06c13e048d503f66f0471a629ec37bf37c679cb468c7b76e4b8841f41"),
}
BRANDS = (
    "Cooler Master",
    "Western Digital",
    "G.Skill",
    "be quiet!",
    "Lian Li",
    "Phanteks",
    "Thermalright",
    "Thermaltake",
    "Silverstone",
    "Fractal Design",
    "Arctic",
    "AMD",
    "Intel",
    "MSI",
    "ASUS",
    "ASRock",
    "Gigabyte",
    "NVIDIA",
    "Sapphire",
    "PowerColor",
    "XFX",
    "PNY",
    "Zotac",
    "EVGA",
    "Corsair",
    "Kingston",
    "Crucial",
    "Samsung",
    "Seagate",
    "TeamGroup",
    "Patriot",
    "ADATA",
    "Lexar",
    "Sabrent",
    "SK Hynix",
    "NZXT",
    "Montech",
    "Noctua",
    "Deepcool",
    "Super Flower",
    "FSP",
    "Seasonic",
    "Antec",
    "HYTE",
)
SPEC_KEYS = {
    "cpu": {
        "core_count": "cores",
        "core_clock": "base_ghz",
        "boost_clock": "boost_ghz",
        "tdp": "tdp_w",
    },
    "motherboard": {"max_memory": "ram_max_gb"},
    "gpu": {
        "memory": "vram_gb",
        "length": "length_mm",
        "core_clock": "core_clock_mhz",
        "boost_clock": "boost_clock_mhz",
    },
    "storage": {"capacity": "capacity_gb", "cache": "cache_mb"},
    "psu": {"wattage": "wattage_w", "type": "form_factor"},
    "case": {"psu": "included_psu_w", "external_volume": "external_volume_l"},
    "cooler": {"size": "radiator_size_mm", "noise_level": "noise_level_db"},
}


def read_snapshot(source_dir):
    """Read local copies or download the same revision. Verify the bytes either way."""
    snapshot = {}
    for slug, (_, checksum) in FILES.items():
        filename = f"{slug}.json"
        if source_dir is None:
            with urlopen(f"{RAW}/{REVISION}/data/json/{filename}", timeout=30) as response:
                content = response.read(4 * 1024 * 1024 + 1)
        else:
            content = (source_dir / filename).read_bytes()
        if hashlib.sha256(content).hexdigest() != checksum:
            raise ValueError(f"{filename}: docyx 고정 리비전의 파일과 SHA-256이 다릅니다.")
        snapshot[slug] = json.loads(content)
    return snapshot


def name_key(name):
    """Group case/accent variants consistently with the MySQL catalog collation."""
    return "".join(
        char
        for char in unicodedata.normalize("NFKD", " ".join(name.split()).casefold())
        if not unicodedata.combining(char)
    )


def specs_for(category, raw):
    fields = SPEC_KEYS.get(category, {})
    specs = {
        fields.get(key, key): value
        for key, value in raw.items()
        if key not in ("name", "price", "price_per_gb") and value is not None
    }
    if category == "ram":
        if isinstance(speed := specs.pop("speed", None), list) and len(speed) == 2:
            ddr, rate = speed
            if ddr is not None:
                specs["ram_type"] = f"DDR{ddr}"
            if rate is not None:
                specs["speed_mtps"] = rate
        if isinstance(modules := specs.pop("modules", None), list) and len(modules) == 2:
            count, size = modules
            if isinstance(count, int) and isinstance(size, (int, float)):
                specs.update(
                    modules_per_item=count, module_capacity_gb=size, capacity_gb=count * size
                )
    return specs


def prepare_parts(
    snapshot, reviewed_parts, rate, rate_date, rate_url, checked_at, *, excluded_keys=()
):
    """Keep priced rows, merge identical variants, and apply exact manufacturer reviews."""
    if not rate.is_finite() or not Decimal("0.01") <= rate <= Decimal("100000"):
        raise ValueError("환율은 양수인 원/USD 값이어야 합니다.")
    excluded_keys = frozenset(excluded_keys)
    parts, counts = {}, {}
    for slug, rows in snapshot.items():
        category, _ = FILES[slug]
        stats = counts.setdefault(category, Counter())
        stats["source_rows"] += len(rows)
        for raw in rows:
            usd = price_value(raw.get("price"))
            if usd is None:
                stats["skipped_price"] += 1
                continue
            won = (usd * rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            if not Decimal("1") <= won <= Decimal("9999999999999"):
                stats["skipped_price"] += 1
                continue
            name = " ".join(raw["name"].split())
            if not name:
                stats["skipped_name"] += 1
                continue
            specs = specs_for(category, raw)
            if slug == "case-fan":
                specs["cooling_type"] = "case_fan"
                specs["fan_size_mm"] = specs.pop("radiator_size_mm", None)
            brand = next(
                (b for b in BRANDS if name.casefold().startswith(b.casefold() + " ")), "Unknown"
            )
            identity = hashlib.sha256(
                json_text([category, name_key(name), specs]).encode()
            ).hexdigest()
            key = f"docyx:{identity}"
            if key in parts:
                stats["duplicates"] += 1
                if usd >= Decimal(parts[key]["specs"]["_provenance"]["price_usd"]):
                    continue
            specs["_provenance"] = {
                "source_key": key,
                "source": "docyx",
                "revision": REVISION,
                "raw_name": name,
                "data_status": "unverified",
                "price_status": "test",
                "price_basis": "USD_FX_REFERENCE",
                "price_usd": str(usd),
                "krw_per_usd": str(rate),
                "fx_date": rate_date.isoformat(),
                "fx_source_url": rate_url,
            }
            parts[key] = {
                "category": category,
                "brand": brand,
                "name": name,
                "model_number": None,
                "specs": specs,
                "current_price": won,
                "price_checked_at": checked_at,
            }

    names = Counter((p["category"], name_key(p["name"])) for p in parts.values())
    for key in excluded_keys:
        if removed := parts.pop(key, None):
            counts[removed["category"]]["skipped_excluded"] += 1
    for key, part in parts.items():
        if names[part["category"], name_key(part["name"])] > 1 or len(part["name"]) > 255:
            part["name"] = f"{part['name'][:239]} [{key[6:18]}]"
        counts[part["category"]]["ready"] += 1

    by_name = {}
    for part in parts.values():
        raw_name = part["specs"]["_provenance"]["raw_name"]
        by_name.setdefault((part["category"], name_key(raw_name)), []).append(part)
    unmatched = []
    for review in reviewed_parts:
        matches = by_name.get((review["category"], name_key(review["raw_name"])), [])
        matches = [
            part
            for part in matches
            if all(
                part["specs"].get(key) == value
                for key, value in review.get("match_specs", {}).items()
            )
        ]
        if len(matches) != 1:
            unmatched.append(review["source_key"])
            continue
        part = matches[0]
        provenance = part["specs"]["_provenance"]
        if "reviewed_specs_url" in provenance:
            raise ValueError(f"{review['source_key']}: 하나의 docyx 행에 검토 키가 중복됩니다.")
        provenance.update(
            source_key=review["source_key"],
            reviewed_specs_url=review["source_url"],
            reviewed_fields=sorted(review["specs"]),
        )
        part["model_number"] = review["model_number"]
        part["specs"].update(review["specs"])
    return list(parts.values()), counts, unmatched
