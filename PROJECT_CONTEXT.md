# PROJECT_CONTEXT.md — Opulent MCP Gateway + VoltAgent AI Agent

> **Purpose:** Single source of truth for all Claude interfaces (Chat, VS Code, CLI).
> Copy-paste or attach this file to any new conversation to give Claude full project context.
>
> **Last updated:** 2026-02-27
> **Branch:** `claude/voltagen-setup-eFz0J`
> **Repo:** `chris1-commits/mcp-database-opulent`

---

## 1. Project Overview

**Opulent MCP Gateway** is a two-service platform for lead management and webhook processing:

1. **Python MCP Gateway** (`gateway/`) — A FastAPI application exposing 7 JSON-RPC 2.0 tools at `/api/rpc`, plus REST endpoints for Twilio, WhatsApp, and Notion webhooks. Handles OHID (Opulent Horizons Identity) resolution, lead persistence (PostgreSQL), webhook signature verification (HMAC-SHA1/SHA256), and n8n workflow triggering.

2. **VoltAgent AI Orchestrator** (`voltagent/`) — A VoltAgent v2 TypeScript multi-agent system that wraps all 7 gateway tools with Zod-typed schemas, a 4-agent supervisor architecture, input/output guardrails, observability hooks, a retry queue, an in-memory metrics store, live webhook processing endpoints, and 7 automation workflow scripts.

**Key integration pattern:** VoltAgent agents call the Python gateway via JSON-RPC 2.0 over HTTP (`POST /api/rpc`) with Bearer token authentication. The gateway processes the tool call and returns results.

**Domain:** Real estate lead management for Opulent Horizons — ingesting leads from Meta, WhatsApp, Twilio, web forms, Zoho; resolving identities via OHID; forwarding events to n8n for downstream automation.

---

## 2. Repository Structure

```
mcp-database-opulent/
├── gateway/                        # Python FastAPI MCP Gateway
│   ├── __init__.py                 # Package init (exports create_app)
│   ├── main.py                     # FastAPI app factory, domain models, repositories, routers, webhook handlers
│   ├── mcp_server.py               # JSON-RPC 2.0 handler — 7 tools, auth, tool dispatch
│   ├── mcp_router.py               # FastAPI router mounting /api/rpc endpoint
│   ├── healthcheck.py              # CLI health check utility
│   └── openapi_check.py            # OpenAPI endpoint reachability checker
│
├── voltagent/                      # VoltAgent v2 TypeScript AI Agent
│   ├── src/
│   │   ├── index.ts                # Main entry — 4 agents + webhook listener + retry queue + metrics
│   │   ├── tools.ts                # 7 Zod-typed tools wrapping gateway JSON-RPC calls
│   │   ├── guardrails.ts           # Input/output guardrails (length, injection, PII, schema)
│   │   ├── hooks.ts                # Observability hooks (lifecycle, tool, handoff, error)
│   │   ├── webhook-listener.ts     # Live Hono webhook endpoints + metrics/retry API
│   │   ├── retry-queue.ts          # Exponential backoff retry queue with dead-letter
│   │   ├── metrics.ts              # In-memory metric aggregation + trend analysis
│   │   ├── tools.test.ts           # Unit tests — 7 tools + RPC transport (14 tests)
│   │   ├── retry-queue.test.ts     # Unit tests — retry queue (7 tests)
│   │   ├── metrics.test.ts         # Unit tests — metrics store (11 tests)
│   │   ├── webhook-listener.test.ts# Unit tests — webhook pipeline (8 tests)
│   │   └── workflows/
│   │       ├── ops-check.ts        # Sample: health_ping + health_env + n8n_trigger
│   │       ├── lead-ingest.ts      # Sample: 3 leads with OHID deduplication
│   │       ├── webhook-validate.ts # Sample: Twilio/WhatsApp/Notion validation
│   │       ├── webhook-to-lead.ts  # Automation: validate → extract → ingest → notify
│   │       ├── health-monitor.ts   # Automation: periodic health checks + degradation alerts
│   │       ├── full-pipeline.ts    # Automation: all 7 tools in 4-phase pipeline
│   │       └── automation-runner.ts# Automation: interval-based scheduler (health/lead/security)
│   ├── package.json                # Dependencies, scripts, overrides
│   ├── tsconfig.json               # TypeScript strict config (ES2022, bundler)
│   ├── vitest.config.ts            # Vitest test runner configuration
│   ├── Dockerfile                  # Node 22 slim container
│   ├── .env.example                # All required/optional variables documented
│   ├── .gitignore                  # node_modules, dist, .env, .db, coverage
│   └── VOLTAGENT_SETUP.md          # Detailed VoltAgent documentation
│
├── infra/                          # Terraform Infrastructure-as-Code
│   ├── main.tf                     # Azure: Resource Group, Key Vault, Managed Identity, ACI
│   ├── variables.tf                # Azure variables (secrets, region, image, DB)
│   └── aws/
│       ├── main.tf                 # AWS: VPC, ALB, ECS Fargate service
│       ├── variables.tf            # AWS variables
│       └── modules/
│           ├── ecs_service/main.tf # ECS task definition, service, ALB target group
│           └── network/main.tf     # VPC, public subnets, internet gateway
│
├── .github/workflows/
│   └── build-and-push.yml          # CI: test → build → push to GHCR
│
├── Dockerfile                      # Python 3.11 slim gateway container
├── docker-compose.yml              # Gateway-only compose
├── docker-compose.voltagent.yml    # Full-stack compose (gateway + voltagent)
├── pyproject.toml                  # Python package config (fastapi, sqlalchemy, httpx, etc.)
├── setup.cfg                       # Setuptools config
├── .env.example                    # Root env template
├── AGENTS.md                       # Repository guidelines for AI agents
├── SECURITY.md                     # Security policy
├── INTEGRATION_STEPS.md            # Integration documentation
├── README.md                       # Project README
└── PROJECT_CONTEXT.md              # This file
```

