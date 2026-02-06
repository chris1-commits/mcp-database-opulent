"""Webhook HMAC-SHA256 validation for CloudTalk and Notion."""
from __future__ import annotations

import hashlib
import hmac
import os
from typing import Any, Dict

from ..models import CloudtalkWebhookPayload


def verify_cloudtalk_signature(body: bytes, signature: str) -> bool:
    secret = os.getenv("CLOUDTALK_WEBHOOK_SECRET", "")
    if not secret:
        return False
    expected = hmac.new(
        secret.encode("utf-8"), msg=body, digestmod=hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def verify_notion_signature(body: bytes, signature_header: str) -> bool:
    secret = os.getenv("NOTION_WEBHOOK_SECRET", "")
    if not secret or not signature_header:
        return False
    sig = signature_header
    if sig.startswith("sha256="):
        sig = sig.split("=", 1)[1]
    digest = hmac.new(
        secret.encode("utf-8"), msg=body, digestmod=hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(digest, sig)


def validate_cloudtalk(body_str: str, signature: str) -> Dict[str, Any]:
    body = body_str.encode("utf-8")
    valid = verify_cloudtalk_signature(body, signature)
    parsed: Dict[str, Any]
    try:
        parsed = CloudtalkWebhookPayload.model_validate_json(body).model_dump()
    except Exception:
        parsed = {"parse": "failed"}
    return {"valid": valid, "parsed": parsed}


def validate_notion(body_str: str, signature: str) -> Dict[str, Any]:
    body = body_str.encode("utf-8")
    valid = verify_notion_signature(body, signature)
    return {"valid": valid}
