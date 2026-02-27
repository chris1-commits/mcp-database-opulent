# PROJECT_CONTEXT.md — Opulent Horizons Multi-Repo Context

> **Purpose:** Single source of truth for all Claude interfaces (Chat, VS Code, CLI).
> Copy-paste or attach this file to any new conversation to give Claude full project context.
>
> **Last updated:** 2026-02-27
> **Branch:** `claude/voltagen-setup-eFz0J`
> **Primary repo:** `chris1-commits/mcp-database-opulent`

---

## 1. Multi-Repository Landscape

Opulent Horizons spans three GitHub repositories. Understanding their relationship is critical:

| Repository | Status | Purpose |
|-----------|--------|---------|
| **MCP-Gateway-Claude-Desktop** | **PRODUCTION (LIVE)** | Canonical MCP SDK gateway — 2 focused servers, Phase 1–4 features, Azure Container Apps |
| **mcp-database-opulent** | Active (VoltAgent) / Legacy (gateway) | FastAPI MCP prototype (`gateway/`) + VoltAgent TypeScript orchestrator (`voltagent/`) + Terraform IaC |
| **opulenthorizons-mcp** | Empty scaffold | README placeholder + Jekyll workflow only — no code |

### Relationship & Migration Path

```
mcp-database-opulent/gateway/        ──(migrated to)──▶  MCP-Gateway-Claude-Desktop/
  (FastAPI, hand-rolled JSON-RPC)                          (Anthropic MCP SDK, @mcp.tool() decorators)
  7 tools, single port 8000                                 8 tools, 2 servers (8001, 8002)
  SQLAlchemy + asyncpg                                      Direct asyncpg (no ORM)
  NOT deployed                                              LIVE on Azure Container Apps (australiaeast)

mcp-database-opulent/voltagent/      ──(calls)──▶  mcp-database-opulent/gateway/ (JSON-RPC 2.0)
  VoltAgent v2 TypeScript orchestrator
  4-agent supervisor architecture
  Webhook listener, retry queue, metrics
```

**Key decisions (from MCP-Gateway-Claude-Desktop/MIGRATION.md):**
- MCP-Gateway-Claude-Desktop is the **canonical production system**
- `mcp-database-opulent/gateway/` is the **deprecated prototype** (reference only)
- Identical domain models (Person, LeadDetails, Consent) and OHID resolution logic in both
- MCP SDK eliminated ~80 lines of JSON-RPC boilerplate and ~200 lines of SQLAlchemy overhead

---

## 2. Business Domain

**Opulent Horizons** = luxury property business (Dubai-based, operates in UK & AU).

**Core mission:** AI-powered lead qualification via voice → CRM → human follow-up.
**Goals:** 75% staff cost reduction (AI voice qualification), 35% lead conversion uplift.

**Lead Lifecycle:**
```
Lead Sources (Meta Ads, Web Forms, Inbound Calls, n8n, Zoho)
    ↓
Lead Ingest → OHID Resolution → Zoho CRM Upsert
    ↓
ElevenLabs Archer v7 (AI Voice Qualification)
    ↓
Dynamic Variables (OHID, lead_status, qualification_score)
    ↓
Post-Call Transcript → Zoho CRM Update
    ↓
Outcome Router → WhatsApp Sequences / Outbound Calls / Calendar Booking
```

**Telephony:** Archer v7 on `+447414132722` and `+447414135641` (ElevenLabs-managed).

---

## 3. MCP-Gateway-Claude-Desktop (Production)

### 3.1 Architecture

Two standalone MCP servers using the **official Anthropic MCP SDK** (`mcp>=1.26.0`):

```
┌─────────────────────────────────────────────────────┐
│        Lead Ingest Server (port 8001)                │
│                                                       │
│  MCP Tools:                                          │
│    ingest_lead          (META/WEB/TWILIO/ZOHO)       │
│    process_twilio_event (call events)                │
│    process_notion_event (webhook + challenge)        │
│    lookup_ohid          (email/phone lookup)         │
│    verify_webhook_signature (HMAC verification)      │
│                                                       │
│  Resource: status://pipeline                         │
│                                                       │
│  Webhook Endpoints (HTTP transport only):            │
│    /webhooks/elevenlabs/conversation-initiation      │
│    /webhooks/elevenlabs/post-call                    │
│    /webhooks/agent-tools/lead-capture                │
│    /webhooks/meta/leadgen                            │
│    /webhooks/twilio/events                           │
│    /webhooks/web-form                                │
│    /health                                           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼ PostgreSQL 16
┌─────────────────────────────────────────────────────┐
│        Zoho CRM Sync Server (port 8002)              │
│                                                       │
│  MCP Tools:                                          │
│    sync_lead       (bidirectional Zoho ↔ Property DB)│
│    get_zoho_lead   (fetch by ID)                     │
│    upsert_zoho_lead (create/update)                  │
│                                                       │
│  Resource: status://zoho-sync                        │
└─────────────────────────────────────────────────────┘
```

