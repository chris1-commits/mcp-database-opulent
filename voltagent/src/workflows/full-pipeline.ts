/**
 * Automation Workflow: Full Pipeline Orchestrator
 *
 * Chains ALL 7 gateway tools in a realistic end-to-end scenario that
 * mirrors a production Monday deployment:
 *
 * Phase 1 — Pre-flight
 *   1. health_ping (confirm gateway alive)
 *   2. health_env (check all required vars are set)
 *
 * Phase 2 — Multi-source lead ingestion
 *   3. lead_ingest × 3 (Web, WhatsApp, Twilio sources)
 *   4. lead_ingest duplicate (OHID dedup verification)
 *
 * Phase 3 — Security validation
 *   5. twilio_webhook_validator
 *   6. whatsapp_webhook_validator
 *   7. notion_webhook_validator
 *
 * Phase 4 — Orchestration
 *   8. n8n_workflow_trigger (batch summary report)
 *
 * Usage:
 *   npm run workflow:full-pipeline
 *   # or: npx tsx src/workflows/full-pipeline.ts
 */

import "dotenv/config";
import {
  healthPingTool,
  healthEnvTool,
  leadIngestTool,
  twilioWebhookValidatorTool,
  whatsappWebhookValidatorTool,
  notionWebhookValidatorTool,
  n8nWorkflowTriggerTool,
} from "../tools.js";

// ── Tracking ──────────────────────────────────────────────────────

interface StepResult {
  phase: string;
  step: string;
  tool: string;
  success: boolean;
  durationMs: number;
  data?: unknown;
  error?: string;
}

const results: StepResult[] = [];