---

## 3. Python MCP Gateway (`gateway/`)

### 3.1 Application Factory

**File:** `gateway/main.py`
- `create_app()` returns a FastAPI instance
- Lazy-imports `mcp_router` inside `create_app()` to avoid circular import (`main → mcp_router → mcp_server → main`)
- Mounts 5 routers: `/api/lead`, `/api/twilio`, `/api/whatsapp`, `/api/notion`, `/api/rpc`
- Health endpoints: `GET /health/ping` (liveness), `GET /health/env` (env audit)

### 3.2 Domain Models (Pydantic v2)

All defined in `gateway/main.py`:

| Model | Fields | Notes |
|-------|--------|-------|
| `Person` | first_name, last_name, email?, phone? | No email-validator dependency |
| `LeadDetails` | budget_range?, location?, property_type?, free_text? | Optional enrichment |
| `Consent` | marketing (bool), source?, timestamp? | GDPR consent tracking |
| `LeadIngestRequest` | source_system, source_lead_id, channel, person, lead_details?, consent, raw_payload, timestamp, meta | Pattern-validated source_system and channel |
| `TwilioWebhookPayload` | MessageSid?, CallSid?, AccountSid, From, To, Body?, CallStatus?, NumMedia? | SMS + voice |
| `WhatsAppMessage` | from_ (alias "from"), id, timestamp, type, text? | Cloud API format |

### 3.3 Valid Enum Values

**source_system:** `META`, `WEB`, `WHATSAPP`, `TWILIO`, `ZOHO_SOCIAL`, `ZOHO_CRM`
**channel:** `WEB_FORM`, `META_LEAD_AD`, `INBOUND_CALL`, `OUTBOUND_CALL`, `WHATSAPP`, `SMS`, `SOCIAL`, `CRM`

### 3.4 OHID Resolution

**Function:** `resolve_ohid(repo, payload)` in `gateway/main.py`
- Looks up existing OHID by email/phone match in PostgreSQL
- If no match found, generates a new UUID4 as the OHID
- Enables cross-channel identity resolution (same person via WhatsApp + email = same OHID)

### 3.5 Repository Layer

Abstract base `Repository` with methods:
- `insert_lead_context(ohid, ingest_id, lead)`
- `find_ohid_by_contact(email, phone)`
- `insert_workflow_event(event_id, ohid, event_type, payload, source_system)`

Implementations:
- `PostgresRepository` — async SQLAlchemy + asyncpg (production)
- `_FakeRepo` — in-memory dict (testing, dev mode, MCP tool calls)