**Transport options:** stdio (default), SSE, Streamable HTTP.
**Tool registration:** `@mcp.tool()` decorators with auto JSON schema from type hints.
**Database:** Direct asyncpg (no SQLAlchemy). Connection pooling via `asyncpg.create_pool()`.

### 3.2 Directory Structure

```
MCP-Gateway-Claude-Desktop/
├── servers/
│   ├── lead_ingest.py           # Lead ingest MCP server (810 lines)
│   └── zoho_crm_sync.py        # Zoho CRM sync MCP server (380 lines)
├── shared/
│   ├── models.py                # Pydantic domain models
│   ├── repository.py            # Repository abstraction (Postgres + in-memory)
│   ├── schema.sql               # PostgreSQL DDL (lead_context, workflow_event, agent_pool, etc.)
│   ├── auth.py                  # ASGI Bearer token middleware
│   ├── middleware.py            # Correlation ID, structured JSON logging
│   └── zoho_auth.py             # Zoho OAuth2 token manager with auto-refresh
├── src/                         # Phase 1–4 webhook handlers
│   ├── elevenlabs_webhooks.py   # Pre-call lead lookup, post-call transcript sync
│   ├── zoho_post_call_sync.py   # Post-call → Zoho CRM synchronization
│   ├── agent_pool.py            # Round-robin agent routing (timezone-aware)
│   ├── agent_tools.py           # ElevenLabs agent tool endpoints
│   ├── outbound_orchestrator.py # Outbound call orchestration (ElevenLabs API)
│   ├── outcome_router.py        # Post-call outcome determination + action routing
│   ├── whatsapp_sequences.py    # Template-based WhatsApp message sequencing
│   ├── meta_leadgen.py          # Meta Lead Ads webhook integration
│   └── web_form_webhook.py      # mlinvestments.online form handler
├── tests/                       # 15 test files, 180+ tests passing
├── docs/                        # 15 docs (architecture, endpoints, operations runbook, etc.)
├── infra/main.bicep             # Azure Container Apps IaC
├── scripts/                     # ElevenLabs agent + event stream setup
├── .github/workflows/deploy.yml # CI/CD: test → build → push ACR → deploy → smoke-test
├── Dockerfile                   # Multi-stage Python 3.12
├── docker-compose.yml           # Local dev: 2 servers + PostgreSQL 16
├── pyproject.toml               # mcp>=1.26.0, asyncpg>=0.30, pydantic>=2.0, httpx>=0.27
└── claude_desktop_config.json   # Pre-configured MCP registration for Claude Desktop
```

### 3.3 Phase 1–4 Features (unique to production)

These exist only in MCP-Gateway-Claude-Desktop, not in the legacy gateway:

1. **ElevenLabs Archer v7** — Pre-call lead lookup → dynamic variables, post-call transcript → Zoho CRM sync
2. **Agent Pool** — Timezone-aware round-robin routing from `agent_pool` PostgreSQL table
3. **Outbound Call Orchestrator** — ElevenLabs API (`POST /v1/convai/twilio/outbound-call`), kill switch, calling window
4. **WhatsApp Sequences** — Template-based timed messages stored in `whatsapp_sequence_queue` table
5. **Outcome Router** — Post-call decision logic (calendar booking, WhatsApp follow-up, human transfer)
6. **Meta Lead Ads** — X-Hub-Signature-256 verified webhook → ingest + Zoho CRM + outbound call
7. **Web Form** — mlinvestments.online form processing

### 3.4 Zoho CRM Integration

- **AU data centre:** `*.zohoapis.com.au` / `*.zoho.com.au` endpoints
- **OAuth2 auto-refresh:** `ZohoTokenManager` with 5-minute proactive refresh buffer, asyncio lock
- **Pre-call lookup:** Phone → Zoho CRM lead search
- **Post-call sync:** Transcript + qualification score → lead upsert

### 3.5 Production Deployment

