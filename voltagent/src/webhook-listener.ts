/**
 * Webhook Listener — Live inbound webhook endpoints.
 *
 * Adds Hono routes to the VoltAgent server that receive real webhooks
 * from Twilio, WhatsApp, and Notion, then feed them through the full
 * validate → extract → ingest → notify pipeline automatically.
 *
 * Endpoints:
 *   POST /webhooks/twilio    — Receive Twilio SMS/voice webhooks
 *   POST /webhooks/whatsapp  — Receive WhatsApp Cloud API webhooks
 *   POST /webhooks/notion    — Receive Notion webhooks
 *   GET  /webhooks/status    — Pipeline status and queue stats
 *   GET  /metrics            — Full metrics dashboard
 *   GET  /metrics/trends     — Trend report (query: ?minutes=60)
 *
 * Each webhook endpoint:
 * 1. Validates the signature via the MCP gateway
 * 2. Extracts contact details from the payload
 * 3. Ingests the lead (with retry queue on failure)
 * 4. Triggers n8n notification
 * 5. Records metrics
 */

import type { RetryQueue } from "./retry-queue.js";
import type { MetricsStore } from "./metrics.js";
import {
  twilioWebhookValidatorTool,
  whatsappWebhookValidatorTool,
  notionWebhookValidatorTool,
  leadIngestTool,
  n8nWorkflowTriggerTool,
} from "./tools.js";

// ── Types ─────────────────────────────────────────────────────────

export interface WebhookListenerDeps {
  retryQueue: RetryQueue;
  metrics: MetricsStore;
}

interface PipelineResult {
  provider: "twilio" | "whatsapp" | "notion";
  signatureValid: boolean;
  leadIngested: boolean;
  ohid?: string;
  n8nNotified: boolean;
  error?: string;
  durationMs: number;
}

// ── Contact extraction helpers ────────────────────────────────────

function extractTwilioContact(params: Record<string, string>) {
  const phone = params.From ?? "";
  const nameParts = (params.ProfileName ?? "Unknown Contact").split(" ");
  return {
    first_name: nameParts[0] ?? "Unknown",
    last_name: nameParts.slice(1).join(" ") || "Unknown",
    phone,
    message: params.Body ?? "",
  };
}

function extractWhatsAppContact(body: string) {
  try {
    const parsed = JSON.parse(body);
    const entry = parsed?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    const contact = change?.contacts?.[0]?.profile;
    const nameParts = (contact?.name ?? "WhatsApp Contact").split(" ");
    const phone = message?.from ?? "";
    return {
      first_name: nameParts[0] ?? "Unknown",
      last_name: nameParts.slice(1).join(" ") || "Unknown",
      phone: phone.startsWith("+") ? phone : `+${phone}`,
      message: message?.text?.body ?? "",
    };
  } catch {
    return {
      first_name: "Unknown",
      last_name: "WhatsApp",
      phone: "",
      message: "",
    };
  }
}

// ── Pipeline ──────────────────────────────────────────────────────

