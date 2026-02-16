from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import uuid
from typing import Any, Dict, List
import httpx

from .main import (
    Consent,
    LeadIngestRequest,
    Person,
    TwilioWebhookPayload,
    _FakeRepo,
    env_health,
    resolve_ohid,
)


class MCPError(Exception):
    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def _require_auth(auth_header: str | None) -> None:
    token = os.getenv("MCP_AUTH_TOKEN", "")
    if not token:
        raise MCPError(-32001, "MCP_AUTH_TOKEN is not set")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise MCPError(-32600, "Missing bearer token")
    supplied = auth_header.split(" ", 1)[1]
    if supplied != token:
        raise MCPError(-32600, "Invalid bearer token")


def list_tools() -> List[Dict[str, Any]]:
    return [
        {
            "name": "health_ping",
            "description": "Ping the MCP gateway",
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "health_env",
            "description": "Report missing env keys",
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "lead_ingest",
            "description": "Validate and simulate lead ingest (in-memory)",
            "input_schema": {
                "type": "object",
                "properties": {
                    "source_system": {"type": "string"},
                    "source_lead_id": {"type": "string"},
                    "channel": {"type": "string"},
                    "first_name": {"type": "string"},
                    "last_name": {"type": "string"},
                    "email": {"type": "string"},
                    "phone": {"type": "string"},
                },
                "required": ["source_system", "source_lead_id", "channel", "first_name", "last_name"],
            },
        },
        {
            "name": "twilio_webhook_validator",
            "description": "Validate a Twilio webhook signature against TWILIO_AUTH_TOKEN",
            "input_schema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Full request URL"},
                    "params": {"type": "object", "description": "POST form parameters as key-value pairs"},
                    "signature": {"type": "string", "description": "X-Twilio-Signature header value"},
                },
                "required": ["url", "params", "signature"],
            },
        },
        {
            "name": "whatsapp_webhook_validator",
            "description": "Validate a WhatsApp Cloud API webhook signature against WHATSAPP_APP_SECRET",
            "input_schema": {
                "type": "object",
                "properties": {
                    "body": {"type": "string", "description": "raw JSON body"},
                    "signature": {"type": "string", "description": "X-Hub-Signature-256 header value"},
                },
                "required": ["body", "signature"],
            },
        },
        {
            "name": "notion_webhook_validator",
            "description": "Validate a Notion webhook signature against NOTION_WEBHOOK_SECRET",
            "input_schema": {
                "type": "object",
                "properties": {
                    "body": {"type": "string", "description": "raw JSON body"},
                    "signature": {"type": "string", "description": "Notion-Signature header value"},
                },
                "required": ["body", "signature"],
            },
        },
        {
            "name": "n8n_workflow_trigger",
            "description": "POST payload to N8N_WEBHOOK_URL",
            "input_schema": {
                "type": "object",
                "properties": {
                    "payload": {"type": "object", "additionalProperties": True},
                },
                "required": ["payload"],
            },
        },
    ]


def handle_ping() -> Dict[str, str]:
    return {"status": "pong"}


def handle_env_health() -> Dict[str, Any]:
    return env_health()


async def handle_lead_ingest(args: Dict[str, Any]) -> Dict[str, Any]:
    payload = LeadIngestRequest(
        source_system=args["source_system"],
        source_lead_id=args["source_lead_id"],
        channel=args["channel"],
        person=Person(
            first_name=args["first_name"],
            last_name=args["last_name"],
            email=args.get("email"),
            phone=args.get("phone"),
        ),
        lead_details=None,
        consent=Consent(marketing=True),
        raw_payload={},
        timestamp=None,  # type: ignore[arg-type]
        meta={},
    )
    repo = _FakeRepo()
    ohid = await resolve_ohid(repo, payload)
    ingest_id = str(uuid.uuid4())
    await repo.insert_lead_context(ohid, ingest_id, payload)
    return {"ohid": ohid, "ingest_id": ingest_id}


def _verify_twilio_signature(url: str, params: Dict[str, str], signature: str) -> bool:
    """Validate a Twilio webhook signature (HMAC SHA1, base64-encoded)."""
    secret = os.getenv("TWILIO_AUTH_TOKEN", "")
    if not secret or not signature:
        return False
    data = url
    for key in sorted(params.keys()):
        data += key + params[key]
    mac = hmac.new(secret.encode("utf-8"), msg=data.encode("utf-8"), digestmod=hashlib.sha1)
    expected = base64.b64encode(mac.digest()).decode("utf-8")
    return hmac.compare_digest(expected, signature)