- **Platform:** Azure Container Apps (australiaeast region)
- **CI/CD:** GitHub Actions → pytest → Docker → ACR → Container Apps → smoke test
- **IaC:** Bicep (Azure) in `infra/main.bicep`
- **State:** 2 servers, 8 tools, 180+ tests passing
- **Known gaps:** Azure PostgreSQL provisioning, outbound call API fix, n8n business logic migration, 19 exposed secrets need remediation

---

## 4. mcp-database-opulent (This Repo)

### 4.1 Repository Structure

```
mcp-database-opulent/
├── gateway/                        # Python FastAPI MCP Gateway (LEGACY — see Migration note)
│   ├── __init__.py                 # Package init (exports create_app)
│   ├── main.py                     # FastAPI app factory, domain models, repositories, routers, webhooks
│   ├── mcp_server.py               # JSON-RPC 2.0 handler — 7 tools, auth, tool dispatch
│   ├── mcp_router.py               # FastAPI router mounting /api/rpc endpoint
│   ├── healthcheck.py              # CLI health check utility
│   └── openapi_check.py            # OpenAPI endpoint reachability checker
│
├── voltagent/                      # VoltAgent v2 TypeScript AI Agent (ACTIVE)
│   ├── src/
│   │   ├── index.ts                # Main entry — 4 agents + webhook listener + retry queue + metrics
│   │   ├── tools.ts                # 7 Zod-typed tools wrapping gateway JSON-RPC calls
│   │   ├── guardrails.ts           # Input/output guardrails (length, injection, PII, schema)
│   │   ├── hooks.ts                # Observability hooks (lifecycle, tool, handoff, error)
│   │   ├── webhook-listener.ts     # Live Hono webhook endpoints + metrics/retry API
│   │   ├── retry-queue.ts          # Exponential backoff retry queue with dead-letter
│   │   ├── metrics.ts              # In-memory metric aggregation + trend analysis
│   │   ├── tools.test.ts           # 14 unit tests
│   │   ├── retry-queue.test.ts     # 7 unit tests
│   │   ├── metrics.test.ts         # 11 unit tests
│   │   ├── webhook-listener.test.ts# 8 unit tests
│   │   └── workflows/              # 7 automation workflow scripts
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── Dockerfile
│   └── VOLTAGENT_SETUP.md
│
├── infra/                          # Terraform IaC
│   ├── main.tf                     # Azure: Resource Group, Key Vault, Managed Identity, ACI
│   ├── variables.tf
│   └── aws/                        # AWS: VPC, ALB, ECS Fargate
│       ├── main.tf
│       ├── variables.tf
│       └── modules/
│           ├── ecs_service/main.tf
│           └── network/main.tf
│
├── .github/workflows/
│   └── build-and-push.yml          # CI: test → build → push to GHCR
│
├── Dockerfile                      # Python 3.11 slim gateway container
├── docker-compose.yml              # Gateway-only compose
├── docker-compose.voltagent.yml    # Full-stack compose (gateway + voltagent)
├── pyproject.toml
├── setup.cfg
├── .env.example
├── AGENTS.md                       # Repository guidelines for AI agents
├── SECURITY.md
├── INTEGRATION_STEPS.md
├── README.md
└── PROJECT_CONTEXT.md              # This file
```

### 4.2 Python MCP Gateway (`gateway/`) — LEGACY

> **Status:** Deprecated prototype. Superseded by MCP-Gateway-Claude-Desktop.
> Retained as reference and as the JSON-RPC backend for VoltAgent integration.

**Application Factory:** `gateway/main.py` → `create_app()` returns FastAPI instance.
**Endpoint:** `POST /api/rpc` — JSON-RPC 2.0 with Bearer token auth.
**Protocol:** Hand-rolled JSON-RPC 2.0 (manual `JSONRPC_METHODS` dict).
**Database:** SQLAlchemy async sessions + asyncpg.

#### Domain Models (Pydantic v2, in `gateway/main.py`)

| Model | Fields | Notes |
|-------|--------|-------|
| `Person` | first_name, last_name, email?, phone? | No email-validator dep |
| `LeadDetails` | budget_range?, location?, property_type?, free_text? | Optional enrichment |
| `Consent` | marketing (bool), source?, timestamp? | GDPR consent tracking |
| `LeadIngestRequest` | source_system, source_lead_id, channel, person, lead_details?, consent, raw_payload, timestamp, meta | Pattern-validated |
| `TwilioWebhookPayload` | MessageSid?, CallSid?, AccountSid, From, To, Body?, CallStatus? | SMS + voice |
| `WhatsAppMessage` | from_ (alias "from"), id, timestamp, type, text? | Cloud API format |