### 3.6 JSON-RPC 2.0 MCP Server

**File:** `gateway/mcp_server.py`
**Endpoint:** `POST /api/rpc`
**Auth:** Bearer token (`Authorization: Bearer <MCP_AUTH_TOKEN>`)
**Protocol:** JSON-RPC 2.0 with methods: `ping`, `tools/list`, `tools/call`

#### 7 MCP Tools

| Tool Name | Method | Input | Output |
|-----------|--------|-------|--------|
| `health_ping` | `tools/call` | `{}` | `{"status": "pong"}` |
| `health_env` | `tools/call` | `{}` | `{"status": "ok\|degraded", "missing_required": [...], "missing_optional": [...]}` |
| `lead_ingest` | `tools/call` | `{source_system, source_lead_id, channel, first_name, last_name, email?, phone?}` | `{"ohid": "uuid", "ingest_id": "uuid"}` |
| `twilio_webhook_validator` | `tools/call` | `{url, params: {}, signature}` | `{"valid": bool, "parsed": {...}}` |
| `whatsapp_webhook_validator` | `tools/call` | `{body: string, signature}` | `{"valid": bool, "messages": [...]}` |
| `notion_webhook_validator` | `tools/call` | `{body: string, signature}` | `{"valid": bool}` |
| `n8n_workflow_trigger` | `tools/call` | `{payload: {}}` | `{"status_code": int, "body": string}` |

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
| -32002 | N8N_WEBHOOK_URL not set (n8n_workflow_trigger only) |
| -32000 | Generic server error |

### 3.7 REST Webhook Endpoints

| Endpoint | Method | Auth | Signature Algorithm |
|----------|--------|------|-------------------|
| `POST /api/lead/ingest` | POST | None (internal) | N/A |
| `POST /api/twilio/webhook` | POST | X-Twilio-Signature | HMAC-SHA1, base64 |
| `GET /api/whatsapp/webhook` | GET | Query params | Verification challenge |
| `POST /api/whatsapp/webhook` | POST | X-Hub-Signature-256 | HMAC-SHA256, hex |
| `POST /api/notion/webhook` | POST | Notion-Signature | HMAC-SHA256, hex |

### 3.8 Event Publishing

`publish_event(event_type, payload)` — POSTs to `N8N_WEBHOOK_URL` (no-op if unset). Event types: `LeadIngested`, `TwilioSMS`, `TwilioCall`, `WhatsAppMessage`, `NotionEvent`.

### 3.9 Python Dependencies

```
fastapi>=0.110.0, uvicorn[standard]>=0.27.0, pydantic>=2.5.0,
sqlalchemy[asyncio]>=2.0.0, asyncpg>=0.29.0, httpx>=0.25.0,
python-jsonrpc-server>=0.4.0, python-dotenv>=1.0.0
Test: pytest>=7.4.0, pytest-asyncio>=0.21.0
```

---

## 4. VoltAgent AI Orchestrator (`voltagent/`)

### 4.1 Agent Architecture

Four agents in a supervisor pattern:

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

**Ops Agent** (`ops-agent`):
- health_ping, health_env, n8n_workflow_trigger
- Purpose: gateway health monitoring, environment diagnostics, n8n automation

**Lead Agent** (`lead-agent`):
- lead_ingest (primary), plus all tools for context
- Output guardrails: PII redaction (email, phone, sensitive numbers)
- Purpose: lead ingestion, OHID identity resolution, contact management

**Security Agent** (`security-agent`):
- twilio/whatsapp/notion webhook validators
- Output guardrails: PII redaction
- Purpose: webhook signature validation and debugging

### 4.2 Tools (`voltagent/src/tools.ts`)

7 custom tools using `createTool()` from `@voltagent/core`, each with Zod parameter schemas. All tools call `rpcCall()` which sends JSON-RPC 2.0 to the Python gateway.

**RPC Transport:**
```typescript
async function rpcCall(toolName: string, args: Record<string, unknown>) {
  // POST to MCP_GATEWAY_URL with Authorization: Bearer MCP_AUTH_TOKEN
  // Body: { jsonrpc: "2.0", method: "tools/call", params: { name, arguments } }
}
```

