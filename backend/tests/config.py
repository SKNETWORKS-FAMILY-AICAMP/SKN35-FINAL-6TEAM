"""모든 테스트 단계가 공유하는 대상 프로젝트와 Python 실행기."""

import os
import sys
from pathlib import Path

PROJECT_PATH = Path(__file__).resolve().parents[2]
PROJECT_PYTHON = Path(os.environ.get("BUILDWISE_TEST_PYTHON", sys.executable)).resolve()