**Valid enums:**
- **source_system:** `META`, `WEB`, `WHATSAPP`, `TWILIO`, `ZOHO_SOCIAL`, `ZOHO_CRM`
- **channel:** `WEB_FORM`, `META_LEAD_AD`, `INBOUND_CALL`, `OUTBOUND_CALL`, `WHATSAPP`, `SMS`, `SOCIAL`, `CRM`

#### 7 MCP Tools

| Tool Name | Input | Output |
|-----------|-------|--------|
| `health_ping` | `{}` | `{"status": "pong"}` |
| `health_env` | `{}` | `{"status": "ok\|degraded", "missing_required": [...]}` |
| `lead_ingest` | `{source_system, source_lead_id, channel, first_name, last_name, email?, phone?}` | `{"ohid": "uuid", "ingest_id": "uuid"}` |
| `twilio_webhook_validator` | `{url, params, signature}` | `{"valid": bool, "parsed": {...}}` |
| `whatsapp_webhook_validator` | `{body, signature}` | `{"valid": bool, "messages": [...]}` |
| `notion_webhook_validator` | `{body, signature}` | `{"valid": bool}` |
| `n8n_workflow_trigger` | `{payload: {}}` | `{"status_code": int, "body": string}` |

#### JSON-RPC Request Format
```json
{
  "jsonrpc": "2.0",
  "id": "unique-id",
  "method": "tools/call",
  "params": {
    "name": "lead_ingest",
    "arguments": {
      "source_system": "WEB",
      "source_lead_id": "lead-123",
      "channel": "WEB_FORM",
      "first_name": "John",
      "last_name": "Doe"
    }
  }
}
```

#### MCP Error Codes

| Code | Meaning |
|------|---------|
| -32001 | MCP_AUTH_TOKEN not set on server |
| -32600 | Missing/invalid bearer token or JSON-RPC version |
| -32601 | Unknown method or tool |
| -32602 | Missing required tool parameters |
| -32002 | N8N_WEBHOOK_URL not set |
| -32000 | Generic server error |

#### REST Webhook Endpoints

| Endpoint | Auth | Signature |
|----------|------|-----------|
| `POST /api/lead/ingest` | None (internal) | N/A |
| `POST /api/twilio/webhook` | X-Twilio-Signature | HMAC-SHA1, base64 |
| `GET /api/whatsapp/webhook` | Query params | Verification challenge |
| `POST /api/whatsapp/webhook` | X-Hub-Signature-256 | HMAC-SHA256, hex |
| `POST /api/notion/webhook` | Notion-Signature | HMAC-SHA256, hex |

#### OHID Resolution

`resolve_ohid(repo, payload)` in `gateway/main.py`:
- Looks up existing OHID by email/phone match in PostgreSQL
- If no match, generates new UUID4
- Identical logic exists in MCP-Gateway-Claude-Desktop's `shared/repository.py`

### 4.3 VoltAgent AI Orchestrator (`voltagent/`) — ACTIVE

#### Agent Architecture

```
                    opulent-supervisor
                    (routes + safety guardrails)
                   /         |         \
            ops-agent    lead-agent   security-agent
            (health,     (lead        (Twilio,
             env,         ingest,      WhatsApp,
             n8n)         OHID)        Notion validators)
```

**Supervisor Agent** (`opulent-supervisor`):
- Routes tasks to sub-agents based on intent
- Has all 7 tools + 3 sub-agents
- Output guardrails: profanity filter + PII redaction + max length
- Hooks: onStart, onEnd, onHandoff, onHandoffComplete, onStepFinish, onTool*, onError

**Ops Agent** (`ops-agent`): health_ping, health_env, n8n_workflow_trigger

**Lead Agent** (`lead-agent`): lead_ingest (primary), PII redaction guardrails

**Security Agent** (`security-agent`): twilio/whatsapp/notion webhook validators

#### Tools (`voltagent/src/tools.ts`)

7 custom tools using `createTool()` from `@voltagent/core` with Zod schemas. All tools call `rpcCall()` → JSON-RPC 2.0 POST to gateway.

```typescript
async function rpcCall(toolName: string, args: Record<string, unknown>) {
  // POST to MCP_GATEWAY_URL with Authorization: Bearer MCP_AUTH_TOKEN
  // Body: { jsonrpc: "2.0", method: "tools/call", params: { name, arguments } }
}
```

