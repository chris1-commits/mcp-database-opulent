/**
 * Automation Workflow: Webhook → Lead Pipeline
 *
 * End-to-end pipeline that simulates what happens when an inbound webhook
 * arrives from Twilio, WhatsApp, or Notion:
 *
 * 1. Validate the webhook signature (security gate)
 * 2. Extract contact details from the webhook payload
 * 3. Ingest the lead through the gateway (OHID identity resolution)
 * 4. Trigger an n8n workflow to notify downstream systems
 *
 * This is the core automation loop for Monday's deployment — it connects
 * webhook validation, lead management, and workflow automation into a
 * single pipeline.
 *
 * Usage:
 *   npm run workflow:webhook-lead
 *   # or: npx tsx src/workflows/webhook-to-lead.ts
 */

import "dotenv/config";
import {
  healthPingTool,
  twilioWebhookValidatorTool,
  whatsappWebhookValidatorTool,
  leadIngestTool,
  n8nWorkflowTriggerTool,
} from "../tools.js";

// ── Types ─────────────────────────────────────────────────────────

interface PipelineResult {
  source: "twilio" | "whatsapp";
  webhookValid: boolean;
  lead?: Record<string, unknown>;
  n8nTriggered: boolean;
  error?: string;
}

// ── Contact extraction ────────────────────────────────────────────

function extractContactFromTwilio(params: Record<string, string>) {
  const phone = params.From ?? "";
  const nameParts = (params.ProfileName ?? "Unknown Contact").split(" ");
  return {
    first_name: nameParts[0] ?? "Unknown",
    last_name: nameParts.slice(1).join(" ") || "Unknown",
    phone,
  };
}

function extractContactFromWhatsApp(body: string) {
  const parsed = JSON.parse(body);
  const message = parsed?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const phone = message?.from ?? "";
  const contactName =
    parsed?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name ??
    "WhatsApp Contact";
  const nameParts = contactName.split(" ");
  return {
    first_name: nameParts[0] ?? "Unknown",
    last_name: nameParts.slice(1).join(" ") || "Unknown",
    phone: phone.startsWith("+") ? phone : `+${phone}`,
    message_text: message?.text?.body ?? "",
  };
}

// ── Twilio Pipeline ───────────────────────────────────────────────

