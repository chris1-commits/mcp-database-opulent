/**
 * Automation Runner: Interval-based Task Scheduler
 *
 * A lightweight scheduler that runs multiple automation tasks at
 * configurable intervals. Designed for unattended deployment:
 *
 * Tasks:
 *   - Health check: every 60s (configurable)
 *   - Lead batch processing: every 300s (configurable)
 *   - Security audit: every 600s (configurable)
 *
 * Each task runs independently, logs results, and sends alerts
 * via n8n when thresholds are breached.
 *
 * Usage:
 *   npm run workflow:runner
 *   npm run workflow:runner -- --health-interval 30 --lead-interval 120
 *
 * Environment:
 *   RUNNER_HEALTH_INTERVAL   Health check interval in seconds (default: 60)
 *   RUNNER_LEAD_INTERVAL     Lead batch interval in seconds (default: 300)
 *   RUNNER_SECURITY_INTERVAL Security audit interval in seconds (default: 600)
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

// ── Configuration ─────────────────────────────────────────────────

function getInterval(envVar: string, flag: string, defaultSec: number): number {
  // Check CLI args first
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return parseInt(process.argv[idx + 1], 10);
  }
  // Then env var
  const envVal = process.env[envVar];
  if (envVal) return parseInt(envVal, 10);
  // Default
  return defaultSec;
}

const HEALTH_INTERVAL = getInterval("RUNNER_HEALTH_INTERVAL", "--health-interval", 60);
const LEAD_INTERVAL = getInterval("RUNNER_LEAD_INTERVAL", "--lead-interval", 300);
const SECURITY_INTERVAL = getInterval("RUNNER_SECURITY_INTERVAL", "--security-interval", 600);

// ── State ─────────────────────────────────────────────────────────

interface TaskState {
  name: string;
  lastRun: string | null;
  runCount: number;
  successCount: number;
  failCount: number;
  lastStatus: string;
}

const state: Record<string, TaskState> = {
  health: { name: "Health Check", lastRun: null, runCount: 0, successCount: 0, failCount: 0, lastStatus: "pending" },
  leads: { name: "Lead Batch", lastRun: null, runCount: 0, successCount: 0, failCount: 0, lastStatus: "pending" },
  security: { name: "Security Audit", lastRun: null, runCount: 0, successCount: 0, failCount: 0, lastStatus: "pending" },
};

function updateState(task: string, success: boolean, status: string) {
  const s = state[task];
  s.lastRun = new Date().toISOString();
  s.runCount++;
  if (success) s.successCount++;
  else s.failCount++;
  s.lastStatus = status;
}

// ── Tasks ─────────────────────────────────────────────────────────

async function healthTask() {
  const ts = new Date().toLocaleTimeString();
  console.log(`\n[${ts}] Running health check...`);

  try {
    const start = Date.now();
    await healthPingTool.execute!({}, {} as any);
    const latency = Date.now() - start;

    const env = (await healthEnvTool.execute!({}, {} as any)) as Record<string, unknown>;
    const envStatus = (env?.status as string) ?? "unknown";
    const missing = (env?.missing_required as string[]) ?? [];

    if (missing.length > 0 || latency > 5000) {
      // Alert on degradation
      try {
        await n8nWorkflowTriggerTool.execute!(
          {
            payload: {
              event_type: "HealthAlert",
              severity: latency > 5000 ? "warning" : "info",
              timestamp: new Date().toISOString(),
              source: "automation-runner",
              latency_ms: latency,
              env_status: envStatus,
              missing_required: missing,
            },
          },
          {} as any
        );
      } catch {
        // n8n not configured
      }
    }

    updateState("health", true, `UP (${latency}ms, env: ${envStatus})`);
    console.log(`  UP (${latency}ms) — env: ${envStatus}`);
  } catch (err) {
    updateState("health", false, "DOWN");
    console.log(`  DOWN: ${err instanceof Error ? err.message : String(err)}`);

    try {
      await n8nWorkflowTriggerTool.execute!(
        {
          payload: {
            event_type: "GatewayDown",
            severity: "critical",
            timestamp: new Date().toISOString(),
            source: "automation-runner",
          },
        },
        {} as any
      );
    } catch {
      // n8n not configured
    }
  }
}

async function leadBatchTask() {
  const ts = new Date().toLocaleTimeString();
  console.log(`\n[${ts}] Running lead batch processing...`);

  // Simulate batch: ingest a sample lead and verify pipeline works
  const batchId = `batch-${Date.now()}`;
  try {
    const result = (await leadIngestTool.execute!(
      {
        source_system: "WEB",
        source_lead_id: `${batchId}-heartbeat`,
        channel: "WEB_FORM",
        first_name: "System",
        last_name: "Heartbeat",
        email: "heartbeat@system.internal",
      },
      {} as any
    )) as Record<string, unknown>;

    updateState("leads", true, `OK (OHID: ${result?.ohid})`);
    console.log(`  Lead pipeline OK — OHID: ${result?.ohid}`);

    // Notify n8n
    try {
      await n8nWorkflowTriggerTool.execute!(
        {
          payload: {
            event_type: "LeadBatchComplete",
            timestamp: new Date().toISOString(),
            source: "automation-runner",
            batch_id: batchId,
            ohid: result?.ohid,
          },
        },
        {} as any
      );
    } catch {
      // n8n not configured
    }
  } catch (err) {
    updateState("leads", false, `FAIL: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`  Lead pipeline FAIL: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function securityAuditTask() {
  const ts = new Date().toLocaleTimeString();
  console.log(`\n[${ts}] Running security audit...`);

  const auditResults: Record<string, boolean> = {};

  // Test each webhook validator with sample data
  const validators = [
    {
      name: "twilio",
      fn: () =>
        twilioWebhookValidatorTool.execute!(
          {
            url: "https://audit.internal/twilio",
            params: { From: "+0000000000", Body: "audit" },
            signature: "audit-signature",
          },
          {} as any
        ),
    },
    {
      name: "whatsapp",
      fn: () =>
        whatsappWebhookValidatorTool.execute!(
          {
            body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
            signature: "sha256=audit",
          },
          {} as any
        ),
    },
    {
      name: "notion",
      fn: () =>
        notionWebhookValidatorTool.execute!(
          {
            body: JSON.stringify({ type: "audit", id: "audit-001" }),
            signature: "sha256=audit",
          },
          {} as any
        ),
    },
  ];

  let allReachable = true;
  for (const v of validators) {
    try {
      await v.fn();
      auditResults[v.name] = true;
      console.log(`  ${v.name}: reachable`);
    } catch {
      auditResults[v.name] = false;
      allReachable = false;
      console.log(`  ${v.name}: unreachable`);
    }
  }

  updateState(
    "security",
    allReachable,
    allReachable ? "All validators reachable" : "Some validators unreachable"
  );

  // Report to n8n
  try {
    await n8nWorkflowTriggerTool.execute!(
      {
        payload: {
          event_type: "SecurityAudit",
          timestamp: new Date().toISOString(),
          source: "automation-runner",
          all_reachable: allReachable,
          validators: auditResults,
        },
      },
      {} as any
    );
  } catch {
    // n8n not configured
  }
}

// ── Status display ────────────────────────────────────────────────

function printStatus() {
  console.log("\n" + "═".repeat(60));
  console.log("  Task".padEnd(20) + "Runs".padEnd(8) + "OK".padEnd(6) + "Fail".padEnd(8) + "Status");
  console.log("  " + "─".repeat(56));
  for (const s of Object.values(state)) {
    console.log(
      `  ${s.name.padEnd(18)}${String(s.runCount).padEnd(8)}${String(s.successCount).padEnd(6)}${String(s.failCount).padEnd(8)}${s.lastStatus}`
    );
  }
  console.log("═".repeat(60));
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║   Automation Runner                               ║");
  console.log("║   Scheduled tasks with n8n alerting               ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  console.log(`  Health check:    every ${HEALTH_INTERVAL}s`);
  console.log(`  Lead batch:      every ${LEAD_INTERVAL}s`);
  console.log(`  Security audit:  every ${SECURITY_INTERVAL}s`);
  console.log("\n  Press Ctrl+C to stop\n");

  // Run all tasks immediately on startup
  await healthTask();
  await leadBatchTask();
  await securityAuditTask();
  printStatus();

  // Schedule recurring tasks
  setInterval(async () => {
    await healthTask();
    printStatus();
  }, HEALTH_INTERVAL * 1000);

  setInterval(async () => {
    await leadBatchTask();
    printStatus();
  }, LEAD_INTERVAL * 1000);

  setInterval(async () => {
    await securityAuditTask();
    printStatus();
  }, SECURITY_INTERVAL * 1000);
}

main().catch(console.error);
