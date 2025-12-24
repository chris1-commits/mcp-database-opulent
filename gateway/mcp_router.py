from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from . import mcp_server

router = APIRouter(prefix="/api/rpc", tags=["mcp"])


def _get_auth_header(authorization: str | None = Header(default=None)) -> str | None:
    return authorization


@router.get("/health")
async def rpc_health():
    return {"status": "healthy", "endpoint": "/api/rpc"}


@router.post("")
async def rpc_handler(request: Request, authorization: str | None = Depends(_get_auth_header)):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    response = await mcp_server.handle_request(payload, authorization)
    if "error" in response and response["error"].get("code") == -32600:
        raise HTTPException(status_code=401, detail=response["error"]["message"])
    return response