async function twilioToLeadPipeline(): Promise<PipelineResult> {
  console.log("── Twilio → Lead Pipeline ──\n");

  const webhookUrl = "https://your-domain.com/api/twilio/webhook";
  const params = {
    AccountSid: "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    From: "+447700900001",
    To: "+442071234567",
    Body: "Hi, I saw your listing for the 3-bed flat. Is it still available?",
    MessageSid: "SM0000000000000000000000000000001",
    ProfileName: "Sarah Connor",
  };
  const signature = "sample-twilio-signature-base64";

  // Step 1: Validate webhook
  console.log("  1. Validating Twilio webhook signature...");
  let webhookValid = false;
  try {
    const result = (await twilioWebhookValidatorTool.execute!(
      { url: webhookUrl, params, signature },
      {} as any
    )) as Record<string, unknown>;
    webhookValid = result?.valid === true;
    console.log(`     Signature valid: ${webhookValid}`);
  } catch (err) {
    console.log(
      `     Validation error (expected with sample data): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Step 2: Extract contact from payload
  console.log("  2. Extracting contact from Twilio payload...");
  const contact = extractContactFromTwilio(params);
  console.log(`     Contact: ${contact.first_name} ${contact.last_name} (${contact.phone})`);

  // Step 3: Ingest lead
  console.log("  3. Ingesting lead via gateway...");
  let lead: Record<string, unknown> | undefined;
  try {
    lead = (await leadIngestTool.execute!(
      {
        source_system: "TWILIO",
        source_lead_id: `twilio-${params.MessageSid}`,
        channel: "INBOUND_CALL",
        first_name: contact.first_name,
        last_name: contact.last_name,
        phone: contact.phone,
      },
      {} as any
    )) as Record<string, unknown>;
    console.log(`     OHID: ${lead?.ohid ?? "unknown"}`);
    console.log(`     Ingest ID: ${lead?.ingest_id ?? "unknown"}`);
  } catch (err) {
    console.error(`     Lead ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    return { source: "twilio", webhookValid, n8nTriggered: false, error: String(err) };
  }

  // Step 4: Trigger n8n notification
  console.log("  4. Triggering n8n workflow notification...");
  let n8nTriggered = false;
  try {
    await n8nWorkflowTriggerTool.execute!(
      {
        payload: {
          event_type: "LeadIngested",
          source: "twilio",
          ohid: lead?.ohid,
          ingest_id: lead?.ingest_id,
          contact_name: `${contact.first_name} ${contact.last_name}`,
          phone: contact.phone,
          message: params.Body,
          timestamp: new Date().toISOString(),
          pipeline: "webhook-to-lead",
        },
      },
      {} as any
    );
    n8nTriggered = true;
    console.log("     n8n notified successfully");
  } catch (err) {
    console.log(`     n8n skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { source: "twilio", webhookValid, lead, n8nTriggered };
}

// ── WhatsApp Pipeline ─────────────────────────────────────────────

async function whatsappToLeadPipeline(): Promise<PipelineResult> {
  console.log("\n── WhatsApp → Lead Pipeline ──\n");

  const waBody = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "987654321",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              contacts: [{ profile: { name: "James Bond" } }],
              messages: [
                {
                  from: "447700900007",
                  id: "wamid.pipeline001",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "I'd like to book a viewing for the penthouse" },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  });
  const signature = "sha256=sample-whatsapp-hmac-hex";

  // Step 1: Validate webhook
  console.log("  1. Validating WhatsApp webhook signature...");
  let webhookValid = false;
  try {
    const result = (await whatsappWebhookValidatorTool.execute!(
      { body: waBody, signature },
      {} as any
    )) as Record<string, unknown>;
    webhookValid = result?.valid === true;
    console.log(`     Signature valid: ${webhookValid}`);
  } catch (err) {
    console.log(
      `     Validation error (expected with sample data): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Step 2: Extract contact
  console.log("  2. Extracting contact from WhatsApp payload...");
  const contact = extractContactFromWhatsApp(waBody);
  console.log(`     Contact: ${contact.first_name} ${contact.last_name} (${contact.phone})`);
  console.log(`     Message: "${contact.message_text}"`);

  // Step 3: Ingest lead
  console.log("  3. Ingesting lead via gateway...");
  let lead: Record<string, unknown> | undefined;
  try {
    lead = (await leadIngestTool.execute!(
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
    console.log(`     OHID: ${lead?.ohid ?? "unknown"}`);
  } catch (err) {
    console.error(`     Lead ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    return { source: "whatsapp", webhookValid, n8nTriggered: false, error: String(err) };
  }

  // Step 4: Trigger n8n
  console.log("  4. Triggering n8n workflow notification...");
  let n8nTriggered = false;
  try {
    await n8nWorkflowTriggerTool.execute!(
      {
        payload: {
          event_type: "LeadIngested",
          source: "whatsapp",
          ohid: lead?.ohid,
          ingest_id: lead?.ingest_id,
          contact_name: `${contact.first_name} ${contact.last_name}`,
          phone: contact.phone,
          message: contact.message_text,
          timestamp: new Date().toISOString(),
          pipeline: "webhook-to-lead",
        },
      },
      {} as any
    );
    n8nTriggered = true;
    console.log("     n8n notified successfully");
  } catch (err) {
    console.log(`     n8n skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { source: "whatsapp", webhookValid, lead, n8nTriggered };
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║   Webhook → Lead Automation Pipeline              ║");
  console.log("║   Validates, extracts, ingests, and notifies      ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  // Pre-flight: confirm gateway is reachable
  console.log("Pre-flight: Pinging gateway...");
  try {
    await healthPingTool.execute!({}, {} as any);
    console.log("Gateway is alive.\n");
  } catch (err) {
    console.error(`Gateway unreachable: ${err instanceof Error ? err.message : String(err)}`);
    console.log("Start the gateway: uvicorn gateway.main:create_app --port 8000\n");
    process.exit(1);
  }

  const results: PipelineResult[] = [];

  // Run both pipelines
  results.push(await twilioToLeadPipeline());
  results.push(await whatsappToLeadPipeline());

  // Summary
  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║   Pipeline Summary                                ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");
  for (const r of results) {
    const status = r.error ? "FAILED" : "OK";
    console.log(`  ${r.source.toUpperCase()}: ${status}`);
    console.log(`    Webhook valid: ${r.webhookValid}`);
    if (r.lead) console.log(`    OHID: ${r.lead.ohid}`);
    console.log(`    n8n notified: ${r.n8nTriggered}`);
    if (r.error) console.log(`    Error: ${r.error}`);
    console.log();
  }
}

main().catch(console.error);
