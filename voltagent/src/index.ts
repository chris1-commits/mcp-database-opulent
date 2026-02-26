/**
 * Opulent MCP Agent — VoltAgent v2 powered AI agent that orchestrates the
 * Opulent MCP Gateway's tools (lead ingest, webhook validation, n8n triggers).
 *
 * Packages used:
 *   @voltagent/core         – Agent runtime, tool registry, memory, MCPConfiguration
 *   @voltagent/server-hono  – Hono HTTP server for VoltOps console connectivity
 *   @voltagent/libsql       – Durable memory persistence via LibSQL / Turso
 *   @voltagent/logger       – Pino-based structured logging
 *   @voltagent/voice        – Voice capabilities (TTS / STT)
 *   @voltagent/sdk          – VoltOps observability SDK (traces, spans, logs)
 *   @voltagent/supabase     – Supabase memory adapter (alternative to LibSQL)
 *   @voltagent/xsai         – xsAI provider integration
 *   @voltagent/docs-mcp     – MCP documentation server for LLM coding assistants
 *   ai                      – Vercel AI SDK v6 core (peer dep for @voltagent/core v2)
 *   @ai-sdk/openai          – OpenAI model provider
 *   @ai-sdk/anthropic       – Anthropic Claude model provider
 */

import "dotenv/config";

import { VoltAgent, Agent, MCPConfiguration, Memory } from "@voltagent/core";
import { honoServer } from "@voltagent/server-hono";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { createPinoLogger } from "@voltagent/logger";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

import { allGatewayTools } from "./tools.js";

// ── Logger ──────────────────────────────────────────────────────

const logger = createPinoLogger({ level: "info" });

// ── Memory ──────────────────────────────────────────────────────
// Uses LibSQLMemoryAdapter for durable agent memory across sessions.
// For Supabase, swap to: import { SupabaseMemoryAdapter } from "@voltagent/supabase";

const memory = new Memory({
  storage: new LibSQLMemoryAdapter({
    url: process.env.LIBSQL_URL ?? "file:./voltagent-memory.db",
    authToken: process.env.LIBSQL_AUTH_TOKEN,
  }),
});

// ── MCP Configuration ───────────────────────────────────────────
// Connect directly to the Opulent MCP Gateway as an HTTP MCP server
// so the agent can also discover tools dynamically at runtime.

const mcpGatewayUrl =
  process.env.MCP_GATEWAY_URL ?? "http://localhost:8000/api/rpc";
const mcpAuthToken = process.env.MCP_AUTH_TOKEN ?? "";

const mcpConfig = new MCPConfiguration({
  servers: {
    opulentGateway: {
      type: "http",
      url: mcpGatewayUrl,
      requestInit: {
        headers: {
          Authorization: `Bearer ${mcpAuthToken}`,
        },
      },
    },
  },
});

// ── Model selection ─────────────────────────────────────────────
// VoltAgent v2: pass AI SDK models directly (no VercelAIProvider wrapper).
// Use OpenAI by default; fall back to Anthropic if OPENAI_API_KEY is missing.

const model = process.env.OPENAI_API_KEY
  ? openai("gpt-4o-mini")
  : anthropic("claude-sonnet-4-20250514");

// ── Port ────────────────────────────────────────────────────────

const port = parseInt(process.env.VOLTAGENT_PORT ?? "3141", 10);

// ── Agents ──────────────────────────────────────────────────────

/**
 * Gateway Operations Agent
 * Handles health checks, environment diagnostics, and n8n workflow triggers.
 */
const opsAgent = new Agent({
  name: "ops-agent",
  purpose:
    "Operations agent for gateway health monitoring, environment diagnostics, and n8n workflow automation.",
  instructions: `You are an operations assistant for the Opulent MCP Gateway.

Your responsibilities:
- Check gateway health using health_ping
- Report environment status using health_env
- Trigger n8n automation workflows using n8n_workflow_trigger
- Provide clear summaries of system status and any issues found

Always start by pinging the gateway to confirm connectivity.`,
  model,
  memory,
  tools: allGatewayTools,
});

/**
 * Lead Management Agent
 * Handles lead ingestion and OHID identity resolution.
 */
const leadAgent = new Agent({
  name: "lead-agent",
  purpose:
    "Lead management agent for ingesting leads, resolving identities (OHID), and managing contacts across channels.",
  instructions: `You are a lead management assistant for the Opulent MCP Gateway.

Your responsibilities:
- Ingest new leads using the lead_ingest tool
- Help users provide required fields: source_system, source_lead_id, channel, first_name, last_name
- Explain OHID (identity resolution) results
- Suggest appropriate source_system and channel values based on the context

Valid source_system values: META, WEB, WHATSAPP, TWILIO, ZOHO_SOCIAL, ZOHO_CRM
Valid channel values: WEB_FORM, META_LEAD_AD, INBOUND_CALL, OUTBOUND_CALL, WHATSAPP, SMS, SOCIAL, CRM`,
  model,
  memory,
  tools: allGatewayTools,
});

/**
 * Webhook Security Agent
 * Validates webhook signatures for Twilio, WhatsApp, and Notion.
 */
const securityAgent = new Agent({
  name: "security-agent",
  purpose:
    "Webhook security agent for validating signatures from Twilio (HMAC-SHA1), WhatsApp (HMAC-SHA256), and Notion (HMAC-SHA256).",
  instructions: `You are a webhook security assistant for the Opulent MCP Gateway.

Your responsibilities:
- Validate Twilio webhook signatures using twilio_webhook_validator (HMAC-SHA1, base64)
- Validate WhatsApp webhook signatures using whatsapp_webhook_validator (HMAC-SHA256)
- Validate Notion webhook signatures using notion_webhook_validator (HMAC-SHA256)
- Explain validation results and help debug signature mismatches
- Parse and summarize webhook payloads

When validating, always explain whether the signature is valid and what the parsed payload contains.`,
  model,
  memory,
  tools: allGatewayTools,
});

/**
 * Supervisor Agent
 * Coordinates the specialized sub-agents and handles general queries.
 */
const supervisorAgent = new Agent({
  name: "opulent-supervisor",
  purpose:
    "Supervisor agent that coordinates gateway operations, lead management, and webhook security agents.",
  instructions: `You are the supervisor agent for the Opulent MCP Gateway platform.

You coordinate three specialized agents:
1. **ops-agent** — Gateway health, environment checks, n8n workflow triggers
2. **lead-agent** — Lead ingestion, OHID identity resolution, contact management
3. **security-agent** — Webhook signature validation for Twilio, WhatsApp, Notion

Route tasks to the appropriate agent based on the request:
- Health/status/environment/n8n questions → ops-agent
- Lead ingestion/contact/identity questions → lead-agent
- Webhook validation/signature/security questions → security-agent
- General questions → answer directly using your own knowledge

Provide concise summaries of results from sub-agents.`,
  model,
  memory,
  subAgents: [opsAgent, leadAgent, securityAgent],
  tools: allGatewayTools,
});

// ── VoltAgent bootstrap ─────────────────────────────────────────

new VoltAgent({
  agents: {
    supervisor: supervisorAgent,
    ops: opsAgent,
    leads: leadAgent,
    security: securityAgent,
  },
  server: honoServer({ port }),
});

logger.info(
  `Opulent MCP Agent started on port ${port} — gateway: ${mcpGatewayUrl} — VoltOps: https://console.voltagent.dev`
);
