"""Fetch the gateway OpenAPI spec to verify reachability.

Usage:
  python -m gateway.openapi_check  # defaults to http://localhost:8000/openapi.json
  GATEWAY_URL=https://your-host python -m gateway.openapi_check
"""

from __future__ import annotations

import os
import sys

import httpx


def main() -> None:
    base = os.getenv("GATEWAY_URL", "http://localhost:8000")
    url = base.rstrip("/") + "/openapi.json"
    try:
        resp = httpx.get(url, timeout=10.0)
        resp.raise_for_status()
    except Exception as exc:  # pragma: no cover - simple runtime check
        print(f"OpenAPI fetch failed for {url}: {exc}")
        sys.exit(1)

    print(f"OpenAPI fetch ok: {url} (status {resp.status_code})")
    sys.exit(0)


if __name__ == "__main__":
    main()
