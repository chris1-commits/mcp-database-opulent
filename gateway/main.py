"""
Simple MCP Gateway - FastAPI with Bearer token auth
Handles: health checks, ping, tools list, and basic routing
"""

from typing import Any, Dict, Literal, Optional
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel


class RPCRequest(BaseModel):
    jsonrpc: Literal["2.0"]
    method: str
    params: Optional[Dict[str, Any]] = None
    id: Optional[str | int] = None


async def require_bearer_token(authorization: str = Header(...)) -> str:
    """Verify Bearer token from Authorization header."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Bearer token")
    
    token = authorization.replace("Bearer ", "")
    expected_token = "9a61434eeb286110e05d83e51f0693b6df2429d365092fdac5e61d2e33b98b4c"
    
    if token != expected_token:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    return token


def create_app():
    """Factory function to create FastAPI app (required by Dockerfile)."""
    
    app = FastAPI(title="MCP Gateway", version="0.1.0")
    
    @app.get("/health/ping")
    async def health_ping():
        """Health check endpoint."""
        return {"status": "healthy", "service": "mcp-gateway"}
    
    @app.post("/api/rpc")
    async def rpc_endpoint(
        request: RPCRequest,
        _: str = Depends(require_bearer_token),
    ):
        """Main RPC endpoint - handles ping, tools/list, and tool execution."""
        
        if request.method == "ping":
            return {
                "jsonrpc": "2.0",
                "id": request.id,
                "result": {"status": "pong"},
            }
        
        elif request.method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": request.id,
                "result": [
                    {"name": "health_ping", "description": "Health check"},
                    {"name": "health_env", "description": "Environment check"},
                    {"name": "lead_ingest", "description": "Ingest leads"},
                    {"name": "cloudtalk_webhook_validator", "description": "CloudTalk validator"},
                    {"name": "notion_webhook_validator", "description": "Notion validator"},
                    {"name": "n8n_workflow_trigger", "description": "Trigger workflows"},
                ],
            }
        
        elif request.method == "health_ping":
            return {
                "jsonrpc": "2.0",
                "id": request.id,
                "result": {"status": "healthy"},
            }
        
        else:
            raise HTTPException(status_code=404, detail=f"Method '{request.method}' not found")
    
    return app
