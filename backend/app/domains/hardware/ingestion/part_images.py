"""Match Doshiba's PCPartPicker image URLs to the existing parts catalog."""

import hashlib
import json
import re
from collections import defaultdict
from collections.abc import Iterable, Iterator
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

from app.domains.hardware.ingestion.common import DATA, read_json
from app.domains.hardware.ingestion.docyx import FILES, REVISION, name_key

IMAGE_DATASET_REVISION = "4d83d726b37b8c7342ce07c72f73eacc71ddf37a"
IMAGE_DATASET_SHA256 = "5e7c8a602951e085a298dc9fc0df72fce3bd190299e16bf7c13ea951d9d1d509"
IMAGE_DATASET_URL = (
    "https://huggingface.co/datasets/Doshiba/pcpartpicker-parts-dataset/resolve/"
    f"{IMAGE_DATASET_REVISION}/pcpartpicker_parts.jsonl"
)
IMAGE_PLACEHOLDER_URL = "https://fr.pcpartpicker.com/static/forever/img/no-image.png"
VARIANT_FIELDS = {
    "cpu": (
        ("cores", "Core Count", ""),
        ("base_ghz", "Performance Core Clock", "GHz"),
        ("boost_ghz", "Performance Core Boost Clock", "GHz"),
        ("microarchitecture", "Microarchitecture", None),
        ("graphics", "Integrated Graphics", None),
    ),
    "motherboard": (
        ("socket", "Socket / CPU", None),
        ("form_factor", "Form Factor", None),
        ("memory_slots", "Memory Slots", ""),
        ("ram_max_gb", "Memory Max", "GB"),
        ("color", "Color", None),
    ),
    "gpu": (
        ("chipset", "Chipset", None),
        ("vram_gb", "Memory", "GB"),
        ("core_clock_mhz", "Core Clock", "MHz"),
        ("boost_clock_mhz", "Boost Clock", "MHz"),
        ("length_mm", "Length", "mm"),
        ("color", "Color", None),
    ),
    "storage": (
        ("capacity_gb", "Capacity", "GB|TB|MB"),
        ("type", "Type", None),
        ("form_factor", "Form Factor", None),
        ("interface", "Interface", None),
        ("cache_mb", "Cache", "MB"),
    ),
    "ram": (
        ("cas_latency", "CAS Latency", ""),
        ("first_word_latency", "First Word Latency", "ns"),
        ("color", "Color", None),
    ),
    "case": (
        ("type", "Type", None),
        ("color", "Color", None),
        ("side_panel", "Side Panel", None),
        ("internal_35_bays", 'Internal 3.5" Bays', ""),
        ("external_volume_l", "External Volume", "L"),
        ("included_psu_w", "Power Supply", "W"),
    ),
    "cooler": (
        ("color", "Color", None),
        ("radiator_size_mm", "Radiator Size", "mm"),
        ("rpm", "Fan RPM", "RPM"),
        ("noise_level_db", "Noise Level", "dB"),
    ),
    "psu": (
        ("wattage_w", "Wattage", "W"),
        ("form_factor", "Type", None),
        ("efficiency", "Efficiency Rating", None),
        ("modular", "Modular", None),
        ("color", "Color", None),
    ),
}
REQUIRED_VARIANT_FIELDS = {"gpu": 2, "storage": 4, "cpu": 2, "cooler": 1, "ram": 0}


def read_image_rows(path: Path | None) -> Iterator[dict]:
    """Read a caller-provided JSONL or verify and read the pinned download."""
    if path is None:
        with urlopen(IMAGE_DATASET_URL, timeout=30) as response:
            content = response.read(32 * 1024 * 1024 + 1)
        if hashlib.sha256(content).hexdigest() != IMAGE_DATASET_SHA256:
            raise ValueError("pcpartpicker_parts.jsonl: 고정 리비전의 SHA-256이 다릅니다.")
        lines = BytesIO(content)
    else:
        lines = path.open("rb")
    with lines:
        for line_number, line in enumerate(lines, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"이미지 JSONL {line_number}행은 JSON 객체여야 합니다.")
            yield row


def _product_id(row):
    for field in ("product_tag", "source_id"):
        value = row.get(field)
        if isinstance(value, str) and value.strip():
            return field, value.strip()
    return None


def _known_brand(value):
    if isinstance(value, str):
        key = name_key(value)
        if key == "fsp group":
            return "fsp"
        if key and key != "unknown":
            return key
    return None


def _image_url(value):
    if not isinstance(value, str) or any(ord(char) <= 32 or char == "\\" for char in value):
        return None
    try:
        url = urlsplit(value)
    except ValueError:
        return None
    if (
        url.scheme == "https"
        and url.hostname
        and url.username is None
        and url.path.strip("/")
        and not url.path.casefold().endswith("/no-image.png")
    ):
        return value
    return None


