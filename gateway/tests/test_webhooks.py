"""Tests for webhook HMAC-SHA256 validation."""
import hashlib
import hmac
import json

from gateway.services.webhooks import (
    validate_cloudtalk,
    validate_notion,
    verify_cloudtalk_signature,
    verify_notion_signature,
)


CLOUDTALK_SECRET = "test-cloudtalk-secret"
NOTION_SECRET = "test-notion-secret"


def _make_hmac(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), msg=body, digestmod=hashlib.sha256).hexdigest()


# ── CloudTalk ────────────────────────────────────────────────────────────────


def test_cloudtalk_valid_signature(monkeypatch):
    monkeypatch.setenv("CLOUDTALK_WEBHOOK_SECRET", CLOUDTALK_SECRET)
    body = b'{"event_type":"call.started","call_id":"123"}'
    sig = _make_hmac(CLOUDTALK_SECRET, body)
    assert verify_cloudtalk_signature(body, sig) is True


def test_cloudtalk_invalid_signature(monkeypatch):
    monkeypatch.setenv("CLOUDTALK_WEBHOOK_SECRET", CLOUDTALK_SECRET)
    body = b'{"event_type":"call.started"}'
    assert verify_cloudtalk_signature(body, "bad-signature") is False


def test_cloudtalk_missing_secret():
    """Returns False when CLOUDTALK_WEBHOOK_SECRET is not set."""
    assert verify_cloudtalk_signature(b"body", "sig") is False


def test_validate_cloudtalk_parses_payload(monkeypatch):
    monkeypatch.setenv("CLOUDTALK_WEBHOOK_SECRET", CLOUDTALK_SECRET)
    payload = {
        "event_type": "call.started",
        "call_id": "c-123",
        "direction": "inbound",
        "from": "+61400000000",
        "to": "+61400000001",
    }
    body_str = json.dumps(payload)
    sig = _make_hmac(CLOUDTALK_SECRET, body_str.encode("utf-8"))
    result = validate_cloudtalk(body_str, sig)
    assert result["valid"] is True
    assert result["parsed"]["event_type"] == "call.started"
    assert result["parsed"]["call_id"] == "c-123"


def test_validate_cloudtalk_parse_failure(monkeypatch):
    monkeypatch.setenv("CLOUDTALK_WEBHOOK_SECRET", CLOUDTALK_SECRET)
    body_str = "not-valid-json"
    sig = _make_hmac(CLOUDTALK_SECRET, body_str.encode("utf-8"))
    result = validate_cloudtalk(body_str, sig)
    assert result["parsed"] == {"parse": "failed"}


# ── Notion ───────────────────────────────────────────────────────────────────


def test_notion_valid_signature(monkeypatch):
    monkeypatch.setenv("NOTION_WEBHOOK_SECRET", NOTION_SECRET)
    body = b'{"type":"page.created"}'
    sig = _make_hmac(NOTION_SECRET, body)
    assert verify_notion_signature(body, sig) is True


def test_notion_valid_signature_with_prefix(monkeypatch):
    """Notion may send signatures prefixed with 'sha256='."""
    monkeypatch.setenv("NOTION_WEBHOOK_SECRET", NOTION_SECRET)
    body = b'{"type":"page.created"}'
    sig = "sha256=" + _make_hmac(NOTION_SECRET, body)
    assert verify_notion_signature(body, sig) is True


def test_notion_invalid_signature(monkeypatch):
    monkeypatch.setenv("NOTION_WEBHOOK_SECRET", NOTION_SECRET)
    assert verify_notion_signature(b"body", "wrong") is False


def test_notion_missing_secret():
    assert verify_notion_signature(b"body", "sig") is False


def test_notion_empty_signature(monkeypatch):
    monkeypatch.setenv("NOTION_WEBHOOK_SECRET", NOTION_SECRET)
    assert verify_notion_signature(b"body", "") is False


def test_validate_notion(monkeypatch):
    monkeypatch.setenv("NOTION_WEBHOOK_SECRET", NOTION_SECRET)
    body_str = '{"type":"page.created"}'
    sig = _make_hmac(NOTION_SECRET, body_str.encode("utf-8"))
    result = validate_notion(body_str, sig)
    assert result["valid"] is True