#### Guardrails (`voltagent/src/guardrails.ts`)

**Input:** max length (10K chars), prompt injection detection, HTML sanitizer, lead schema validation
**Output:** PII redaction (email, phone), profanity filter, max length

#### Retry Queue (`voltagent/src/retry-queue.ts`)

- Exponential backoff: 1s → 2s → 4s → 8s → 16s (max 300s)
- Max 5 retries before dead-letter
- Registered executor: `lead_ingest`

#### Metrics Store (`voltagent/src/metrics.ts`)

- Records: health, lead, security, webhook metrics
- Trend reports: uptime%, avg/max latency, downtime incidents
- Auto-trims at 10,000 entries per type

#### Webhook Listener (`voltagent/src/webhook-listener.ts`)

| Endpoint | Pipeline |
|----------|----------|
| `POST /webhooks/twilio` | validate → extract → ingest → notify n8n → metrics |
| `POST /webhooks/whatsapp` | validate → extract → ingest → notify n8n → metrics |
| `POST /webhooks/notion` | validate → forward to n8n → metrics |
| `GET /webhooks/status` | Active endpoints, retry stats |
| `GET /metrics` | Full dashboard with 15m/1h/24h trends |
| `GET /metrics/trends` | Configurable: `?minutes=60` |
| `GET /retry-queue` | Pending + dead-letter items |
| `POST /retry-queue/:id/retry` | Manual dead-letter retry |

#### Workflows (`voltagent/src/workflows/`)

| Script | npm command | Tools | Purpose |
|--------|-------------|-------|---------|
| `ops-check.ts` | `workflow:ops` | ping → env → n8n | Basic health |
| `lead-ingest.ts` | `workflow:lead` | lead_ingest ×3 | Multi-source OHID dedup |
| `webhook-validate.ts` | `workflow:security` | 3 validators | Signature test |
| `webhook-to-lead.ts` | `workflow:webhook-lead` | validate → ingest → n8n | E2E pipeline |
| `health-monitor.ts` | `workflow:health-monitor` | ping, env, n8n | Periodic checks |
| `full-pipeline.ts` | `workflow:full-pipeline` | All 7 | 4-phase pipeline |
| `automation-runner.ts` | `workflow:runner` | All 7 | Interval scheduler |

#### Model Selection

```typescript
const model = process.env.OPENAI_API_KEY
  ? openai("gpt-4o-mini")
  : anthropic("claude-sonnet-4-20250514");
```

#### Memory & Server

- LibSQL/Turso durable memory via `@voltagent/libsql`
- Hono server on port 3141 with webhook routes

---

## 5. Infrastructure

### 5.1 Azure (Terraform — `infra/main.tf`)

- Resource Group, Key Vault (RBAC auth, 7 secrets), Managed Identity, ACI (1 CPU, 2GB)

### 5.2 Azure (Bicep — MCP-Gateway-Claude-Desktop `infra/main.bicep`)

- Azure Container Apps for both MCP servers, ACR integration, autoscaling, health checks

### 5.3 AWS (`infra/aws/`)

- VPC, ALB, ECS Fargate — modular: `modules/network/`, `modules/ecs_service/`

### 5.4 Docker

| Compose File | Services | Ports |
|-------------|----------|-------|
| `docker-compose.yml` | Gateway only | 8000 |
| `docker-compose.voltagent.yml` | Gateway + VoltAgent | 8000, 3141 |
| MCP-Gateway `docker-compose.yml` | Lead Ingest + Zoho Sync + PostgreSQL 16 | 8001, 8002, 5432 |

### 5.5 CI/CD

**mcp-database-opulent:** GitHub Actions → test → build → push GHCR
**MCP-Gateway-Claude-Desktop:** GitHub Actions → pytest → Docker → ACR → Container Apps → smoke test

---

## 6. Environment Variables

### Gateway (Python — mcp-database-opulent)

| Variable | Required | Description |
|----------|----------|-------------|
| `PGHOST/PORT/USER/PASSWORD/DATABASE` | Yes (prod) | PostgreSQL connection |
| `TWILIO_AUTH_TOKEN` | Yes | HMAC-SHA1 for Twilio webhook validation |
| `WHATSAPP_APP_SECRET` | Yes | HMAC-SHA256 for WhatsApp validation |
| `WHATSAPP_VERIFY_TOKEN` | Yes | WhatsApp verification challenge token |
| `NOTION_WEBHOOK_SECRET` | Yes | HMAC-SHA256 for Notion validation |
| `N8N_WEBHOOK_URL` | Yes | n8n workflow trigger URL |
| `MCP_AUTH_TOKEN` | Yes | Bearer token for JSON-RPC auth |
| `REPOSITORY_IMPL` | Yes | Repository implementation selector |