def load_reviewed_images():
    manifest = read_json(DATA / "reviewed_part_images.json")
    if manifest["catalog_revision"] != REVISION:
        raise ValueError("이미지 검토 데이터의 카탈로그 리비전이 현재 원본과 다릅니다.")
    photos = {}
    for review in manifest["records"]:
        key = review["source_key"]
        photo = _image_url(review["image_url"])
        if key in photos or not photo or not _image_url(review["source_url"]):
            raise ValueError(f"{key}: 이미지 검토 데이터의 식별자 또는 URL이 잘못됐습니다.")
        photos[key] = (review["category"], photo)
    return photos


def _variant_value(value, unit, *, dataset):
    if value is None or value == "":
        return None
    if unit is None and isinstance(value, str):
        return name_key(value) or None
    if unit is not None and dataset and isinstance(value, str):
        match = re.fullmatch(rf"([0-9]+(?:\.[0-9]+)?)\s*({unit})", value.strip())
        if match:
            number, actual_unit = match.groups()
            scale = {"TB": 1000, "MB": Decimal("0.001")}.get(actual_unit, 1)
            return Decimal(number) * scale if unit == "GB|TB|MB" else Decimal(number)
    if unit is not None and not dataset and type(value) in (int, float):
        number = Decimal(str(value))
        if number.is_finite() and number >= 0:
            return number
    raise ValueError("Unrecognized variant specification")


def _normalized_variant_field(category, field, value, unit, *, dataset):
    if category == "storage" and field == "form_factor":
        if type(value) in (int, float):
            value = str(value)
        if isinstance(value, str):
            value = value.removesuffix('"')
    if category == "storage" and field == "type":
        if type(value) is int:
            value = str(value)
        if isinstance(value, str):
            value = value.removesuffix(" RPM")
    if category == "psu" and field == "efficiency" and dataset and isinstance(value, str):
        value = "plus" if value == "80+" else value.removeprefix("80+ ")
    if category == "psu" and field == "modular" and value is False:
        value = "No"
    if value == "None" and (category, field) in {
        ("cpu", "graphics"),
        ("case", "side_panel"),
        ("case", "included_psu_w"),
    }:
        value = None
    if category == "cooler" and field in {"rpm", "noise_level_db"}:
        if dataset and isinstance(value, str) and " - " in value:
            start, end = value.split(" - ", 1)
            value = [f"{start} {unit}", end]
        if isinstance(value, list) and len(value) == 2:
            return tuple(_variant_value(bound, unit, dataset=dataset) for bound in value)
    return _variant_value(value, unit, dataset=dataset)


def _ram_configuration(specs, *, dataset):
    if dataset:
        speed, modules = specs.get("Speed"), specs.get("Modules")
        if isinstance(speed, str) and isinstance(modules, str):
            speed_match = re.fullmatch(r"(DDR[0-9]+)-([0-9]+)", speed.strip())
            modules_match = re.fullmatch(r"([0-9]+)\s*x\s*([0-9]+)\s*GB", modules.strip())
            if speed_match and modules_match:
                return (
                    speed_match[1],
                    int(speed_match[2]),
                    int(modules_match[1]),
                    int(modules_match[2]),
                )
        return None
    generation = specs.get("ram_type")
    fields = ("speed_mtps", "modules_per_item", "module_capacity_gb")
    configuration = tuple(_variant_value(specs.get(field), "", dataset=False) for field in fields)
    if (
        isinstance(generation, str)
        and re.fullmatch(r"DDR[0-9]+", generation)
        and all(configuration)
    ):
        return generation, *configuration
    return None


def _variant_key(category, specs, *, dataset):
    fields = VARIANT_FIELDS.get(category)
    if fields is None or not isinstance(specs, dict):
        return None
    try:
        values = tuple(
            _normalized_variant_field(
                category, field, specs.get(label if dataset else field), unit, dataset=dataset
            )
            for field, label, unit in fields
        )
        if category == "ram":
            configuration = _ram_configuration(specs, dataset=dataset)
            return (*configuration, *values) if configuration else None
        if all(value is not None for value in values[: REQUIRED_VARIANT_FIELDS.get(category, 2)]):
            return values
    except ValueError:
        return None
    return None


def _part_key(part):
    return part["category"], part["brand"], part["name"]


def resolve_image_url(existing, matched, *, fill_missing=True):
    if not fill_missing:
        return existing
    if existing and existing != IMAGE_PLACEHOLDER_URL:
        return existing
    return matched or IMAGE_PLACEHOLDER_URL


