# Opulent MCP Gateway

MCP server built on the [official MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk). Provides webhook validation (CloudTalk, Notion), lead ingestion, and N8N workflow triggers. Builds to GHCR via GitHub Actions and can deploy to Azure Container Instances or AWS ECS.

## Quick start (local)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[test]
cp .env.example .env         # fill in real secrets

# Run with stdio transport (for Claude Desktop / Claude Code)
mcp run gateway/server.py

# Run with Streamable HTTP transport (for remote access on port 8000)
python -m gateway.server

# Development inspector
mcp dev gateway/server.py

# Check env completeness (non-zero exit if required keys missing)
python -m gateway.healthcheck
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `health_ping` | Ping the gateway to verify it is running |
| `health_env` | Report missing required/optional environment variables |
| `lead_ingest` | Validate and ingest a lead, returns OHID and ingest ID |
| `cloudtalk_webhook_validator` | Validate CloudTalk webhook HMAC-SHA256 signature |
| `notion_webhook_validator` | Validate Notion webhook HMAC-SHA256 signature |
| `n8n_workflow_trigger` | POST a JSON payload to the configured N8N webhook URL |

## Environment variables

Set in `.env` (see `.env.example`):

**Required:**
- `MCP_AUTH_TOKEN` — Bearer token for MCP authentication
- `CLOUDTALK_WEBHOOK_SECRET` — HMAC secret for CloudTalk webhooks
- `NOTION_WEBHOOK_SECRET` — HMAC secret for Notion webhooks
- `N8N_WEBHOOK_URL` — URL to POST workflow payloads to

**Optional (PostgreSQL, when using database persistence):**
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
- `REPOSITORY_IMPL` — set to `postgres` to use PostgreSQL

## Docker

```bash
docker build -t mcp-gateway:local .
docker run -p 8000:8000 --env-file .env mcp-gateway:local
```

## GitHub Actions / GHCR

- Workflow: `.github/workflows/build-and-push.yml`
- Image: `ghcr.io/chris1-commits/mcp-database-opulent:latest`

## Terraform (choose one)

### Azure (ACI)
```bash
cd infra
terraform init && terraform apply \
  -var resource_group_name=... \
  -var location=australiaeast \
  -var container_name=mcp-gateway \
  -var image=ghcr.io/chris1-commits/mcp-database-opulent:latest \
  -var cloudtalk_secret=... -var notion_secret=... -var n8n_url=... \
  -var mcp_auth_token=...
```

### AWS (ECS Fargate)
```bash
cd infra/aws
terraform init && terraform apply \
  -var region=ap-southeast-2 \
  -var container_image=ghcr.io/chris1-commits/mcp-database-opulent:latest \
  -var cluster_name=mcp-gateway
```

## Project structure

```
gateway/
├── server.py          # MCP server (FastMCP + 6 tool registrations)
├── models.py          # Pydantic domain models
├── repository.py      # Repository ABC + FakeRepo
├── healthcheck.py     # CLI env health check
├── services/
│   ├── health.py      # Environment health check
│   ├── webhooks.py    # CloudTalk + Notion HMAC validation
│   ├── leads.py       # Lead ingestion + OHID resolution
│   └── workflows.py   # N8N workflow trigger
└── tests/             # pytest test suite
```

## Notes

- `.env.example` lists required variables; keep real secrets out of version control.
- The server uses the official `mcp` Python SDK (v1.x) for full MCP protocol compliance.
- Compatible with Claude Desktop, Claude Code, Cursor, and any MCP client.
