# Opulent MCP Gateway

FastAPI-based MCP gateway with CloudTalk and Notion webhooks. Builds to GHCR via GitHub Actions and can deploy to Azure Container Instances or AWS ECS.

## Quick start (local)
```bash
python -m venv .venv
.\.venv\Scripts\Activate.ps1   # on Windows
pip install -e .[test]
copy .env.example .env         # fill in real secrets
uvicorn gateway.main:create_app --host 0.0.0.0 --port 8000
```
Required env vars (set in `.env`):
- Postgres: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
- Webhooks: `CLOUDTALK_WEBHOOK_SECRET`, `NOTION_WEBHOOK_SECRET`, `N8N_WEBHOOK_URL`
- Optional (for ElevenLabs TTS): `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`
- Optional (for LLM features): `OPENAI_API_KEY`

## Docker
```bash
docker build -t mcp-gateway:local .
docker run -p 8000:8000 --env-file .env mcp-gateway:local
```

## GitHub Actions / GHCR
- Workflow: `.github/workflows/build-and-push.yml`
- Image: `ghcr.io/chris1-commits/mcp-database-opulent:${{ github.sha }}` and `:latest`

## Terraform (choose one)
### Azure (ACI)
```bash
cd infra
terraform init
terraform apply \
  -var resource_group_name=... \
  -var location=australiaeast \
  -var container_name=mcp-gateway \
  -var image=ghcr.io/chris1-commits/mcp-database-opulent:latest \
  -var pg_host=... -var pg_user=... -var pg_password=... -var pg_database=... \
  -var cloudtalk_secret=... -var notion_secret=... -var n8n_url=... \
  -var elevenlabs_api_key=... -var elevenlabs_voice_id=... -var elevenlabs_model_id=...
```

### AWS (ECS Fargate)
```bash
cd infra/aws
terraform init
terraform apply \
  -var region=ap-southeast-2 \
  -var container_image=ghcr.io/chris1-commits/mcp-database-opulent:latest \
  -var cluster_name=mcp-gateway \
  -var environment=\"{PGHOST=...,PGUSER=...,PGPASSWORD=...,PGDATABASE=...,CLOUDTALK_WEBHOOK_SECRET=...,NOTION_WEBHOOK_SECRET=...,N8N_WEBHOOK_URL=...,ELEVENLABS_API_KEY=...,ELEVENLABS_VOICE_ID=...,ELEVENLABS_MODEL_ID=...}\"
```

## Notes
- `.env.example` lists required variables; keep real secrets out of version control.
- The main app code currently lives in `gateway/main.py` (single-file canvas). Split into packages (`api/`, `services/`, `persistence/`, etc.) as you harden the service.
