# VoltAgent Setup — Opulent MCP Gateway Agent

A VoltAgent v2 TypeScript AI agent platform that orchestrates the Opulent MCP
Gateway's tools through a multi-agent supervisor architecture, with VoltOps
observability, durable memory, guardrails, and voice capabilities.

---

## Installed Packages & Project Alignment

### Core Framework

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `@voltagent/core` | 2.6.1 | Agent runtime, tool registry, memory, MCPConfiguration, supervisor patterns, guardrails, hooks | **Core** — defines 4 agents wrapping all 7 MCP gateway tools with input/output guardrails and observability hooks |
| `ai` | 6.x | Vercel AI SDK v6 — peer dependency for @voltagent/core v2, provides LLM abstraction | **Required** — bridges AI SDK model providers to VoltAgent's agent runtime |
| `zod` | 3.x | Schema validation for tool parameters | **Core** — every gateway tool has Zod-typed input schemas matching the Python MCP server's JSON schemas |
| `dotenv` | 16.x | Environment variable loading | **Core** — loads MCP_GATEWAY_URL, MCP_AUTH_TOKEN, API keys |

### Server & Observability

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `@voltagent/server-hono` | 2.0.7 | Hono HTTP server — exposes agent API for VoltOps console | **Active** — runs on port 3141, enables real-time agent monitoring via VoltOps console |
| `@voltagent/sdk` | 2.0.2 | VoltOps observability SDK — traces, spans, performance metrics | **Active** — production observability for agent interactions with the gateway |
| `@voltagent/logger` | 2.0.2 | Pino-based structured logging | **Active** — structured JSON logs for agent startup, tool calls, handoffs, and errors via hooks |

### Memory & Persistence

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `@voltagent/libsql` | 2.1.2 | LibSQL/Turso memory adapter — durable agent memory across sessions | **Active** — agents remember prior lead ingestions, health check history, and webhook validation results |
| `@voltagent/supabase` | 2.1.3 | Supabase memory adapter — alternative to LibSQL | **Ready** — drop-in replacement; swap one import to use Supabase for memory storage |

### AI Model Providers

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `@ai-sdk/openai` | 3.x | OpenAI model provider (GPT-4o-mini default) | **Active** — primary model for agent reasoning |
| `@ai-sdk/anthropic` | 3.x | Anthropic Claude model provider (fallback) | **Active** — automatic fallback when OPENAI_API_KEY is not set |

### Voice & Advanced

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `@voltagent/voice` | 2.1.0 | Text-to-speech and speech-to-text | **Ready** — voice-driven lead ingestion and status reporting |
| `@voltagent/xsai` | 0.3.4 | xsAI provider integration | **Ready** — alternative AI provider for specialized models |
| `@voltagent/docs-mcp` | 2.0.2 | MCP documentation server for LLM coding assistants | **Ready** — teaches Claude/Cursor how to use VoltAgent in this project |

### Testing & Developer Tools

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `vitest` | 4.x | Fast unit test runner | **Active** — 14 passing tests covering all 7 tools + RPC transport |
| `@vitest/coverage-v8` | 4.x | Code coverage via V8 | **Active** — coverage reports for tool and guardrail code |
| `@voltagent/cli` | 0.1.21 | CLI tooling for VoltAgent projects | **Dev** — scaffolding and management |
| `tsx` | 4.x | TypeScript execution without build step | **Dev** — `npm run dev` for hot-reload |
| `typescript` | 5.9.x | TypeScript compiler | **Dev** — strict type checking |

---

## API Keys & Configuration

### Required (at least one LLM provider)

| Variable | Where to get it | Used by |
|----------|-----------------|---------|
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Primary LLM provider (GPT-4o-mini). Agent reasoning, tool selection, response generation. |
| `ANTHROPIC_API_KEY` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) | Fallback LLM provider (Claude Sonnet). Used automatically when OPENAI_API_KEY is absent. |

### Required (gateway connection)

| Variable | Where to get it | Used by |
|----------|-----------------|---------|
| `MCP_GATEWAY_URL` | Set to `http://localhost:8000/api/rpc` for local dev | All 7 tools — the JSON-RPC endpoint the agent calls |
| `MCP_AUTH_TOKEN` | Must match the gateway's `MCP_AUTH_TOKEN` in `.env` | Bearer token sent with every RPC call to the gateway |

### Optional (memory persistence)

