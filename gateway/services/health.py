"""Environment health check service."""
from __future__ import annotations

import os
from typing import Any, Dict, List

REQUIRED_ENV_KEYS = [
    "CLOUDTALK_WEBHOOK_SECRET",
    "NOTION_WEBHOOK_SECRET",
    "N8N_WEBHOOK_URL",
    "MCP_AUTH_TOKEN",
]

OPTIONAL_ENV_KEYS = [
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
    "REPOSITORY_IMPL",
]


def _missing(keys: List[str]) -> List[str]:
    return [k for k in keys if not os.getenv(k)]


def env_health() -> Dict[str, Any]:
    missing_required = _missing(REQUIRED_ENV_KEYS)
    missing_optional = _missing(OPTIONAL_ENV_KEYS)
    status = "ok" if not missing_required else "degraded"
    return {
        "status": status,
        "missing_required": missing_required,
        "missing_optional": missing_optional,
    }
