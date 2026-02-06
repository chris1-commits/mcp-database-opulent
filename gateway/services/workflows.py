"""N8N workflow trigger service."""
from __future__ import annotations

import os
from typing import Any, Dict

import httpx


async def trigger_n8n(payload: Dict[str, Any]) -> Dict[str, Any]:
    url = os.getenv("N8N_WEBHOOK_URL")
    if not url:
        raise ValueError("N8N_WEBHOOK_URL is not set")
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, json=payload)
        return {"status_code": resp.status_code, "body": resp.text}
