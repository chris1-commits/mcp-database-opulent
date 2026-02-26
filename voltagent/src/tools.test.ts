/**
 * Unit tests for all 7 MCP gateway tools.
 *
 * Each test mocks the global fetch to simulate JSON-RPC responses from the
 * Opulent MCP Gateway, verifying that tools correctly format requests,
 * handle success/error responses, and pass through typed arguments.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock fetch globally before importing tools ──────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Set env vars before tool module reads them
process.env.MCP_GATEWAY_URL = "http://test-gateway:8000/api/rpc";
process.env.MCP_AUTH_TOKEN = "test-token-abc123";

// Dynamic import so env/globals are set first
const {
  healthPingTool,
  healthEnvTool,
  leadIngestTool,
  twilioWebhookValidatorTool,
  whatsappWebhookValidatorTool,
  notionWebhookValidatorTool,
  n8nWorkflowTriggerTool,
  allGatewayTools,
} = await import("./tools.js");

// ── Helpers ─────────────────────────────────────────────────────

function mockRpcSuccess(result: unknown) {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({ jsonrpc: "2.0", result, id: "test-id" }),
  });
}

function mockRpcError(code: number, message: string) {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({
      jsonrpc: "2.0",
      error: { code, message },
      id: "test-id",
    }),
  });
}

function getLastRpcBody(): Record<string, unknown> {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return JSON.parse(call[1].body as string);
}

function getLastHeaders(): Record<string, string> {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return call[1].headers;
}

// ── Setup ───────────────────────────────────────────────────────

beforeEach(() => {
  mockFetch.mockReset();
});

// ── Tests ───────────────────────────────────────────────────────

describe("allGatewayTools", () => {
  it("exports exactly 7 tools", () => {
    expect(allGatewayTools).toHaveLength(7);
  });

  it("all tools have unique names", () => {
    const names = allGatewayTools.map((t) => t.name);
    expect(new Set(names).size).toBe(7);
  });
});

describe("RPC transport", () => {
  it("sends Authorization header with Bearer token", async () => {
    mockRpcSuccess({ status: "pong" });
    await healthPingTool.execute!({}, {} as any);
    const headers = getLastHeaders();
    expect(headers.Authorization).toBe("Bearer test-token-abc123");
  });

  it("sends to configured MCP_GATEWAY_URL", async () => {
    mockRpcSuccess({ status: "pong" });
    await healthPingTool.execute!({}, {} as any);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://test-gateway:8000/api/rpc",
      expect.any(Object)
    );
  });

  it("sends JSON-RPC 2.0 envelope with tools/call method", async () => {
    mockRpcSuccess({ status: "pong" });
    await healthPingTool.execute!({}, {} as any);
    const body = getLastRpcBody();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tools/call");
    expect(body.id).toBeDefined();
  });

  it("throws on MCP error response", async () => {
    mockRpcError(-32001, "MCP_AUTH_TOKEN is not set");
    await expect(healthPingTool.execute({}, {} as any)).rejects.toThrow(
      "MCP error -32001: MCP_AUTH_TOKEN is not set"
    );
  });
});

describe("health_ping", () => {
  it("calls health_ping with empty arguments", async () => {
    mockRpcSuccess({ status: "pong" });
    const result = await healthPingTool.execute!({}, {} as any);
    const body = getLastRpcBody();
    expect(body.params).toEqual({ name: "health_ping", arguments: {} });
    expect(result).toEqual({ status: "pong" });
  });
});

describe("health_env", () => {
  it("calls health_env and returns environment status", async () => {
    const envResult = {
      status: "degraded",
      missing_required: ["PGHOST"],
      missing_optional: ["ELEVENLABS_API_KEY"],
    };
    mockRpcSuccess(envResult);
    const result = await healthEnvTool.execute!({}, {} as any);
    expect(result).toEqual(envResult);
  });
});

describe("lead_ingest", () => {
  it("sends all required fields", async () => {
    mockRpcSuccess({ ohid: "ohid-123", ingest_id: "ingest-456" });
    const args = {
      source_system: "WEB",
      source_lead_id: "lead-001",
      channel: "WEB_FORM",
      first_name: "Alice",
      last_name: "Smith",
    };
    const result = await leadIngestTool.execute!(args, {} as any);
    const body = getLastRpcBody();
    expect(body.params).toEqual({ name: "lead_ingest", arguments: args });
    expect(result).toEqual({ ohid: "ohid-123", ingest_id: "ingest-456" });
  });

  it("sends optional email and phone", async () => {
    mockRpcSuccess({ ohid: "ohid-789", ingest_id: "ingest-012" });
    const args = {
      source_system: "WHATSAPP",
      source_lead_id: "lead-002",
      channel: "WHATSAPP",
      first_name: "Bob",
      last_name: "Jones",
      email: "bob@example.com",
      phone: "+1234567890",
    };
    await leadIngestTool.execute!(args, {} as any);
    const body = getLastRpcBody();
    expect((body.params as any)?.arguments).toMatchObject({
      email: "bob@example.com",
      phone: "+1234567890",
    });
  });
});

describe("twilio_webhook_validator", () => {
  it("sends url, params, and signature", async () => {
    mockRpcSuccess({ valid: true, parsed: { From: "+1111", To: "+2222" } });
    const args = {
      url: "https://example.com/twilio/webhook",
      params: { From: "+1111", To: "+2222", Body: "Hello" },
      signature: "abc123signature",
    };
    const result = await twilioWebhookValidatorTool.execute!(args, {} as any);
    const body = getLastRpcBody();
    expect((body.params as any)?.name).toBe("twilio_webhook_validator");
    expect(result).toEqual({
      valid: true,
      parsed: { From: "+1111", To: "+2222" },
    });
  });
});

describe("whatsapp_webhook_validator", () => {
  it("sends body and signature", async () => {
    const whatsappBody = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ from: "123" }] } }] }],
    });
    mockRpcSuccess({ valid: true, messages: [{ from: "123" }] });
    const args = { body: whatsappBody, signature: "sha256=abc" };
    const result = await whatsappWebhookValidatorTool.execute!(args, {} as any);
    expect(result).toEqual({ valid: true, messages: [{ from: "123" }] });
  });
});

describe("notion_webhook_validator", () => {
  it("sends body and signature", async () => {
    mockRpcSuccess({ valid: false });
    const args = { body: '{"type":"page.created"}', signature: "sha256=bad" };
    const result = await notionWebhookValidatorTool.execute!(args, {} as any);
    expect(result).toEqual({ valid: false });
  });
});

describe("n8n_workflow_trigger", () => {
  it("sends payload to n8n", async () => {
    mockRpcSuccess({ status_code: 200, body: '{"ok":true}' });
    const args = {
      payload: { event_type: "LeadIngested", ohid: "ohid-test" },
    };
    const result = await n8nWorkflowTriggerTool.execute!(args, {} as any);
    const body = getLastRpcBody();
    expect((body.params as any)?.arguments).toEqual(args);
    expect(result).toEqual({ status_code: 200, body: '{"ok":true}' });
  });
});