**Tool → Zod Schema Mapping:**

| Tool | Zod Parameters |
|------|---------------|
| `health_ping` | `z.object({})` |
| `health_env` | `z.object({})` |
| `lead_ingest` | `z.object({ source_system: z.string(), source_lead_id: z.string(), channel: z.string(), first_name: z.string(), last_name: z.string(), email: z.string().email().optional(), phone: z.string().optional() })` |
| `twilio_webhook_validator` | `z.object({ url: z.string().url(), params: z.record(z.string()), signature: z.string() })` |
| `whatsapp_webhook_validator` | `z.object({ body: z.string(), signature: z.string() })` |
| `notion_webhook_validator` | `z.object({ body: z.string(), signature: z.string() })` |
| `n8n_workflow_trigger` | `z.object({ payload: z.record(z.unknown()) })` |

### 4.3 Guardrails (`voltagent/src/guardrails.ts`)

**Input guardrails (all agents):**
1. `createInputLengthGuardrail({ maxCharacters: 10_000 })` — blocks oversized inputs
2. `createPromptInjectionGuardrail()` — detects injection attempts
3. `createHTMLSanitizerInputGuardrail()` — strips HTML/script tags
4. `leadSchemaGuardrail` (custom) — validates source_system/channel against allowed enums

**Output guardrails:**
- Lead + Security agents: `createDefaultPIIGuardrails()` — email, phone, sensitive number redaction
- Supervisor: `createDefaultSafetyGuardrails()` — profanity + PII + max length

### 4.4 Hooks (`voltagent/src/hooks.ts`)

**Sub-agent hooks:** `onStart`, `onEnd`, `onToolStart`, `onToolEnd`, `onToolError`, `onError`
**Supervisor hooks:** All sub-agent hooks + `onHandoff`, `onHandoffComplete`, `onStepFinish`

All hooks emit structured Pino JSON logs via `@voltagent/logger`.

### 4.5 Retry Queue (`voltagent/src/retry-queue.ts`)

```typescript
class RetryQueue {
  constructor(opts: { maxRetries, baseDelayMs, maxDelayMs, onRetry?, onSuccess?, onDeadLetter? })
  registerExecutor(operation: string, fn: (payload) => Promise<unknown>)
  enqueue<T>(operation: string, payload: T, error: string): RetryItem<T>
  processQueue(): Promise<void>
  getStats(): { pending, deadLetter, totalProcessed, totalFailed }
  getPending(): readonly RetryItem[]
  getDeadLetters(): readonly RetryItem[]
  retryDeadLetter(id: string): boolean
  stop()
}
```

- Exponential backoff: 1s → 2s → 4s → 8s → 16s (max 300s)
- Max 5 retries before dead-letter
- Currently registered executor: `lead_ingest`

### 4.6 Metrics Store (`voltagent/src/metrics.ts`)

```typescript
class MetricsStore {
  recordHealth(metric: { alive: boolean, latencyMs: number, envStatus: string, timestamp: Date })
  recordLead(metric: { source: string, channel: string, ohid: string, success: boolean, durationMs: number, timestamp: Date })
  recordSecurity(metric: { provider: string, reachable: boolean, signatureValid?: boolean, timestamp: Date })
  recordWebhook(metric: { provider: string, pipeline: string, success: boolean, statusCode?: number, timestamp: Date })
  getHealthSince(minutes: number): HealthMetric[]
  getTrend(minutes: number): TrendReport  // uptime%, avg/max latency, downtime incidents
  getSnapshot()                            // counts + 15m/1h/24h trends
}
```

- Auto-trims at 10,000 entries per metric type
- Trend reports include downtime incident detection with start/end timestamps

### 4.7 Webhook Listener (`voltagent/src/webhook-listener.ts`)

Mounted on the VoltAgent Hono server via `configureApp` callback:

| Endpoint | Method | Pipeline |
|----------|--------|----------|
| `/webhooks/twilio` | POST | validate signature → extract contact → ingest lead → notify n8n → record metrics |
| `/webhooks/whatsapp` | POST | validate signature → extract contact → ingest lead → notify n8n → record metrics |
| `/webhooks/notion` | POST | validate signature → forward to n8n → record metrics |
| `/webhooks/status` | GET | Active endpoints, retry queue stats, recent webhook count |
| `/metrics` | GET | Full dashboard: health/leads/security/webhooks counts + 15m/1h/24h trends |
| `/metrics/trends` | GET | Trend report with configurable window: `?minutes=60` |
| `/retry-queue` | GET | Pending retries and dead-letter items |
| `/retry-queue/:id/retry` | POST | Manually retry a dead-letter item |

### 4.8 Workflows (`voltagent/src/workflows/`)

| Script | npm command | Tools chained | What it does |
|--------|-------------|---------------|-------------|
| `ops-check.ts` | `workflow:ops` | health_ping → health_env → n8n_trigger | Basic operations health check |
| `lead-ingest.ts` | `workflow:lead` | lead_ingest × 3 | 3 leads from different sources with OHID dedup |
| `webhook-validate.ts` | `workflow:security` | twilio/whatsapp/notion validators | Signature validation test |
| `webhook-to-lead.ts` | `workflow:webhook-lead` | twilio/whatsapp validator → lead_ingest → n8n_trigger | End-to-end inbound webhook → lead pipeline |
| `health-monitor.ts` | `workflow:health-monitor` | health_ping, health_env, n8n_trigger | Periodic checks with state-change alerts (`--interval N`) |
| `full-pipeline.ts` | `workflow:full-pipeline` | All 7 tools | 4-phase pipeline: pre-flight → multi-lead batch → security → n8n |
| `automation-runner.ts` | `workflow:runner` | All 7 tools | Interval scheduler: health (60s), leads (300s), security (600s) |

### 4.9 Model Selection

```typescript
const model = process.env.OPENAI_API_KEY
  ? openai("gpt-4o-mini")
  : anthropic("claude-sonnet-4-20250514");
```

### 4.10 Memory

LibSQL/Turso durable memory via `@voltagent/libsql`:
```typescript
const memory = new Memory({
  storage: new LibSQLMemoryAdapter({
    url: process.env.LIBSQL_URL ?? "file:./voltagent-memory.db",
    authToken: process.env.LIBSQL_AUTH_TOKEN,
  }),
});
```

### 4.11 Server Bootstrap

```typescript
new VoltAgent({
  agents: { supervisor, ops, leads, security },
  server: honoServer({
    port: 3141,
    configureApp: (app) => {
      configureWebhookRoutes(app, { retryQueue, metrics });
    },
  }),
});
```

### 4.12 TypeScript Dependencies

**Runtime:**
```
@voltagent/core, @voltagent/server-hono, @voltagent/libsql, @voltagent/logger,
@voltagent/sdk, @voltagent/supabase, @voltagent/voice, @voltagent/xsai,
@voltagent/docs-mcp, ai (v6), @ai-sdk/openai, @ai-sdk/anthropic, dotenv, zod
```

**Dev:**
```
typescript (5.9+), tsx (4.x), vitest (4.x), @vitest/coverage-v8, @voltagent/cli, mcp-to-ai-sdk
```

**Override:** `elevenlabs: "1.59.0"` (pinned to prevent transitive dependency issues)

---

## 5. Infrastructure

### 5.1 Azure (`infra/main.tf`)

- **Resource Group** in configurable region
- **Azure Key Vault** with RBAC auth, stores 7 secrets (pg-password, twilio-auth-token, whatsapp-app-secret, notion-secret, elevenlabs-api-key, openai-api-key, mcp-auth-token)
- **User-Assigned Managed Identity** with Key Vault Secrets User role
- **Azure Container Instance** (1 CPU, 2GB RAM) running the gateway Docker image with secrets injected as secure env vars

### 5.2 AWS (`infra/aws/`)

- **VPC** with configurable CIDR and public subnets
- **Application Load Balancer** with HTTP security group
- **ECS Fargate** service with task definition, ALB target group
- Modular: `modules/network/` (VPC/subnets) and `modules/ecs_service/` (ECS/ALB)

### 5.3 Docker

**Gateway Dockerfile** (root):
- Python 3.11 slim, installs via `pip install .`
- Runs: `uvicorn gateway.main:create_app --host 0.0.0.0 --port 8000`

**VoltAgent Dockerfile** (`voltagent/`):
- Node 22 slim
- Runs: `node dist/index.js`