async function runTwilioPipeline(
  url: string,
  params: Record<string, string>,
  signature: string,
  deps: WebhookListenerDeps
): Promise<PipelineResult> {
  const start = Date.now();
  let signatureValid = false;
  let leadIngested = false;
  let ohid: string | undefined;
  let n8nNotified = false;

  try {
    // Validate
    const valResult = (await twilioWebhookValidatorTool.execute!(
      { url, params, signature },
      {} as any
    )) as Record<string, unknown>;
    signatureValid = valResult?.valid === true;
  } catch {
    // Validation tool may fail if gateway secrets aren't set
  }

  // Extract contact and ingest lead
  const contact = extractTwilioContact(params);
  try {
    const leadResult = (await leadIngestTool.execute!(
      {
        source_system: "TWILIO",
        source_lead_id: `twilio-${params.MessageSid ?? Date.now()}`,
        channel: params.MessageSid ? "SMS" : "INBOUND_CALL",
        first_name: contact.first_name,
        last_name: contact.last_name,
        phone: contact.phone,
      },
      {} as any
    )) as Record<string, unknown>;
    leadIngested = true;
    ohid = leadResult?.ohid as string;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.retryQueue.enqueue(
      "lead_ingest",
      {
        source_system: "TWILIO",
        source_lead_id: `twilio-retry-${Date.now()}`,
        channel: "SMS",
        first_name: contact.first_name,
        last_name: contact.last_name,
        phone: contact.phone,
      },
      msg
    );
  }

  // Notify n8n
  try {
    await n8nWorkflowTriggerTool.execute!(
      {
        payload: {
          event_type: "WebhookProcessed",
          provider: "twilio",
          ohid,
          contact: `${contact.first_name} ${contact.last_name}`,
          message: contact.message,
          timestamp: new Date().toISOString(),
        },
      },
      {} as any
    );
    n8nNotified = true;
  } catch {
    // n8n not configured
  }

  const durationMs = Date.now() - start;
  deps.metrics.recordWebhook({
    timestamp: new Date().toISOString(),
    provider: "twilio",
    path: "/webhooks/twilio",
    statusCode: leadIngested ? 200 : 500,
    pipelineResult: leadIngested ? "ingested" : "error",
    durationMs,
  });

  return { provider: "twilio", signatureValid, leadIngested, ohid, n8nNotified, durationMs };
}

async function runWhatsAppPipeline(
  body: string,
  signature: string,
  deps: WebhookListenerDeps
): Promise<PipelineResult> {
  const start = Date.now();
  let signatureValid = false;
  let leadIngested = false;
  let ohid: string | undefined;
  let n8nNotified = false;

  try {
    const valResult = (await whatsappWebhookValidatorTool.execute!(
      { body, signature },
      {} as any
    )) as Record<string, unknown>;
    signatureValid = valResult?.valid === true;
  } catch {
    // Validation may fail
  }

  const contact = extractWhatsAppContact(body);
  try {
    const leadResult = (await leadIngestTool.execute!(
      {
        source_system: "WHATSAPP",
        source_lead_id: `wa-${Date.now()}`,
        channel: "WHATSAPP",
        first_name: contact.first_name,
        last_name: contact.last_name,
        phone: contact.phone,
      },
      {} as any
    )) as Record<string, unknown>;
    leadIngested = true;
    ohid = leadResult?.ohid as string;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.retryQueue.enqueue(
      "lead_ingest",
      {
        source_system: "WHATSAPP",
        source_lead_id: `wa-retry-${Date.now()}`,
        channel: "WHATSAPP",
        first_name: contact.first_name,
        last_name: contact.last_name,
        phone: contact.phone,
      },
      msg
    );
  }

  try {
    await n8nWorkflowTriggerTool.execute!(
      {
        payload: {
          event_type: "WebhookProcessed",
          provider: "whatsapp",
          ohid,
          contact: `${contact.first_name} ${contact.last_name}`,
          message: contact.message,
          timestamp: new Date().toISOString(),
        },
      },
      {} as any
    );
    n8nNotified = true;
  } catch {
    // n8n not configured
  }

  const durationMs = Date.now() - start;
  deps.metrics.recordWebhook({
    timestamp: new Date().toISOString(),
    provider: "whatsapp",
    path: "/webhooks/whatsapp",
    statusCode: leadIngested ? 200 : 500,
    pipelineResult: leadIngested ? "ingested" : "error",
    durationMs,
  });

  return { provider: "whatsapp", signatureValid, leadIngested, ohid, n8nNotified, durationMs };
}

