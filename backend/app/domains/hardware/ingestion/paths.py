"""Repository paths, independent of the command's working directory."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
DATA = REPO_ROOT / "data" / "hardware"