**Compose files:**
- `docker-compose.yml` — Gateway only on port 8000
- `docker-compose.voltagent.yml` — Extends with VoltAgent on port 3141, auto-connects to gateway

```bash
# Full stack
docker compose -f docker-compose.yml -f docker-compose.voltagent.yml up --build
```

### 5.4 CI/CD (`.github/workflows/build-and-push.yml`)

Triggers on push to `main`/`master` or manual dispatch:
1. Checkout → Setup Python 3.11 → Install deps → Run tests (`python gateway/main.py`)
2. Login to GHCR → Build Docker → Push to `ghcr.io/chris1-commits/mcp-database-opulent:latest`

---

## 6. Environment Variables

### Gateway (Python)

| Variable | Required | Description |
|----------|----------|-------------|
| `PGHOST` | Yes (prod) | PostgreSQL host |
| `PGPORT` | Yes (prod) | PostgreSQL port (default: 5432) |
| `PGUSER` | Yes (prod) | PostgreSQL username |
| `PGPASSWORD` | Yes (prod) | PostgreSQL password |
| `PGDATABASE` | Yes (prod) | PostgreSQL database name |
| `TWILIO_AUTH_TOKEN` | Yes | HMAC-SHA1 secret for Twilio webhook validation |
| `WHATSAPP_APP_SECRET` | Yes | HMAC-SHA256 secret for WhatsApp webhook validation |
| `WHATSAPP_VERIFY_TOKEN` | Yes | WhatsApp webhook verification challenge token |
| `NOTION_WEBHOOK_SECRET` | Yes | HMAC-SHA256 secret for Notion webhook validation |
| `N8N_WEBHOOK_URL` | Yes | Target URL for n8n workflow triggers |
| `MCP_AUTH_TOKEN` | Yes | Bearer token for JSON-RPC authentication |
| `REPOSITORY_IMPL` | Yes | Repository implementation selector |
| `ELEVENLABS_API_KEY` | No | ElevenLabs TTS API key |
| `ELEVENLABS_VOICE_ID` | No | ElevenLabs voice selection |
| `ELEVENLABS_MODEL_ID` | No | ElevenLabs model selection |
| `OPENAI_API_KEY` | No | OpenAI API key (gateway-side) |

### VoltAgent (TypeScript)

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_GATEWAY_URL` | Yes | JSON-RPC endpoint (default: `http://localhost:8000/api/rpc`) |
| `MCP_AUTH_TOKEN` | Yes | Must match gateway's MCP_AUTH_TOKEN |
| `OPENAI_API_KEY` | One of these | Primary LLM provider (GPT-4o-mini) |
| `ANTHROPIC_API_KEY` | One of these | Fallback LLM provider (Claude Sonnet) |
| `VOLTAGENT_PORT` | No | Hono server port (default: 3141) |
| `LIBSQL_URL` | No | Memory DB URL (default: `file:./voltagent-memory.db`) |
| `LIBSQL_AUTH_TOKEN` | No | Turso auth token (remote only) |
| `RUNNER_HEALTH_INTERVAL` | No | Health check interval in seconds (default: 60) |
| `RUNNER_LEAD_INTERVAL` | No | Lead batch interval in seconds (default: 300) |
| `RUNNER_SECURITY_INTERVAL` | No | Security audit interval in seconds (default: 600) |
| `ELEVENLABS_API_KEY` | No | ElevenLabs voice API key |
| `ELEVENLABS_VOICE_ID` | No | ElevenLabs voice ID |

---

## 7. Testing

### Python Tests

```bash
python gateway/main.py          # Runs async tests (OHID resolution, repo, signatures)
pip install -e .[test]          # Install pytest
pytest gateway/tests/            # Pytest suite (when test files exist)
```

### VoltAgent Tests (40 tests, all passing)

```bash
cd voltagent
npm test                        # vitest run (40 tests)
npm run test:watch              # vitest watch mode
npm run test:coverage           # vitest + V8 coverage
npm run lint                    # tsc --noEmit (type checking)
```

