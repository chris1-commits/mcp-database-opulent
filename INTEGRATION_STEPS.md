## MCP Integration Steps (FastAPI gateway)

1) Copy files
- Ensure `gateway/mcp_server.py` and `gateway/mcp_router.py` exist under `gateway/`.

2) Wire router
- In `gateway/main.py`, `create_app()` already imports and mounts `mcp_router` when FastAPI is available. Nothing further required after this patch.

3) Configure auth
- Set `MCP_AUTH_TOKEN` (32+ chars recommended). All `/api/rpc` calls require `Authorization: Bearer <token>`.

4) Run locally
```bash
python -m pip install -e .[test]
uvicorn gateway.main:create_app --host 0.0.0.0 --port 8000
curl http://localhost:8000/health/ping
curl http://localhost:8000/api/rpc/health
curl -X POST http://localhost:8000/api/rpc -H "Authorization: Bearer $MCP_AUTH_TOKEN" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"ping","id":1}'
```

5) Deploy
- Rebuild/push your GHCR image after the new files are present.
- Redeploy via your existing Terraform (Azure ACI or AWS ECS). Ensure `MCP_AUTH_TOKEN` is provided as an environment variable.

6) Codex config (example)
```toml
[mcp_servers.opulent_horizons_gateway]
type = "http"
url = "https://your-host/api/rpc"
timeout = 30
retry_count = 3

[mcp_servers.opulent_horizons_gateway.headers]
Authorization = "Bearer YOUR_MCP_AUTH_TOKEN"
Content-Type = "application/json"
```

## Available MCP methods
- `ping` -> `{"status": "pong"}`
- `tools/list` -> returns 6 tools
- `tools/call` with `name` in:
  - `health_ping`
  - `health_env`
  - `lead_ingest` (in-memory simulated ingest)
  - `twilio_webhook_validator`
  - `whatsapp_webhook_validator`
  - `notion_webhook_validator`
  - `n8n_workflow_trigger`

## Required environment
- Existing: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `TWILIO_AUTH_TOKEN`, `WHATSAPP_APP_SECRET`, `NOTION_WEBHOOK_SECRET`, `N8N_WEBHOOK_URL`, `REPOSITORY_IMPL`
- New: `MCP_AUTH_TOKEN`
- Optional: `ELEVENLABS_*`, `OPENAI_API_KEY`