### VoltAgent (TypeScript)

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_GATEWAY_URL` | Yes | JSON-RPC endpoint (default: `http://localhost:8000/api/rpc`) |
| `MCP_AUTH_TOKEN` | Yes | Must match gateway's token |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | One required | LLM provider |
| `VOLTAGENT_PORT` | No | Hono server port (default: 3141) |
| `LIBSQL_URL` | No | Memory DB (default: `file:./voltagent-memory.db`) |

### MCP-Gateway-Claude-Desktop (Production)

| Variable | Description |
|----------|-------------|
| `MCP_API_KEY` | Bearer token for HTTP transport |
| `ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN` | Zoho OAuth2 (AU data centre) |
| `ZOHO_API_BASE` | `https://www.zohoapis.com.au/crm/v2` |
| `TWILIO_AUTH_TOKEN/ACCOUNT_SID` | Twilio telephony |
| `TWILIO_OUTBOUND_NUMBER` | E.164 outbound number |
| `TWILIO_WHATSAPP_FROM` | WhatsApp-enabled Twilio number |
| `ELEVENLABS_API_KEY/AGENT_ID/PHONE_NUMBER_ID` | ElevenLabs Archer v7 |
| `ELEVENLABS_WEBHOOK_SECRET` | HMAC-SHA256 verification |
| `META_APP_SECRET/VERIFY_TOKEN/PAGE_ACCESS_TOKEN` | Meta Lead Ads |
| `CAL_API_KEY/EVENT_TYPE_ID/TEAM_ID` | Cal.com booking |
| `OUTBOUND_CALL_ENABLED/DELAY/WINDOW_*` | Outbound call orchestrator |
| `GATEWAY_BASE_URL` | Public URL for ElevenLabs callbacks |

---

## 7. Testing

### Python Tests (mcp-database-opulent)

```bash
python gateway/main.py              # Internal async tests
pip install -e .[test] && pytest     # Pytest suite
```

### VoltAgent Tests (40 tests, all passing)

```bash
cd voltagent && npm test             # vitest run
npm run test:coverage                # V8 coverage
npm run lint                         # tsc --noEmit
```

| File | Tests | Coverage |
|------|-------|----------|
| `tools.test.ts` | 14 | All 7 tools, RPC transport, errors |
| `retry-queue.test.ts` | 7 | Enqueue, retry, dead-letter |
| `metrics.test.ts` | 11 | All types, trends, trimming |
| `webhook-listener.test.ts` | 8 | Routes, pipeline, retry |

### MCP-Gateway-Claude-Desktop Tests (180+ tests)

```bash
pytest                               # 15 test files, excludes e2e_zoho_live.py
```

| File | Purpose |
|------|---------|
| `test_lead_ingest.py` | ingest_lead, OHID resolution, lookup |
| `test_zoho_sync.py` | sync_lead, get/upsert_zoho_lead |
| `test_agent_pool.py` | Round-robin routing, timezone filtering |
| `test_elevenlabs_webhooks.py` | Pre-call, post-call handlers |
| `test_meta_leadgen.py` | Meta Lead Ads webhook |
| `test_outbound_orchestrator.py` | Call orchestration, phone normalization |
| `test_outcome_router.py` | Outcome determination logic |
| `test_whatsapp_sequences.py` | Message sequencing, templates |
| `test_web_form_webhook.py` | Web form webhook |
| `test_e2e_pipeline.py` | Full pipeline: ingest → Zoho sync |
| `e2e_zoho_live.py` | Real Zoho API (skipped in CI) |

---

## 8. Commands Reference

### Gateway (mcp-database-opulent)

```bash
pip install -e ".[test]"
MCP_AUTH_TOKEN=token uvicorn gateway.main:create_app --host 0.0.0.0 --port 8000
docker compose up --build                                              # gateway only
docker compose -f docker-compose.yml -f docker-compose.voltagent.yml up --build  # full stack
```

### VoltAgent

```bash
cd voltagent
npm install && npm run dev           # hot reload
npm test                             # 40 tests
npm run workflow:ops                 # health check
npm run workflow:lead                # lead ingestion
npm run workflow:security            # webhook validation
npm run workflow:full-pipeline       # all 7 tools, 4 phases
npm run workflow:runner              # overnight automation
```

