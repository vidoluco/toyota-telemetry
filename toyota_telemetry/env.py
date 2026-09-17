"""Read ``.env`` into the process environment.

Both the sync (which needs the Toyota credentials) and the store (which needs the
fuel price defaults) depend on it, and ``toyota serve`` touches neither, so the
parsing lives here and every entry point calls it. Existing environment variables
always win over the file.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_dotenv(root: Path = ROOT) -> None:
    env = root / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())
