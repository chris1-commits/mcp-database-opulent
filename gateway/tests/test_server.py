"""Tests for MCP server tool registration and basic invocation."""
import pytest

from gateway.server import mcp


async def test_server_lists_six_tools():
    """The MCP server registers exactly 6 tools."""
    tools = await mcp.list_tools()
    tool_names = {t.name for t in tools}
    assert tool_names == {
        "health_ping",
        "health_env",
        "lead_ingest",
        "cloudtalk_webhook_validator",
        "notion_webhook_validator",
        "n8n_workflow_trigger",
    }


async def test_health_ping_tool():
    """Calling the health_ping tool returns pong."""
    result = await mcp.call_tool("health_ping", {})
    assert len(result) > 0
    assert "pong" in str(result[0])


async def test_health_env_tool():
    """Calling the health_env tool returns status info."""
    result = await mcp.call_tool("health_env", {})
    assert len(result) > 0
    text = str(result[0])
    assert "status" in text


async def test_lead_ingest_tool():
    """Calling lead_ingest via MCP tool returns ohid and ingest_id."""
    result = await mcp.call_tool(
        "lead_ingest",
        {
            "source_system": "WEB",
            "source_lead_id": "test-1",
            "channel": "WEB_FORM",
            "first_name": "Test",
            "last_name": "User",
        },
    )
    assert len(result) > 0
    text = str(result[0])
    assert "ohid" in text
    assert "ingest_id" in text
