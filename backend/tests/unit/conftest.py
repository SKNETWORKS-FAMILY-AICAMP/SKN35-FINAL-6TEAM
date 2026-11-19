"""지정된 프로젝트에서 백엔드 앱을 불러오기 위한 공통 설정."""

from __future__ import annotations

import os
import sys
from pathlib import Path

project_path = os.environ.get("TEST_PROJECT_PATH")
PROJECT_ROOT = (
    Path(project_path).resolve()
    if project_path
    else Path(__file__).resolve().parents[3]
)
BACKEND_ROOT = PROJECT_ROOT / "backend"
if not BACKEND_ROOT.is_dir():
    raise RuntimeError(f"백엔드 경로를 찾을 수 없습니다: {BACKEND_ROOT}")

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