### MCP-Gateway-Claude-Desktop

```bash
# stdio mode (default)
python -m servers.lead_ingest
python -m servers.zoho_crm_sync

# HTTP mode
python -m servers.lead_ingest --transport streamable-http --port 8001
python -m servers.zoho_crm_sync --transport streamable-http --port 8002

# Docker
docker compose up                    # 2 servers + PostgreSQL 16
```

### Infrastructure

```bash
cd infra && terraform init && terraform plan     # Azure (Terraform)
cd infra/aws && terraform init && terraform plan # AWS
```

---

## 9. Deployment Matrix

| Method | Services | Ports | Repo |
|--------|----------|-------|------|
| Local dev (gateway) | Gateway only | 8000 | mcp-database-opulent |
| Full compose (gateway + voltagent) | Gateway + VoltAgent | 8000, 3141 | mcp-database-opulent |
| MCP-Gateway local | Lead Ingest + Zoho Sync + PG | 8001, 8002, 5432 | MCP-Gateway-Claude-Desktop |
| Azure ACI (Terraform) | Gateway container | 8000 | mcp-database-opulent |
| Azure Container Apps **(PROD)** | 2 MCP servers | 8001, 8002 | MCP-Gateway-Claude-Desktop |
| AWS ECS Fargate | Gateway behind ALB | 80→8000 | mcp-database-opulent |

---

## 10. Production vs. Legacy Comparison

| Aspect | mcp-database-opulent/gateway/ | MCP-Gateway-Claude-Desktop |
|--------|------|---------|
| **Status** | Legacy / Deprecated | **PRODUCTION (LIVE)** |
| **Framework** | FastAPI + Uvicorn | Anthropic MCP SDK + FastAPI (webhooks) |
| **Architecture** | Monolithic (1 app, 1 port) | Modular (2 servers, 2 ports) |
| **Protocol** | Hand-rolled JSON-RPC 2.0 | Official MCP JSON-RPC 2.0 |
| **Transport** | HTTP only | stdio + HTTP + SSE |
| **Tool Registration** | Manual `JSONRPC_METHODS` dict | `@mcp.tool()` decorators |
| **Schema Generation** | Manual | Auto from type hints |
| **Database** | SQLAlchemy async ORM | asyncpg direct |
| **Tools** | 7 | 8 (5 lead + 3 Zoho) |
| **Features** | Lead ingest, webhooks | +ElevenLabs, +Agent pool, +Outbound calls, +WhatsApp, +Meta, +Web form |
| **Tests** | Basic | 180+ comprehensive |
| **Deployment** | Not deployed | Azure Container Apps (australiaeast) |

---

## 11. Git History & Conventions

**Current branch (mcp-database-opulent):** `claude/voltagen-setup-eFz0J`

**Recent commits (this repo, newest first):**
```
ecd031e chore: add coverage/ to .gitignore
8c59574 fix: resolve gateway circular import and lead_ingest timestamp error
b8895fd feat: add webhook listener, retry queue, metrics store, and overnight automation
081d935 feat: add automation workflows connecting all 7 gateway tools
a97d89c feat: add tool-boundary hardening, pin ElevenLabs, add audit scripts
7aa755d feat: add tests, guardrails, hooks, workflows, and Docker for VoltAgent
7155d43 feat: add VoltAgent v2 AI agent with MCP gateway integration
```

**Recent commits (MCP-Gateway-Claude-Desktop, newest first):**
```
14d44bb Merge PR #17: config drift audit — DB name, Zoho AU endpoints, FQDN
17c2e36 Fix: config drift audit — DB name, Zoho AU endpoints
6cf60f6 Docs: add architecture diagrams + uv lockfile
f25f990 Docs: add WhatsApp message templates for Meta approval
124e625 Fix: add missing DB tables (agent_pool, outbound_call_log, wa_queue)
ed8fcbe Feat: retry persistence, phone normalization, callback dedup
```

**Commit style:** Conventional commits (`feat:`, `fix:`, `chore:`, `infra:`, `docs:`).

---