def _verify_whatsapp_signature(body: bytes, signature_header: str) -> bool:
    """Validate a WhatsApp Cloud API webhook signature (X-Hub-Signature-256)."""
    secret = os.getenv("WHATSAPP_APP_SECRET", "")
    if not secret or not signature_header:
        return False
    signature = signature_header
    if signature.startswith("sha256="):
        signature = signature.split("=", 1)[1]
    digest = hmac.new(secret.encode("utf-8"), msg=body, digestmod=hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, signature)


def _verify_notion_signature(body: bytes, signature_header: str) -> bool:
    secret = os.getenv("NOTION_WEBHOOK_SECRET", "")
    if not secret or not signature_header:
        return False
    signature = signature_header
    if signature.startswith("sha256="):
        signature = signature.split("=", 1)[1]
    digest = hmac.new(secret.encode("utf-8"), msg=body, digestmod=hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, signature)


def handle_twilio_validator(args: Dict[str, Any]) -> Dict[str, Any]:
    url = args["url"]
    params = args["params"]
    signature = args["signature"]
    ok = _verify_twilio_signature(url, params, signature)
    parsed: Dict[str, Any] = {}
    try:
        parsed = TwilioWebhookPayload(**params).model_dump()
    except Exception:
        parsed = {"parse": "failed"}
    return {"valid": ok, "parsed": parsed}


def handle_whatsapp_validator(args: Dict[str, Any]) -> Dict[str, Any]:
    body = args["body"].encode("utf-8")
    signature = args["signature"]
    ok = _verify_whatsapp_signature(body, signature)
    messages: list = []
    try:
        payload = json.loads(body)
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                messages.extend(change.get("value", {}).get("messages", []))
    except Exception:
        pass
    return {"valid": ok, "messages": messages}


def handle_notion_validator(args: Dict[str, Any]) -> Dict[str, Any]:
    body = args["body"].encode("utf-8")
    signature = args["signature"]
    ok = _verify_notion_signature(body, signature)
    return {"valid": ok}


async def handle_n8n_trigger(args: Dict[str, Any]) -> Dict[str, Any]:
    url = os.getenv("N8N_WEBHOOK_URL")
    if not url:
        raise MCPError(-32002, "N8N_WEBHOOK_URL is not set")
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, json=args["payload"])
        return {"status_code": resp.status_code, "body": resp.text}


async def call_tool(name: str, args: Dict[str, Any]) -> Any:
    if name == "health_ping":
        return handle_ping()
    if name == "health_env":
        return handle_env_health()
    if name == "lead_ingest":
        return await handle_lead_ingest(args)
    if name == "twilio_webhook_validator":
        return handle_twilio_validator(args)
    if name == "whatsapp_webhook_validator":
        return handle_whatsapp_validator(args)
    if name == "notion_webhook_validator":
        return handle_notion_validator(args)
    if name == "n8n_workflow_trigger":
        return await handle_n8n_trigger(args)
    raise MCPError(-32601, f"Unknown tool: {name}")


async def handle_request(payload: Dict[str, Any], auth_header: str | None) -> Dict[str, Any]:
    try:
        _require_auth(auth_header)
        if payload.get("jsonrpc") != "2.0":
            raise MCPError(-32600, "Invalid JSON-RPC version")
        method = payload.get("method")
        req_id = payload.get("id")
        if method == "ping":
            result = handle_ping()
        elif method == "tools/list":
            result = {"tools": list_tools()}
        elif method == "tools/call":
            params = payload.get("params") or {}
            tool = params.get("name")
            args = params.get("arguments") or {}
            if not tool:
                raise MCPError(-32602, "Tool name required")
            result = await call_tool(tool, args)
        else:
            raise MCPError(-32601, f"Unknown method: {method}")
        return {"jsonrpc": "2.0", "result": result, "id": req_id}
    except MCPError as e:
        return {"jsonrpc": "2.0", "error": {"code": e.code, "message": e.message}, "id": payload.get("id")}
    except Exception as e:
        return {"jsonrpc": "2.0", "error": {"code": -32000, "message": str(e)}, "id": payload.get("id")}
