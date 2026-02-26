/**
 * Custom Zod-typed tools that call the Opulent MCP Gateway's JSON-RPC endpoint.
 *
 * Each tool mirrors one of the 7 MCP server tools exposed at /api/rpc and
 * forwards arguments via JSON-RPC 2.0 over HTTP.  This lets VoltAgent agents
 * invoke the Python gateway natively while keeping full type-safety on the
 * TypeScript side.
 */

import { createTool } from "@voltagent/core";
import { z } from "zod";

// ── helpers ──────────────────────────────────────────────────────

const MCP_GATEWAY_URL =
  process.env.MCP_GATEWAY_URL ?? "http://localhost:8000/api/rpc";
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "";

interface RpcResponse {
  jsonrpc: string;
  result?: unknown;
  error?: { code: number; message: string };
  id: string;
}

async function rpcCall(toolName: string, args: Record<string, unknown> = {}) {
  const body = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };
  const res = await fetch(MCP_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MCP_AUTH_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as RpcResponse;
  if (json.error) {
    throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
  }
  return json.result;
}

// ── tools ────────────────────────────────────────────────────────

export const healthPingTool = createTool({
  name: "health_ping",
  description:
    "Ping the MCP gateway to check if it is alive and responding. Returns a pong status.",
  parameters: z.object({}),
  execute: async () => {
    return await rpcCall("health_ping");
  },
});

export const healthEnvTool = createTool({
  name: "health_env",
  description:
    "Report the MCP gateway environment health: lists any missing required or optional environment variables.",
  parameters: z.object({}),
  execute: async () => {
    return await rpcCall("health_env");
  },
});

export const leadIngestTool = createTool({
  name: "lead_ingest",
  description:
    "Validate and simulate a lead ingest through the MCP gateway. Creates an OHID (identity) and persists the lead in-memory. Requires source_system, source_lead_id, channel, first_name, and last_name.",
  parameters: z.object({
    source_system: z
      .string()
      .describe(
        "Origin system: META, WEB, WHATSAPP, TWILIO, ZOHO_SOCIAL, or ZOHO_CRM"
      ),
    source_lead_id: z.string().describe("Unique lead ID from the source system"),
    channel: z
      .string()
      .describe(
        "Acquisition channel: WEB_FORM, META_LEAD_AD, INBOUND_CALL, OUTBOUND_CALL, WHATSAPP, SMS, SOCIAL, or CRM"
      ),
    first_name: z.string().describe("Contact first name"),
    last_name: z.string().describe("Contact last name"),
    email: z.string().email().optional().describe("Contact email address"),
    phone: z.string().optional().describe("Contact phone number"),
  }),
  execute: async (args) => {
    return await rpcCall("lead_ingest", args);
  },
});

export const twilioWebhookValidatorTool = createTool({
  name: "twilio_webhook_validator",
  description:
    "Validate a Twilio webhook request signature (HMAC-SHA1, base64-encoded) against the gateway's TWILIO_AUTH_TOKEN. Parses the payload into a structured Twilio webhook model.",
  parameters: z.object({
    url: z.string().url().describe("Full request URL from the Twilio webhook"),
    params: z
      .record(z.string())
      .describe("POST form parameters as key-value pairs"),
    signature: z
      .string()
      .describe("X-Twilio-Signature header value from the request"),
  }),
  execute: async (args) => {
    return await rpcCall("twilio_webhook_validator", args);
  },
});

export const whatsappWebhookValidatorTool = createTool({
  name: "whatsapp_webhook_validator",
  description:
    "Validate a WhatsApp Cloud API webhook signature (HMAC-SHA256, X-Hub-Signature-256) against the gateway's WHATSAPP_APP_SECRET. Extracts messages from the webhook payload.",
  parameters: z.object({
    body: z.string().describe("Raw JSON body from the WhatsApp webhook request"),
    signature: z
      .string()
      .describe("X-Hub-Signature-256 header value from the request"),
  }),
  execute: async (args) => {
    return await rpcCall("whatsapp_webhook_validator", args);
  },
});

export const notionWebhookValidatorTool = createTool({
  name: "notion_webhook_validator",
  description:
    "Validate a Notion webhook signature (HMAC-SHA256, Notion-Signature header) against the gateway's NOTION_WEBHOOK_SECRET.",
  parameters: z.object({
    body: z.string().describe("Raw JSON body from the Notion webhook request"),
    signature: z
      .string()
      .describe("Notion-Signature header value from the request"),
  }),
  execute: async (args) => {
    return await rpcCall("notion_webhook_validator", args);
  },
});

export const n8nWorkflowTriggerTool = createTool({
  name: "n8n_workflow_trigger",
  description:
    "POST an arbitrary JSON payload to the n8n workflow webhook URL configured on the MCP gateway. Useful for triggering automation workflows from the agent.",
  parameters: z.object({
    payload: z
      .record(z.unknown())
      .describe("JSON payload to send to the n8n webhook"),
  }),
  execute: async (args) => {
    return await rpcCall("n8n_workflow_trigger", args);
  },
});

/** All gateway tools bundled for easy import. */
export const allGatewayTools = [
  healthPingTool,
  healthEnvTool,
  leadIngestTool,
  twilioWebhookValidatorTool,
  whatsappWebhookValidatorTool,
  notionWebhookValidatorTool,
  n8nWorkflowTriggerTool,
];
