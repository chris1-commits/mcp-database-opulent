# VoltAgent Setup — Opulent MCP Gateway Agent

A VoltAgent v2 TypeScript AI agent platform that orchestrates the Opulent MCP
Gateway's tools through a multi-agent supervisor architecture, with VoltOps
observability, durable memory, and voice capabilities.

---

## Installed Packages & Project Alignment

### Core Framework

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `@voltagent/core` | 2.6.1 | Agent runtime, tool registry, memory, MCPConfiguration, supervisor patterns | **Core** — defines 4 agents that wrap all 7 MCP gateway tools (health_ping, health_env, lead_ingest, twilio/whatsapp/notion validators, n8n trigger) |
| `ai` | 6.x | Vercel AI SDK v6 — peer dependency for @voltagent/core v2, provides LLM call abstraction | **Required** — bridges AI SDK model providers to VoltAgent's agent runtime |
| `zod` | 3.x | Schema validation for tool parameters | **Core** — every gateway tool has Zod-typed input schemas matching the Python MCP server's JSON schemas |
| `dotenv` | 16.x | Environment variable loading | **Core** — loads MCP_GATEWAY_URL, MCP_AUTH_TOKEN, API keys |

### Server & Observability

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `@voltagent/server-hono` | 2.0.7 | Hono-based HTTP server — exposes agent API for VoltOps console | **Active** — runs on port 3141, enables real-time agent monitoring via VoltOps console at console.voltagent.dev |
| `@voltagent/sdk` | 2.0.2 | VoltOps observability SDK — execution traces, spans, performance metrics | **Active** — provides production observability for agent interactions with the gateway (traces lead ingests, webhook validations, n8n triggers) |
| `@voltagent/logger` | 2.0.2 | Pino-based structured logging | **Active** — structured JSON logs for agent startup, tool calls, and errors |

### Memory & Persistence

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `@voltagent/libsql` | 2.1.2 | LibSQL/Turso memory adapter — durable agent memory across sessions | **Active** — agents remember prior lead ingestions, health check history, and webhook validation results across restarts |
| `@voltagent/supabase` | 2.1.3 | Supabase memory adapter — alternative to LibSQL | **Available** — drop-in replacement if team prefers Supabase for memory storage; swappable via config |

### AI Model Providers

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `@ai-sdk/openai` | 3.x | OpenAI model provider (GPT-4o-mini default) | **Active** — primary model for agent reasoning over gateway tools |
| `@ai-sdk/anthropic` | 3.x | Anthropic Claude model provider (fallback) | **Active** — automatic fallback when OPENAI_API_KEY is not set |

### Voice & Advanced

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `@voltagent/voice` | 2.1.0 | Text-to-speech and speech-to-text | **Ready** — enables voice-driven lead ingestion and webhook status reporting (e.g. call agents, ask "check gateway health") |
| `@voltagent/xsai` | 0.3.4 | xsAI provider integration | **Available** — alternative AI provider for specialized models |
| `@voltagent/docs-mcp` | 2.0.2 | MCP documentation server for LLM coding assistants | **Available** — teaches Claude/Cursor/Windsurf how to use VoltAgent when developing this project |

### Developer Tools

| Package | Version | Purpose | Alignment with Opulent Gateway |
|---------|---------|---------|-------------------------------|
| `@voltagent/cli` | 0.1.21 | CLI tooling for VoltAgent projects | **Dev** — project scaffolding and management |
| `tsx` | 4.x | TypeScript execution without build step | **Dev** — `npm run dev` for hot-reload development |
| `typescript` | 5.9.x | TypeScript compiler | **Dev** — type checking and compilation |
| `@types/node` | 22.x | Node.js type definitions | **Dev** — TypeScript type support |

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
│  │  MCPConfiguration (HTTP transport)       │         │
│  │  + 7 Zod-typed custom tools              │         │
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

## Quick Start

```bash
cd voltagent

# Install dependencies (already done)
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys and gateway URL

# Start the MCP gateway first (from project root)
cd .. && uvicorn gateway.main:create_app --host 0.0.0.0 --port 8000

# Start the VoltAgent (in another terminal)
cd voltagent && npm run dev
```

The agent server starts on `http://localhost:3141`. Open the VoltOps console at
`https://console.voltagent.dev` to interact with your agents, inspect memory,
and view execution traces.

---

## Agent Capabilities

### ops-agent
- **health_ping** — Ping the gateway to verify it's alive
- **health_env** — Report missing required/optional environment variables
- **n8n_workflow_trigger** — POST payloads to n8n automation workflows

### lead-agent
- **lead_ingest** — Ingest leads with OHID identity resolution
  - Supports: META, WEB, WHATSAPP, TWILIO, ZOHO_SOCIAL, ZOHO_CRM sources
  - Channels: WEB_FORM, META_LEAD_AD, INBOUND_CALL, WHATSAPP, SMS, etc.

### security-agent
- **twilio_webhook_validator** — HMAC-SHA1 signature validation
- **whatsapp_webhook_validator** — HMAC-SHA256 (X-Hub-Signature-256)
- **notion_webhook_validator** — HMAC-SHA256 (Notion-Signature)

### opulent-supervisor
- Routes tasks to the appropriate sub-agent
- Handles general queries directly
- Provides consolidated summaries

---

## Swapping Memory Providers

LibSQL (default):
```typescript
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
const memory = new Memory({
  storage: new LibSQLMemoryAdapter({ url: "file:./voltagent-memory.db" }),
});
```

Supabase:
```typescript
import { SupabaseMemoryAdapter } from "@voltagent/supabase";
const memory = new Memory({
  storage: new SupabaseMemoryAdapter({
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_KEY!,
  }),
});
```

---

## Swapping AI Providers

OpenAI (default):
```typescript
import { openai } from "@ai-sdk/openai";
const model = openai("gpt-4o-mini");
```

Anthropic:
```typescript
import { anthropic } from "@ai-sdk/anthropic";
const model = anthropic("claude-sonnet-4-20250514");
```
