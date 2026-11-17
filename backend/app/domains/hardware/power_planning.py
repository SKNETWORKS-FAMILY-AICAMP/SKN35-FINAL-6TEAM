"""Wattage inputs and allowances for sizing a power supply."""

from decimal import Decimal
from math import ceil

SEASONIC_GUIDE = "https://seasonic.com/insights/psu-calculator-using-guide-2025/"
INTEL_PLATFORM_GUIDE = (
    "https://cdrdv2-public.intel.com/621484/621484_ATX12V_ATX12VO_PSU_DG_Addendum_Rev007.pdf"
)
ESTIMATE_FIELD = "_power_estimate"
PERIPHERAL_CATEGORIES = frozenset({"motherboard", "ram", "storage", "case", "cooler"})


def rated_watts(value):
    if not isinstance(value, (int, float, Decimal)) or isinstance(value, bool):
        return None
    watts = Decimal(str(value))
    if (
        watts.is_finite()
        and 0 < watts <= Decimal("999999.99")
        and watts == watts.quantize(Decimal("0.01"))
    ):
        return watts
    return None


def peripheral_estimate(category, specs):
    """Return a per-item PSU planning allowance and its reference."""
    if category == "motherboard":
        return 80, "motherboard_allowance", SEASONIC_GUIDE
    if category == "ram":
        modules = specs.get("modules_per_item")
        modules = modules if type(modules) is int and modules > 0 else 4
        return (
            10 * modules,
            "10_w_per_memory_module",
            (
                "https://www.jp.micron.com/content/dam/micron/global/public/documents/"
                "products/product-flyer/128gb-ddr5-rdimm-product-brief.pdf"
            ),
        )
    if category == "storage":
        if specs.get("type") == "SSD":
            return (
                25,
                "ssd_allowance",
                "https://www.solidigm.com/products/data-center/d7/ps1010.html",
            )
        return (
            45,
            "disk_startup_allowance",
            (
                "https://www.seagate.com/www-content/product-content/enterprise-hdd-fam/"
                "enterprise-capacity-3-5-hdd/constellation-es-4/en-us/docs/100726011f.pdf"
            ),
        )
    if category == "case":
        return 30, "case_fans_and_lighting_allowance", INTEL_PLATFORM_GUIDE
    if category == "cooler":
        return (
            35,
            "cooler_fans_pump_and_lighting_allowance",
            ("https://support.nzxt.com/hc/en-us/articles/47306825106459-Kraken-Elite-2024-Specs"),
        )
    raise ValueError(f"지원하지 않는 플랫폼 전력 분류: {category}")


def cpu_peak_estimate(base_w, specs):
    architecture = str(specs.get("microarchitecture", "")).casefold()
    socket = str(specs.get("socket", "")).upper().replace(" ", "")
    if architecture in {
        "alder lake",
        "raptor lake",
        "raptor lake refresh",
        "arrow lake",
    } or socket in {
        "LGA1700",
        "LGA1851",
    }:
        return ceil(base_w * Decimal("2.5"))
    return ceil(base_w * Decimal("1.5"))
