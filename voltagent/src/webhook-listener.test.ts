/**
 * Unit tests for webhook listener pipeline functions.
 *
 * Tests the configureWebhookRoutes function by creating a standalone
 * Hono app, mounting the routes, and sending mock requests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RetryQueue } from "./retry-queue.js";
import { MetricsStore } from "./metrics.js";

// ── Mock fetch globally before importing webhook-listener ────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

process.env.MCP_GATEWAY_URL = "http://test-gateway:8000/api/rpc";
process.env.MCP_AUTH_TOKEN = "test-token";

function mockRpcSuccess(result: unknown) {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({ jsonrpc: "2.0", result, id: "test-id" }),
  });
}

// Dynamic import so mocks are in place
const { configureWebhookRoutes } = await import("./webhook-listener.js");

// ── Minimal Hono-like test harness ───────────────────────────────

interface Route {
  method: string;
  path: string;
  handler: (c: any) => Promise<any>;
}

function createTestApp() {
  const routes: Route[] = [];
  const app = {
    post: (path: string, handler: any) => routes.push({ method: "POST", path, handler }),
    get: (path: string, handler: any) => routes.push({ method: "GET", path, handler }),
  };
  return { app, routes };
}

function createMockContext(opts: {
  method: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}) {
  const headers = opts.headers ?? {};
  const query = opts.query ?? {};
  const params = opts.params ?? {};
  let jsonResult: any = null;
  let jsonStatus = 200;

  return {
    req: {
      url: opts.url ?? "http://localhost:3141/test",
      header: (name: string) => headers[name] ?? "",
      text: async () => opts.body ?? "",
      json: async () => JSON.parse(opts.body ?? "{}"),
      parseBody: async () => {
        try { return JSON.parse(opts.body ?? "{}"); } catch { return {}; }
      },
      param: (name: string) => params[name],
      query: (name: string) => query[name],
    },
    json: (data: any, status?: number) => {
      jsonResult = data;
      jsonStatus = status ?? 200;
      return { data: jsonResult, status: jsonStatus };
    },
    getResult: () => ({ data: jsonResult, status: jsonStatus }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("configureWebhookRoutes", () => {
  let retryQueue: RetryQueue;
  let metrics: MetricsStore;
  let routes: Route[];

  beforeEach(() => {
    mockFetch.mockReset();
    retryQueue = new RetryQueue({ maxRetries: 3, baseDelayMs: 100 });
    metrics = new MetricsStore();
    const { app, routes: r } = createTestApp();
    routes = r;
    configureWebhookRoutes(app, { retryQueue, metrics });
  });

  it("registers all expected routes", () => {
    const paths = routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain("POST /webhooks/twilio");
    expect(paths).toContain("POST /webhooks/whatsapp");
    expect(paths).toContain("POST /webhooks/notion");
    expect(paths).toContain("GET /webhooks/status");
    expect(paths).toContain("GET /metrics");
    expect(paths).toContain("GET /metrics/trends");
    expect(paths).toContain("GET /retry-queue");
    expect(paths).toContain("POST /retry-queue/:id/retry");
  });

  it("GET /webhooks/status returns queue stats", async () => {
    const route = routes.find((r) => r.path === "/webhooks/status")!;
    const ctx = createMockContext({ method: "GET" });
    const result = route.handler(ctx);
    expect(result.data.status).toBe("active");
    expect(result.data.retryQueue).toBeDefined();
  });

  it("GET /metrics returns snapshot", async () => {
    metrics.recordHealth({
      timestamp: new Date().toISOString(),
      gatewayAlive: true, latencyMs: 42, envStatus: "ok", missingRequired: [],
    });

    const route = routes.find((r) => r.path === "/metrics")!;
    const ctx = createMockContext({ method: "GET" });
    const result = route.handler(ctx);
    expect(result.data.health).toBe(1);
    expect(result.data.trends).toBeDefined();
  });

  it("GET /metrics/trends accepts minutes parameter", async () => {
    const route = routes.find((r) => r.path === "/metrics/trends")!;
    const ctx = createMockContext({ method: "GET", query: { minutes: "30" } });
    const result = route.handler(ctx);
    expect(result.data.period).toBe("last 30m");
  });

  it("POST /webhooks/twilio processes a Twilio webhook", async () => {
    // Mock: validator call, lead_ingest call, n8n_trigger call
    mockRpcSuccess({ valid: true, parsed: { From: "+44" } });
    mockRpcSuccess({ ohid: "ohid-twilio-1", ingest_id: "ingest-1" });
    mockRpcSuccess({ status_code: 200 });

    const route = routes.find((r) => r.path === "/webhooks/twilio")!;
    const ctx = createMockContext({
      method: "POST",
      url: "http://localhost:3141/webhooks/twilio",
      headers: {
        "X-Twilio-Signature": "test-sig",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        From: "+447700900001",
        To: "+442071234567",
        Body: "Test message",
        MessageSid: "SM001",
        ProfileName: "Test User",
      }),
    });

    const result = await route.handler(ctx);
    expect(result.data.provider).toBe("twilio");
    expect(result.data.leadIngested).toBe(true);
    expect(result.data.ohid).toBe("ohid-twilio-1");

    // Check metrics were recorded
    const webhookMetrics = metrics.getWebhooksSince(5);
    expect(webhookMetrics).toHaveLength(1);
    expect(webhookMetrics[0].provider).toBe("twilio");
  });

  it("POST /webhooks/whatsapp processes a WhatsApp webhook", async () => {
    mockRpcSuccess({ valid: true });
    mockRpcSuccess({ ohid: "ohid-wa-1", ingest_id: "ingest-2" });
    mockRpcSuccess({ status_code: 200 });

    const waBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          value: {
            contacts: [{ profile: { name: "WA User" } }],
            messages: [{
              from: "447700900007",
              type: "text",
              text: { body: "Hello" },
            }],
          },
        }],
      }],
    });

    const route = routes.find((r) => r.path === "/webhooks/whatsapp")!;
    const ctx = createMockContext({
      method: "POST",
      headers: { "X-Hub-Signature-256": "sha256=test" },
      body: waBody,
    });

    const result = await route.handler(ctx);
    expect(result.data.provider).toBe("whatsapp");
    expect(result.data.leadIngested).toBe(true);
  });

  it("POST /webhooks/notion validates without ingesting a lead", async () => {
    mockRpcSuccess({ valid: true });
    mockRpcSuccess({ status_code: 200 });

    const route = routes.find((r) => r.path === "/webhooks/notion")!;
    const ctx = createMockContext({
      method: "POST",
      headers: { "Notion-Signature": "sha256=test" },
      body: JSON.stringify({ type: "page.created", id: "evt-001" }),
    });

    const result = await route.handler(ctx);
    expect(result.data.provider).toBe("notion");
    expect(result.data.leadIngested).toBe(false);
    expect(result.data.signatureValid).toBe(true);
  });

  it("enqueues to retry queue when lead ingest fails", async () => {
    // Validator succeeds, lead_ingest fails, n8n fails
    mockRpcSuccess({ valid: true });
    mockFetch.mockRejectedValueOnce(new Error("Gateway timeout"));
    mockFetch.mockRejectedValueOnce(new Error("n8n down"));

    const route = routes.find((r) => r.path === "/webhooks/twilio")!;
    const ctx = createMockContext({
      method: "POST",
      url: "http://localhost:3141/webhooks/twilio",
      headers: {
        "X-Twilio-Signature": "sig",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        From: "+440000000000",
        Body: "Retry test",
        ProfileName: "Retry User",
      }),
    });

    const result = await route.handler(ctx);
    expect(result.data.leadIngested).toBe(false);
    expect(retryQueue.getStats().pending).toBe(1);

    retryQueue.stop();
  });
});