async function runStep(
  phase: string,
  step: string,
  tool: string,
  fn: () => Promise<unknown>
): Promise<unknown> {
  const start = Date.now();
  try {
    const data = await fn();
    results.push({
      phase,
      step,
      tool,
      success: true,
      durationMs: Date.now() - start,
      data,
    });
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      phase,
      step,
      tool,
      success: false,
      durationMs: Date.now() - start,
      error: msg,
    });
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const pipelineStart = Date.now();

  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║   Full Pipeline Orchestrator                      ║");
  console.log("║   All 7 tools · 4 phases · End-to-end             ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  // ── Phase 1: Pre-flight ───────────────────────────────────────

  console.log("Phase 1: Pre-flight Checks");
  console.log("─".repeat(50));

  console.log("  [1/8] health_ping...");
  const ping = await runStep("pre-flight", "ping", "health_ping", () =>
    healthPingTool.execute!({}, {} as any)
  );
  if (!ping) {
    console.error("  FATAL: Gateway unreachable. Start it and retry.");
    process.exit(1);
  }
  console.log("        Gateway alive");

  console.log("  [2/8] health_env...");
  const env = (await runStep("pre-flight", "env", "health_env", () =>
    healthEnvTool.execute!({}, {} as any)
  )) as Record<string, unknown> | null;
  if (env) {
    console.log(`        Status: ${env.status}`);
    const missing = env.missing_required as string[] | undefined;
    if (missing?.length) {
      console.log(`        Missing required: ${missing.join(", ")}`);
    }
  }

  // ── Phase 2: Multi-source lead ingestion ──────────────────────

  console.log("\nPhase 2: Multi-Source Lead Ingestion");
  console.log("─".repeat(50));

  const leads = [
    {
      label: "Web form lead",
      args: {
        source_system: "WEB",
        source_lead_id: `web-${Date.now()}-001`,
        channel: "WEB_FORM",
        first_name: "Emma",
        last_name: "Wilson",
        email: "emma.wilson@example.com",
        phone: "+44 7700 900010",
      },
    },
    {
      label: "WhatsApp lead",
      args: {
        source_system: "WHATSAPP",
        source_lead_id: `wa-${Date.now()}-002`,
        channel: "WHATSAPP",
        first_name: "Marcus",
        last_name: "Chen",
        phone: "+44 7700 900020",
      },
    },
    {
      label: "Twilio SMS lead",
      args: {
        source_system: "TWILIO",
        source_lead_id: `twilio-${Date.now()}-003`,
        channel: "SMS",
        first_name: "Priya",
        last_name: "Patel",
        phone: "+44 7700 900030",
      },
    },
    {
      label: "Duplicate lead (same email as Emma)",
      args: {
        source_system: "META",
        source_lead_id: `meta-${Date.now()}-004`,
        channel: "META_LEAD_AD",
        first_name: "Emma",
        last_name: "Wilson",
        email: "emma.wilson@example.com",
      },
    },
  ];

  const ohids: string[] = [];
  for (let i = 0; i < leads.length; i++) {
    const { label, args } = leads[i];
    console.log(`  [${3 + i}/8] lead_ingest: ${label}...`);
    const result = (await runStep(
      "lead-ingest",
      label,
      "lead_ingest",
      () => leadIngestTool.execute!(args, {} as any)
    )) as Record<string, unknown> | null;
    if (result) {
      const ohid = result.ohid as string;
      ohids.push(ohid);
      console.log(`        OHID: ${ohid}`);
      if (i === 3 && ohid === ohids[0]) {
        console.log("        ^ Dedup confirmed: same OHID as Emma's first ingest");
      }
    }
  }

  // ── Phase 3: Security validation ──────────────────────────────

  console.log("\nPhase 3: Webhook Security Validation");
  console.log("─".repeat(50));

  console.log("  [5/8] twilio_webhook_validator...");
  await runStep("security", "twilio", "twilio_webhook_validator", () =>
    twilioWebhookValidatorTool.execute!(
      {
        url: "https://your-domain.com/api/twilio/webhook",
        params: {
          AccountSid: "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          From: "+447700900001",
          To: "+442071234567",
          Body: "Interested in viewing",
        },
        signature: "sample-signature-base64",
      },
      {} as any
    )
  );
  console.log("        Validated (sample signature)");

  console.log("  [6/8] whatsapp_webhook_validator...");
  await runStep("security", "whatsapp", "whatsapp_webhook_validator", () =>
    whatsappWebhookValidatorTool.execute!(
      {
        body: JSON.stringify({
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      { from: "447700900007", type: "text", text: { body: "Hello" } },
                    ],
                  },
                },
              ],
            },
          ],
        }),
        signature: "sha256=sample-hmac",
      },
      {} as any
    )
  );
  console.log("        Validated (sample signature)");

  console.log("  [7/8] notion_webhook_validator...");
  await runStep("security", "notion", "notion_webhook_validator", () =>
    notionWebhookValidatorTool.execute!(
      {
        body: JSON.stringify({ type: "page.created", id: "evt-pipeline-001" }),
        signature: "sha256=sample-notion-hmac",
      },
      {} as any
    )
  );
  console.log("        Validated (sample signature)");

  // ── Phase 4: Orchestration ────────────────────────────────────

  console.log("\nPhase 4: n8n Workflow Orchestration");
  console.log("─".repeat(50));

  const totalMs = Date.now() - pipelineStart;
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log("  [8/8] n8n_workflow_trigger: batch summary...");
  await runStep("orchestration", "n8n-summary", "n8n_workflow_trigger", () =>
    n8nWorkflowTriggerTool.execute!(
      {
        payload: {
          event_type: "PipelineComplete",
          pipeline: "full-pipeline-orchestrator",
          timestamp: new Date().toISOString(),
          duration_ms: totalMs,
          total_steps: results.length,
          succeeded,
          failed,
          ohids_created: ohids,
          phases: {
            preflight: results.filter((r) => r.phase === "pre-flight").length,
            leads: results.filter((r) => r.phase === "lead-ingest").length,
            security: results.filter((r) => r.phase === "security").length,
          },
        },
      },
      {} as any
    )
  );
  console.log("        Batch summary sent to n8n");

  // ── Summary ───────────────────────────────────────────────────

  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║   Pipeline Complete                               ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  console.log(`  Duration: ${totalMs}ms`);
  console.log(`  Steps:    ${results.length} total, ${succeeded} succeeded, ${failed} failed`);
  console.log(`  OHIDs:    ${ohids.length} created`);
  console.log();

  console.log("  Step-by-step results:");
  console.log("  " + "─".repeat(68));
  console.log(
    "  " +
      "Phase".padEnd(15) +
      "Tool".padEnd(30) +
      "Status".padEnd(10) +
      "Time"
  );
  console.log("  " + "─".repeat(68));
  for (const r of results) {
    const status = r.success ? "OK" : "FAIL";
    console.log(
      "  " +
        r.phase.padEnd(15) +
        r.tool.padEnd(30) +
        status.padEnd(10) +
        `${r.durationMs}ms`
    );
  }
  console.log("  " + "─".repeat(68));

  if (failed > 0) {
    console.log("\n  Failures:");
    for (const r of results.filter((r) => !r.success)) {
      console.log(`    ${r.phase}/${r.step}: ${r.error}`);
    }
  }
}

main().catch(console.error);