| Variable | Where to get it | Used by |
|----------|-----------------|---------|
| `LIBSQL_URL` | Default: `file:./voltagent-memory.db` (local SQLite). For Turso: [turso.tech](https://turso.tech) | `@voltagent/libsql` — durable agent memory |
| `LIBSQL_AUTH_TOKEN` | Turso dashboard → Database → Tokens | Only needed for remote Turso databases |
| `SUPABASE_URL` | [supabase.com](https://supabase.com) → Project Settings → API | `@voltagent/supabase` — alternative memory backend |
| `SUPABASE_KEY` | Supabase dashboard → API → anon/public key | `@voltagent/supabase` — authentication |

### Optional (voice)

| Variable | Where to get it | Used by |
|----------|-----------------|---------|
| `ELEVENLABS_API_KEY` | [elevenlabs.io](https://elevenlabs.io) → Profile → API Key | `@voltagent/voice` — ElevenLabs voice provider |
| `ELEVENLABS_VOICE_ID` | ElevenLabs dashboard → Voices | `@voltagent/voice` — specific voice selection |

### Optional (VoltOps console)

| Variable | Where to get it | Used by |
|----------|-----------------|---------|
| `VOLTAGENT_PORT` | Default: `3141` | `@voltagent/server-hono` — Hono server port for VoltOps |

### Gateway-side variables (must be set on the Python gateway)

These are **not** set in the VoltAgent `.env` — they're configured on the Python
MCP Gateway and are used when the agent invokes webhook validation tools:

| Variable | Purpose |
|----------|---------|
| `TWILIO_AUTH_TOKEN` | HMAC-SHA1 secret for `twilio_webhook_validator` |
| `WHATSAPP_APP_SECRET` | HMAC-SHA256 secret for `whatsapp_webhook_validator` |
| `NOTION_WEBHOOK_SECRET` | HMAC-SHA256 secret for `notion_webhook_validator` |
| `N8N_WEBHOOK_URL` | Target URL for `n8n_workflow_trigger` |
| `PGHOST`, `PGPORT`, etc. | PostgreSQL connection for lead persistence |

---

## Testing

### Unit tests (14 tests, all passing)

```bash
cd voltagent

# Run all tests
npm test

# Run with watch mode
npm run test:watch

# Run with coverage report
npm run test:coverage
```

**Test coverage includes:**
- All 7 gateway tools (mocked gateway responses)
- RPC transport layer (headers, URL, JSON-RPC envelope)
- Error handling (MCP error codes)
- Tool argument forwarding (required + optional fields)
- Tool count and uniqueness validation

### Sample workflow scripts

```bash
# Operations health check (ping → env → n8n trigger)
npm run workflow:ops

# Lead ingestion pipeline (3 leads with OHID deduplication)
npm run workflow:lead

# Webhook signature validation (Twilio, WhatsApp, Notion)
npm run workflow:security
```

**Note:** Workflow scripts require the Python MCP Gateway to be running.

---

## Guardrails

All agents are protected by input and output guardrails:

### Input guardrails (all agents)

| Guardrail | What it does |
|-----------|-------------|
| `createInputLengthGuardrail` | Blocks inputs > 10,000 characters |
| `createPromptInjectionGuardrail` | Detects and blocks prompt injection attempts |
| `createHTMLSanitizerInputGuardrail` | Strips HTML/script tags from inputs |
| `leadSchemaGuardrail` (custom) | Validates source_system and channel against allowed values |

### Output guardrails

| Applied to | Guardrails |
|-----------|-----------|
| lead-agent, security-agent | `createDefaultPIIGuardrails()` — email redactor, phone redactor, sensitive number redactor |
| opulent-supervisor | `createDefaultSafetyGuardrails()` — profanity filter + PII redaction + max length |

---

## Hooks (Observability)

All agents emit structured logs through lifecycle hooks:

| Hook | What it logs |
|------|-------------|
| `onStart` | Agent activation |
| `onEnd` | Agent completion (with conversation ID, success/failure) |
| `onToolStart` | Tool invocation (tool name) |
| `onToolEnd` | Tool result (preview of output) |
| `onToolError` | Tool failure (error message) |
| `onError` | Agent-level errors |
| `onHandoff` (supervisor) | Task delegation to sub-agent |
| `onHandoffComplete` (supervisor) | Sub-agent result received |
| `onStepFinish` (supervisor) | Step-by-step execution progress |

---

## Docker (Full Stack)

Run both the Python MCP Gateway and VoltAgent together:

```bash
docker compose -f docker-compose.yml -f docker-compose.voltagent.yml up --build
```

This starts:
- **mcp-gateway** on port 8000 (Python FastAPI)
- **voltagent** on port 3141 (TypeScript agent, auto-connects to gateway)

---

## Architecture

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

## File Structure

```
voltagent/
├── src/
│   ├── index.ts              # Main entry — 4 agents with guardrails + hooks
│   ├── tools.ts              # 7 Zod-typed tools wrapping gateway RPC
│   ├── guardrails.ts         # Input/output guardrails (PII, injection, schema)
│   ├── hooks.ts              # Observability hooks (lifecycle, tool, handoff)
│   ├── tools.test.ts         # 14 unit tests (vitest, mocked gateway)
│   └── workflows/
│       ├── ops-check.ts      # Sample: health + env + n8n trigger
│       ├── lead-ingest.ts    # Sample: 3 leads with OHID deduplication
│       └── webhook-validate.ts  # Sample: Twilio/WhatsApp/Notion validation
├── package.json              # All dependencies with test scripts
├── tsconfig.json             # Strict TypeScript (ES2022, bundler)
├── vitest.config.ts          # Vitest configuration
├── Dockerfile                # Node 22 slim container
├── .env.example              # All required/optional variables
├── .gitignore                # node_modules, dist, .db, .env
└── VOLTAGENT_SETUP.md        # This file
```