**Test breakdown:**
| File | Tests | Coverage |
|------|-------|----------|
| `tools.test.ts` | 14 | All 7 tools, RPC transport, error handling, argument forwarding |
| `retry-queue.test.ts` | 7 | Enqueue, retry success, max retries → dead letter, executor registration |
| `metrics.test.ts` | 11 | All metric types, time windows, trends, uptime, downtime, trimming |
| `webhook-listener.test.ts` | 8 | Route registration, pipeline processing, retry integration, metrics |

---

## 8. Commands Reference

### Gateway

```bash
# Local dev
pip install -e ".[test]"
MCP_AUTH_TOKEN=your-token uvicorn gateway.main:create_app --host 0.0.0.0 --port 8000

# Docker
docker compose up --build                                              # gateway only
docker compose -f docker-compose.yml -f docker-compose.voltagent.yml up --build  # full stack
```

### VoltAgent

```bash
cd voltagent
npm install                           # install dependencies
npm run dev                           # tsx watch (hot reload)
npm run start                         # tsx (production)
npm run build                         # tsc compile
npm test                              # run 40 tests
npm run test:coverage                 # tests + coverage

# Workflow scripts (require running gateway)
npm run workflow:ops                  # health check pipeline
npm run workflow:lead                 # lead ingestion sample
npm run workflow:security             # webhook validation sample
npm run workflow:webhook-lead         # validate → ingest → notify
npm run workflow:health-monitor       # periodic health (add -- --interval 30)
npm run workflow:full-pipeline        # all 7 tools, 4 phases
npm run workflow:runner               # overnight automation scheduler
```

### Infrastructure

```bash
cd infra && terraform init && terraform plan     # Azure
cd infra/aws && terraform init && terraform plan # AWS
```

---

## 9. Deployment Options

| Method | What it starts | Ports |
|--------|---------------|-------|
| Local dev | Gateway + VoltAgent separately | 8000, 3141 |
| `docker compose up` | Gateway only | 8000 |
| Full compose | Gateway + VoltAgent | 8000, 3141 |
| Azure ACI (Terraform) | Gateway container | 8000 |
| AWS ECS Fargate (Terraform) | Gateway behind ALB | 80 → 8000 |

**Production requirements:** PostgreSQL database, all webhook secrets configured, at least one LLM API key, n8n webhook URL.

---

## 10. Git History & Conventions

**Current branch:** `claude/voltagen-setup-eFz0J`

**Recent commits (newest first):**
```
ecd031e chore: add coverage/ to .gitignore
8c59574 fix: resolve gateway circular import and lead_ingest timestamp error
b8895fd feat: add webhook listener, retry queue, metrics store, and overnight automation
081d935 feat: add automation workflows connecting all 7 gateway tools
a97d89c feat: add tool-boundary hardening, pin ElevenLabs, add audit scripts
7aa755d feat: add tests, guardrails, hooks, workflows, and Docker for VoltAgent
7155d43 feat: add VoltAgent v2 AI agent with MCP gateway integration
cb4b1cb infra: add Azure Key Vault with managed identity for centralised secrets
e34da90 feat: replace CloudTalk with WhatsApp & Twilio webhook integrations
8c214da feat: Simple MCP Gateway with RPC endpoint and 6 tools
```

**Commit style:** Conventional commits (`feat:`, `fix:`, `chore:`, `infra:`, `docs:`). Descriptive, scoped, rebased before merge.

**PR conventions:** Summary, linked issue/Notion task, verification steps, screenshots/logs for webhook flows.

---

## 11. Known Issues & Expected Warnings

| Issue | Severity | Explanation |
|-------|----------|-------------|
| `health_env` returns `degraded` in local dev | Expected | Missing PG, Twilio, WhatsApp, Notion, n8n secrets — these are production-only |
| `models.dev` DNS failure in sandbox | Info | VoltAgent model registry auto-refresh can't reach external DNS — non-blocking |
| `lead_ingest` uses `_FakeRepo` (in-memory) via MCP | By design | MCP server tool uses fake repo for dev; REST endpoint uses PostgresRepository |
| Gateway circular import (fixed) | Resolved | `main → mcp_router → mcp_server → main` — fixed via lazy import in `create_app()` |
| `elevenlabs` pinned to 1.59.0 | Workaround | Prevents `@elevenlabs/elevenlabs-js` transitive dependency from installing |

---