## 12. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         VoltOps Console                                   │
│                   console.voltagent.dev                                   │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │ WebSocket / HTTP
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              VoltAgent Server (Hono :3141)                                │
│                                                                           │
│  Guardrails: input (length, injection, HTML, schema)                     │
│              output (PII redaction, profanity, max-length)               │
│                                                                           │
│  ┌──────────────────────────────────────────────┐                        │
│  │         opulent-supervisor (Agent)            │                        │
│  │  Routes tasks to: ops / lead / security       │                        │
│  └──────┬──────────┬──────────┬─────────────────┘                        │
│  ┌──────▼──┐ ┌─────▼────┐ ┌──▼──────────┐                               │
│  │ops-agent│ │lead-agent│ │security-agent│                               │
│  └────┬────┘ └────┬─────┘ └──────┬───────┘                               │
│       └───────────┴──────────────┘                                       │
│                    │ JSON-RPC 2.0 (Bearer auth)                           │
│  Webhook Listener: /webhooks/twilio, /whatsapp, /notion                  │
│  Retry Queue + Metrics Store                                             │
└────────────────────┬─────────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│       Legacy Gateway (FastAPI :8000) — mcp-database-opulent              │
│                                                                           │
│  /api/rpc: 7 JSON-RPC tools                                             │
│  /api/lead, /api/twilio, /api/whatsapp, /api/notion (REST)              │
└──────────────────────────────────────────────────────────────────────────┘

                    ═══ PRODUCTION ═══

┌──────────────────────────────────────────────────────────────────────────┐
│   MCP-Gateway-Claude-Desktop — Azure Container Apps (australiaeast)      │
│                                                                           │
│  ┌─────────────────────────────┐  ┌──────────────────────────────┐       │
│  │  Lead Ingest Server (:8001) │  │  Zoho CRM Sync Server (:8002)│       │
│  │  5 MCP tools + webhooks     │  │  3 MCP tools + OAuth2 refresh│       │
│  └──────────────┬──────────────┘  └──────────────┬───────────────┘       │
│                 └──────────┬─────────────────────┘                       │
│                            ▼                                             │
│                    PostgreSQL 16                                          │
│                                                                           │
│  Phase 1–4: ElevenLabs Archer v7 │ Agent Pool │ Outbound Calls           │
│             WhatsApp Sequences │ Outcome Router │ Meta Lead Ads           │
└──────────────────────────────────────────────────────────────────────────┘
                     │
                     ▼
          Zoho CRM (AU) / Cal.com / Twilio / ElevenLabs / n8n
```

---

## 13. Known Issues & Expected Warnings

| Issue | Severity | Explanation |
|-------|----------|-------------|
| `health_env` returns `degraded` in local dev | Expected | Missing PG, Twilio, WhatsApp, Notion, n8n secrets |
| `models.dev` DNS failure in sandbox | Info | VoltAgent model registry auto-refresh — non-blocking |
| `lead_ingest` uses `_FakeRepo` via MCP | By design | In-memory repo for dev; PostgresRepository for prod |
| Gateway circular import | Resolved | `main → mcp_router → mcp_server → main` — fixed via lazy import |
| `elevenlabs` pinned to 1.59.0 | Workaround | Prevents transitive dependency issues |
| Azure PostgreSQL not provisioned | Production gap | MCP-Gateway-Claude-Desktop needs Azure PG setup |
| 19 exposed secrets | Security debt | MCP-Gateway-Claude-Desktop — remediation planned |
| Outbound call API | Production gap | ElevenLabs API integration needs fix |

---

## 14. Quick Reference for AI Assistants

When working on this project:

- **Gateway changes (legacy)** → Edit `gateway/`, run `python gateway/main.py` to test
- **VoltAgent changes** → Edit `voltagent/src/`, run `npm test` and `npm run lint`
- **New legacy tools** → Add to `gateway/mcp_server.py` + mirror in `voltagent/src/tools.ts`
- **New production tools** → Add to MCP-Gateway-Claude-Desktop `servers/lead_ingest.py` or `servers/zoho_crm_sync.py` using `@mcp.tool()` decorators
- **New VoltAgent agents** → Add to `voltagent/src/index.ts`, register with supervisor's `subAgents`
- **New workflows** → Add to `voltagent/src/workflows/`, add npm script in `package.json`
- **Infrastructure** → Terraform in `infra/` (Azure/AWS), Bicep in MCP-Gateway `infra/main.bicep`
- **Secrets** → Never commit. `.env` locally, Key Vault / Secrets Manager in prod
- **Coding style** → Python: Black, snake_case. TypeScript: strict, ESM, Zod schemas
- **Commit style** → `feat:`, `fix:`, `chore:`, `infra:`, `docs:` prefixes
- **Production deployments** → Only via MCP-Gateway-Claude-Desktop CI/CD pipeline
