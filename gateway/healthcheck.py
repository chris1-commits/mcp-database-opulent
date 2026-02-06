"""Lightweight env self-check for local/CI usage.

Usage:
  python -m gateway.healthcheck
"""

from __future__ import annotations

import sys
from typing import NoReturn

from .services.health import env_health


def main() -> NoReturn:
    status = env_health()
    missing_required = status.get("missing_required") or []
    missing_optional = status.get("missing_optional") or []

    print("Env health:", status.get("status"))
    if missing_required:
        print("Missing required keys:", ", ".join(missing_required))
    if missing_optional:
        print("Missing optional keys:", ", ".join(missing_optional))

    sys.exit(0 if status.get("status") == "ok" else 1)


if __name__ == "__main__":
    main()