## 12. Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                  VoltOps Console                     │
│           console.voltagent.dev                      │
│  (traces, metrics, memory inspection, logs)          │
└──────────────────────┬──────────────────────────────┘
                       │ WebSocket / HTTP
                       ▼
┌─────────────────────────────────────────────────────┐
│            VoltAgent Server (Hono :3141)              │
│                                                       │
│  ┌─── Guardrails ──────────────────────────────────┐ │
│  │  input: length, injection, HTML, lead-schema    │ │
│  │  output: PII redaction, profanity, max-length   │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─── Hooks (Observability) ───────────────────────┐ │
│  │  onStart/End, onTool*, onHandoff*, onError      │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌───────────────────────────────────────────┐       │
│  │         opulent-supervisor (Agent)         │       │
│  │  Routes tasks to specialized sub-agents    │       │
│  └──────┬──────────┬──────────┬──────────────┘       │
│         │          │          │                       │
│  ┌──────▼──┐ ┌─────▼────┐ ┌──▼──────────┐           │
│  │ops-agent│ │lead-agent│ │security-agent│           │
│  │         │ │          │ │              │           │
│  │health_  │ │lead_     │ │twilio_       │           │
│  │ping/env │ │ingest    │ │whatsapp_     │           │
│  │n8n_     │ │          │ │notion_       │           │
│  │trigger  │ │          │ │validators    │           │
│  └────┬────┘ └────┬─────┘ └──────┬───────┘           │
│       └───────────┴──────────────┘                   │
│                    │ JSON-RPC 2.0                     │
│                    ▼                                 │
│  ┌─────────────────────────────────────────┐         │
│  │  7 Zod-typed tools (tools.ts)           │         │
│  │  + MCPConfiguration (HTTP transport)    │         │
│  └──────────────────┬──────────────────────┘         │
│                     │                                │
│  ┌──────────────────┴──────────────────────┐         │
│  │  Memory (LibSQL / Supabase)              │         │
│  │  Logger (Pino)  │  SDK (VoltOps traces) │         │
│  └─────────────────────────────────────────┘         │
│                                                       │
│  ┌─── Webhook Listener ───────────────────────────┐ │
│  │  POST /webhooks/twilio, /whatsapp, /notion      │ │
│  │  GET  /metrics, /webhooks/status, /retry-queue  │ │
│  │  RetryQueue + MetricsStore                      │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP POST (Bearer auth)
                       ▼
┌─────────────────────────────────────────────────────┐
│         Opulent MCP Gateway (FastAPI :8000)           │
│                                                       │
│  /api/rpc (JSON-RPC 2.0)                             │
│    ├── health_ping                                    │
│    ├── health_env                                     │
│    ├── lead_ingest                                    │
│    ├── twilio_webhook_validator                       │
│    ├── whatsapp_webhook_validator                     │
│    ├── notion_webhook_validator                       │
│    └── n8n_workflow_trigger                           │
│                                                       │
│  /api/lead/ingest          (REST)                    │
│  /api/twilio/webhook       (REST)                    │
│  /api/whatsapp/webhook     (REST)                    │
│  /api/notion/webhook       (REST)                    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
              PostgreSQL / n8n / External Services
```

---

## 13. Quick Reference for AI Assistants

When working on this project:

- **Gateway changes** → Edit files in `gateway/`, run `python gateway/main.py` to test
- **VoltAgent changes** → Edit files in `voltagent/src/`, run `npm test` and `npm run lint`
- **New tools** → Add to `gateway/mcp_server.py` (list_tools + call_tool), then mirror in `voltagent/src/tools.ts` with Zod schema
- **New agents** → Add to `voltagent/src/index.ts`, register with supervisor's `subAgents`
- **New workflows** → Add to `voltagent/src/workflows/`, add npm script in `package.json`
- **Infrastructure** → Terraform in `infra/` (Azure) or `infra/aws/` (AWS)
- **Secrets** → Never commit. Use `.env` locally, Azure Key Vault or AWS Secrets Manager in production
- **Coding style** → Python: Black, snake_case. TypeScript: strict, ESM, Zod schemas for all tool inputs
- **Commit style** → `feat:`, `fix:`, `chore:`, `infra:`, `docs:` prefixes