async function runNotionPipeline(
  body: string,
  signature: string,
  deps: WebhookListenerDeps
): Promise<PipelineResult> {
  const start = Date.now();
  let signatureValid = false;

  try {
    const valResult = (await notionWebhookValidatorTool.execute!(
      { body, signature },
      {} as any
    )) as Record<string, unknown>;
    signatureValid = valResult?.valid === true;
  } catch {
    // Validation may fail
  }

  // Notion webhooks are page events, not lead contacts — just validate and notify
  let n8nNotified = false;
  try {
    const parsed = JSON.parse(body);
    await n8nWorkflowTriggerTool.execute!(
      {
        payload: {
          event_type: "NotionWebhookReceived",
          provider: "notion",
          signature_valid: signatureValid,
          notion_event_type: parsed?.type ?? "unknown",
          notion_event_id: parsed?.id ?? "unknown",
          timestamp: new Date().toISOString(),
        },
      },
      {} as any
    );
    n8nNotified = true;
  } catch {
    // n8n not configured
  }

  const durationMs = Date.now() - start;
  deps.metrics.recordWebhook({
    timestamp: new Date().toISOString(),
    provider: "notion",
    path: "/webhooks/notion",
    statusCode: 200,
    pipelineResult: signatureValid ? "validated" : "rejected",
    durationMs,
  });

  return {
    provider: "notion",
    signatureValid,
    leadIngested: false,
    n8nNotified,
    durationMs,
  };
}

// ── Route configuration ───────────────────────────────────────────

/**
 * Configure webhook listener routes on a Hono app.
 * Called from index.ts via honoServer's configureApp callback.
 */
export function configureWebhookRoutes(
  app: any,
  deps: WebhookListenerDeps
) {
  // ── POST /webhooks/twilio ─────────────────────────────────────
  app.post("/webhooks/twilio", async (c: any) => {
    const url = c.req.url;
    const signature = c.req.header("X-Twilio-Signature") ?? "";
    let params: Record<string, string>;

    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await c.req.parseBody();
      params = Object.fromEntries(
        Object.entries(formData).map(([k, v]) => [k, String(v)])
      );
    } else {
      params = await c.req.json();
    }

    const result = await runTwilioPipeline(url, params, signature, deps);
    return c.json(result, result.leadIngested ? 200 : 500);
  });

  // ── POST /webhooks/whatsapp ───────────────────────────────────
  app.post("/webhooks/whatsapp", async (c: any) => {
    const signature = c.req.header("X-Hub-Signature-256") ?? "";
    const body = await c.req.text();
    const result = await runWhatsAppPipeline(body, signature, deps);
    return c.json(result, result.leadIngested ? 200 : 500);
  });

  // ── POST /webhooks/notion ─────────────────────────────────────
  app.post("/webhooks/notion", async (c: any) => {
    const signature = c.req.header("Notion-Signature") ?? "";
    const body = await c.req.text();
    const result = await runNotionPipeline(body, signature, deps);
    return c.json(result, 200);
  });

  // ── GET /webhooks/status ──────────────────────────────────────
  app.get("/webhooks/status", (c: any) => {
    return c.json({
      status: "active",
      endpoints: ["/webhooks/twilio", "/webhooks/whatsapp", "/webhooks/notion"],
      retryQueue: deps.retryQueue.getStats(),
      recentWebhooks: deps.metrics.getWebhooksSince(60).length,
    });
  });

  // ── GET /metrics ──────────────────────────────────────────────
  app.get("/metrics", (c: any) => {
    return c.json(deps.metrics.getSnapshot());
  });

  // ── GET /metrics/trends ───────────────────────────────────────
  app.get("/metrics/trends", (c: any) => {
    const minutes = parseInt(c.req.query("minutes") ?? "60", 10);
    return c.json(deps.metrics.getTrend(minutes));
  });

  // ── GET /retry-queue ──────────────────────────────────────────
  app.get("/retry-queue", (c: any) => {
    return c.json({
      stats: deps.retryQueue.getStats(),
      pending: deps.retryQueue.getPending(),
      deadLetters: deps.retryQueue.getDeadLetters(),
    });
  });

  // ── POST /retry-queue/:id/retry ───────────────────────────────
  app.post("/retry-queue/:id/retry", (c: any) => {
    const id = c.req.param("id");
    const success = deps.retryQueue.retryDeadLetter(id);
    return c.json({ success, id }, success ? 200 : 404);
  });
}