def _select_image(part, candidates):
    ids = {product_id for product_id, _, _, _ in candidates}
    if len(ids) != 1 or None in ids:
        return None
    urls = {url for _, _, url, _ in candidates if url}
    brands = {brand for _, brand, _, _ in candidates if brand}
    brand = _known_brand(part["brand"])
    if len(urls) == 1 and len(brands) <= 1 and (not brand or not brands or brand in brands):
        return ids.pop(), urls.pop()
    return None


def _select_variant_image(category, part, candidates):
    if image := _select_image(part, candidates):
        return image
    brand = _known_brand(part["brand"])
    brands = {item[1] for item in candidates if item[1]}
    if len(brands) != 1 or (brand and brand not in brands):
        return None
    photos = sorted((url, product_id) for product_id, _, url, _ in candidates if url and product_id)
    if not photos:
        return None
    # Multiple listings can share the same photo. Identical CPU models can also
    # have different packaging photos without changing the physical processor.
    if category == "cpu" or (
        len(photos) == len(candidates) and len({url for url, _ in photos}) == 1
    ):
        url, product_id = photos[0]
        return product_id, url
    return None


def _variant_matches(category, parts, candidates):
    local_variants = defaultdict(list)
    source_variants = defaultdict(list)
    for part in parts:
        variant = _variant_key(category, part.get("specs"), dataset=False)
        if variant is not None:
            local_variants[variant].append(part)
    for candidate in candidates:
        if candidate[3] is not None:
            source_variants[candidate[3]].append(candidate)
    storage_parts_by_form = defaultdict(list)
    storage_images_by_form = defaultdict(list)
    if category == "storage":
        for variant, local in local_variants.items():
            storage_parts_by_form[variant[:-1]].extend(local)
        for variant, offers in source_variants.items():
            storage_images_by_form[variant[:-1]].extend(offers)
    for variant, local in local_variants.items():
        if len(local) != 1:
            continue
        offers = source_variants.get(variant, ())
        image = _select_variant_image(category, local[0], offers)
        if not image and category == "storage" and len(storage_parts_by_form[variant[:-1]]) == 1:
            compatible = [
                offer
                for offer in storage_images_by_form[variant[:-1]]
                if variant[-1] is None or offer[3][-1] is None or variant[-1] == offer[3][-1]
            ]
            image = _select_variant_image(category, local[0], compatible)
        if image:
            yield _part_key(local[0]), image


def match_images(
    parts: Iterable[dict], rows: Iterable[dict], *, reviewed_images=None
) -> dict[tuple[str, str, str], str]:
    """Match exact names, using shared variant specs when names are ambiguous."""
    catalog = defaultdict(list)
    reviewed_matches = {}
    reviewed_images = reviewed_images or {}
    for part in parts:
        provenance = part.get("specs", {}).get("_provenance", {})
        raw_name = provenance.get("raw_name") or part["name"]
        catalog[part["category"], name_key(raw_name)].append(part)
        review = reviewed_images.get(provenance.get("source_key"))
        if (
            review
            and review[0] == part["category"]
            and provenance.get("source") == "docyx"
            and provenance.get("revision") == REVISION
        ):
            reviewed_matches[_part_key(part)] = review[1]

    candidates = defaultdict(list)
    product_variants = defaultdict(set)
    for row in rows:
        slug = row.get("category")
        name = row.get("name")
        if (
            row.get("source", "pcpartpicker") != "pcpartpicker"
            or not isinstance(slug, str)
            or slug not in FILES
            or not isinstance(name, str)
        ):
            continue
        category = FILES[slug][0]
        key = category, name_key(name)
        product_id = _product_id(row)
        variant = _variant_key(category, row.get("specs"), dataset=True)
        if product_id is not None:
            product_variants[product_id].add((key, variant))
        if key in catalog:
            candidates[key].append(
                (
                    product_id,
                    _known_brand(row.get("brand")),
                    _image_url(row.get("image_url")),
                    variant,
                )
            )

    claims = defaultdict(list)
    for key, offers in candidates.items():
        local = catalog[key]
        if len(local) == 1 and len({offer[0] for offer in offers}) == 1:
            if image := _select_image(local[0], offers):
                product_id, url = image
                claims[product_id].append((_part_key(local[0]), url))
            continue
        for part_key, (product_id, url) in _variant_matches(key[0], local, offers):
            claims[product_id].append((part_key, url))
    dataset_matches = dict(
        matches[0]
        for product_id, matches in claims.items()
        if len(matches) == 1 and len(product_variants[product_id]) == 1
    )
    return {**reviewed_matches, **dataset_matches}
