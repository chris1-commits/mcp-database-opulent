"""Tests for health check service."""
import os

from gateway.services.health import env_health


def test_env_health_all_missing():
    """With no env vars set, status is degraded and all required keys are missing."""
    result = env_health()
    assert result["status"] == "degraded"
    assert "MCP_AUTH_TOKEN" in result["missing_required"]
    assert "CLOUDTALK_WEBHOOK_SECRET" in result["missing_required"]
    assert "NOTION_WEBHOOK_SECRET" in result["missing_required"]
    assert "N8N_WEBHOOK_URL" in result["missing_required"]


def test_env_health_ok_when_required_set(monkeypatch):
    """When all required env vars are set, status is ok."""
    monkeypatch.setenv("MCP_AUTH_TOKEN", "test-token")
    monkeypatch.setenv("CLOUDTALK_WEBHOOK_SECRET", "secret")
    monkeypatch.setenv("NOTION_WEBHOOK_SECRET", "secret")
    monkeypatch.setenv("N8N_WEBHOOK_URL", "http://example.com")
    result = env_health()
    assert result["status"] == "ok"
    assert result["missing_required"] == []


def test_env_health_optional_reported(monkeypatch):
    """Optional keys are reported as missing but don't affect status."""
    monkeypatch.setenv("MCP_AUTH_TOKEN", "t")
    monkeypatch.setenv("CLOUDTALK_WEBHOOK_SECRET", "s")
    monkeypatch.setenv("NOTION_WEBHOOK_SECRET", "s")
    monkeypatch.setenv("N8N_WEBHOOK_URL", "http://x")
    result = env_health()
    assert result["status"] == "ok"
    assert "PGHOST" in result["missing_optional"]
