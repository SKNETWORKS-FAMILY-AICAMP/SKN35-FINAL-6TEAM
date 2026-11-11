"""계약 파일 생성 — contracts/openapi.json · contracts/events.schema.json

    uv run python -m app.export_contracts

app/contracts/schemas.py 나 API 경로를 바꾼 뒤에 실행하고, 프론트 타입도 다시 만듭니다(npm run gen:api).
보통은 scripts/gen-contracts 하나로 둘 다 합니다. DB 연결은 필요 없습니다.
"""

import json
from pathlib import Path
from typing import Any

from app.contracts.schemas import AgentEventOut
from app.core.config import REPO_ROOT
from app.main import create_app

CONTRACTS_DIR = REPO_ROOT / "contracts"


def _write(path: Path, data: dict[str, Any]) -> None:
    text = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    print(f"[contracts] {path.relative_to(REPO_ROOT).as_posix()} 생성")


def main() -> None:
    app = create_app()
    _write(CONTRACTS_DIR / "openapi.json", app.openapi())
    _write(CONTRACTS_DIR / "events.schema.json", AgentEventOut.model_json_schema())


if __name__ == "__main__":
    main()
