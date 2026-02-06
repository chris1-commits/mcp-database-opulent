"""Opulent MCP Gateway — built on the official MCP Python SDK."""
from __future__ import annotations

from typing import Optional

from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from .services import health, leads, webhooks, workflows

mcp = FastMCP(
    "opulent-mcp-gateway",
    instructions="MCP gateway with webhook validation, lead ingestion, and workflow triggers",
    host="0.0.0.0",
    port=8000,
)


# ── Health route for load balancers (not an MCP tool) ────────────────────────


@mcp.custom_route("/health", methods=["GET"])
async def health_endpoint(request: Request) -> JSONResponse:
    return JSONResponse({"status": "healthy", "service": "mcp-gateway"})


# ── MCP Tools ────────────────────────────────────────────────────────────────


@mcp.tool()
def health_ping() -> dict:
    """Ping the MCP gateway to verify it is running."""
    return {"status": "pong"}


@mcp.tool()
def health_env() -> dict:
    """Report missing required and optional environment variables."""
    return health.env_health()


@mcp.tool()
async def lead_ingest(
    source_system: str,
    source_lead_id: str,
    channel: str,
    first_name: str,
    last_name: str,
    email: Optional[str] = None,
    phone: Optional[str] = None,
) -> dict:
    """Validate and ingest a lead. Returns the resolved OHID and ingest ID.

    source_system must be one of: META, WEB, CLOUDTALK, ZOHO_SOCIAL, ZOHO_CRM.
    channel must be one of: WEB_FORM, META_LEAD_AD, INBOUND_CALL, OUTBOUND_CALL, SOCIAL, CRM.
    """
    return await leads.ingest_lead(
        {
            "source_system": source_system,
            "source_lead_id": source_lead_id,
            "channel": channel,
            "first_name": first_name,
            "last_name": last_name,
            "email": email,
            "phone": phone,
        }
    )


@mcp.tool()
def cloudtalk_webhook_validator(body: str, signature: str) -> dict:
    """Validate a CloudTalk webhook HMAC-SHA256 signature and parse the payload."""
    return webhooks.validate_cloudtalk(body, signature)


@mcp.tool()
def notion_webhook_validator(body: str, signature: str) -> dict:
    """Validate a Notion webhook HMAC-SHA256 signature."""
    return webhooks.validate_notion(body, signature)


@mcp.tool()
async def n8n_workflow_trigger(payload: dict) -> dict:
    """POST a JSON payload to the configured N8N webhook URL."""
    return await workflows.trigger_n8n(payload)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
