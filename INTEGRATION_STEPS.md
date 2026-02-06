## MCP Integration Steps

### 1. Install

```bash
pip install -e .[test]
```

### 2. Configure auth

Set `MCP_AUTH_TOKEN` in your `.env` file (32+ chars recommended).

### 3. Run locally

```bash
# stdio transport (for Claude Desktop / Claude Code)
mcp run gateway/server.py

# Streamable HTTP transport (for remote access, port 8000)
python -m gateway.server

# Development inspector (browser-based tool testing)
mcp dev gateway/server.py
```

### 4. Test tools

```bash
# Run the test suite
pytest gateway/tests/ -v

# Check environment health
python -m gateway.healthcheck
```

### 5. Deploy

Rebuild/push your GHCR image, then redeploy via Terraform (Azure ACI or AWS ECS). Ensure all required env vars are provided:
- `MCP_AUTH_TOKEN`
- `CLOUDTALK_WEBHOOK_SECRET`
- `NOTION_WEBHOOK_SECRET`
- `N8N_WEBHOOK_URL`

### 6. Client configuration

#### Claude Desktop / Claude Code (stdio)
```json
{
  "mcpServers": {
    "opulent-gateway": {
      "command": "python",
      "args": ["-m", "gateway.server"],
      "env": {
        "MCP_AUTH_TOKEN": "your-token-here"
      }
    }
  }
}
```

#### Remote HTTP client
Connect to `http://your-host:8000/mcp` using any MCP client that supports Streamable HTTP transport.

### Available MCP tools

| Tool | Description |
|------|-------------|
| `health_ping` | Ping → `{"status": "pong"}` |
| `health_env` | Report missing env vars |
| `lead_ingest` | Validate and ingest a lead (source_system, source_lead_id, channel, first_name, last_name, email?, phone?) |
| `cloudtalk_webhook_validator` | Validate HMAC-SHA256 signature (body, signature) |
| `notion_webhook_validator` | Validate HMAC-SHA256 signature (body, signature) |
| `n8n_workflow_trigger` | POST payload to N8N_WEBHOOK_URL |

### Required environment

- `MCP_AUTH_TOKEN` — Bearer token for authentication
- `CLOUDTALK_WEBHOOK_SECRET` — HMAC secret for CloudTalk webhooks
- `NOTION_WEBHOOK_SECRET` — HMAC secret for Notion webhooks
- `N8N_WEBHOOK_URL` — N8N webhook endpoint URL
- Optional: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `REPOSITORY_IMPL`
