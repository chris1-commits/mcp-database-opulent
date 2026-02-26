/**
 * Automation Workflow: Scheduled Health Monitor
 *
 * Runs periodic health checks against the gateway and alerts via n8n
 * when degradation is detected:
 *
 * 1. Ping gateway (connectivity check)
 * 2. Check environment health (missing vars)
 * 3. Compare against previous state to detect changes
 * 4. Alert via n8n if status degrades or recovers
 *
 * Supports two modes:
 * - Single run: `npm run workflow:health-monitor`
 * - Continuous: `npm run workflow:health-monitor -- --interval 60`
 *   (checks every 60 seconds)
 *
 * Usage:
 *   npm run workflow:health-monitor
 *   npm run workflow:health-monitor -- --interval 30
 */

import "dotenv/config";
import {
  healthPingTool,
  healthEnvTool,
  n8nWorkflowTriggerTool,
} from "../tools.js";

// ── Types ─────────────────────────────────────────────────────────

interface HealthSnapshot {
  timestamp: string;
  gatewayAlive: boolean;
  envStatus: string;
  missingRequired: string[];
  missingOptional: string[];
  latencyMs: number;
}

interface AlertPayload {
  event_type: string;
  severity: "critical" | "warning" | "info" | "recovery";
  timestamp: string;
  source: string;
  details: Record<string, unknown>;
}

// ── Health check logic ────────────────────────────────────────────

async function checkHealth(): Promise<HealthSnapshot> {
  const timestamp = new Date().toISOString();

  // Ping with latency measurement
  let gatewayAlive = false;
  const pingStart = Date.now();
  try {
    await healthPingTool.execute!({}, {} as any);
    gatewayAlive = true;
  } catch {
    // Gateway unreachable
  }
  const latencyMs = Date.now() - pingStart;

  // Environment check
  let envStatus = "unknown";
  let missingRequired: string[] = [];
  let missingOptional: string[] = [];

  if (gatewayAlive) {
    try {
      const env = (await healthEnvTool.execute!({}, {} as any)) as Record<
        string,
        unknown
      >;
      envStatus = (env?.status as string) ?? "unknown";
      missingRequired = (env?.missing_required as string[]) ?? [];
      missingOptional = (env?.missing_optional as string[]) ?? [];
    } catch {
      envStatus = "error";
    }
  }

  return {
    timestamp,
    gatewayAlive,
    envStatus,
    missingRequired,
    missingOptional,
    latencyMs,
  };
}

// ── Alert logic ───────────────────────────────────────────────────

function detectAlerts(
  current: HealthSnapshot,
  previous: HealthSnapshot | null
): AlertPayload[] {
  const alerts: AlertPayload[] = [];
  const ts = current.timestamp;

  // Gateway down
  if (!current.gatewayAlive) {
    alerts.push({
      event_type: "GatewayDown",
      severity: "critical",
      timestamp: ts,
      source: "health-monitor",
      details: { latencyMs: current.latencyMs },
    });
  }

  // Gateway recovered
  if (current.gatewayAlive && previous && !previous.gatewayAlive) {
    alerts.push({
      event_type: "GatewayRecovered",
      severity: "recovery",
      timestamp: ts,
      source: "health-monitor",
      details: { downSince: previous.timestamp, latencyMs: current.latencyMs },
    });
  }

  // Environment degraded
  if (current.envStatus === "degraded" && previous?.envStatus !== "degraded") {
    alerts.push({
      event_type: "EnvironmentDegraded",
      severity: "warning",
      timestamp: ts,
      source: "health-monitor",
      details: {
        missingRequired: current.missingRequired,
        missingOptional: current.missingOptional,
      },
    });
  }

  // Environment recovered
  if (current.envStatus === "ok" && previous?.envStatus === "degraded") {
    alerts.push({
      event_type: "EnvironmentRecovered",
      severity: "recovery",
      timestamp: ts,
      source: "health-monitor",
      details: { previousMissing: previous.missingRequired },
    });
  }

  // High latency (> 5 seconds)
  if (current.gatewayAlive && current.latencyMs > 5000) {
    alerts.push({
      event_type: "HighLatency",
      severity: "warning",
      timestamp: ts,
      source: "health-monitor",
      details: { latencyMs: current.latencyMs },
    });
  }

  return alerts;
}

async function sendAlert(alert: AlertPayload): Promise<boolean> {
  try {
    await n8nWorkflowTriggerTool.execute!(
      { payload: alert as unknown as Record<string, unknown> },
      {} as any
    );
    return true;
  } catch {
    return false;
  }
}

// ── Display ───────────────────────────────────────────────────────

function printSnapshot(snapshot: HealthSnapshot) {
  const alive = snapshot.gatewayAlive ? "UP" : "DOWN";
  const aliveIcon = snapshot.gatewayAlive ? "[OK]" : "[!!]";

  console.log(`  ${aliveIcon} Gateway: ${alive} (${snapshot.latencyMs}ms)`);
  console.log(`  [..] Environment: ${snapshot.envStatus}`);

  if (snapshot.missingRequired.length > 0) {
    console.log(`  [!!] Missing required: ${snapshot.missingRequired.join(", ")}`);
  }
  if (snapshot.missingOptional.length > 0) {
    console.log(`  [--] Missing optional: ${snapshot.missingOptional.join(", ")}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function runOnce(previous: HealthSnapshot | null): Promise<HealthSnapshot> {
  const now = new Date().toLocaleTimeString();
  console.log(`\n[${now}] Running health check...`);

  const snapshot = await checkHealth();
  printSnapshot(snapshot);

  const alerts = detectAlerts(snapshot, previous);
  if (alerts.length > 0) {
    console.log(`  Alerts detected: ${alerts.length}`);
    for (const alert of alerts) {
      const sent = await sendAlert(alert);
      const status = sent ? "sent" : "failed (n8n not configured)";
      console.log(`    ${alert.severity.toUpperCase()}: ${alert.event_type} — ${status}`);
    }
  } else {
    console.log("  No alerts — system stable");
  }

  return snapshot;
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║   Gateway Health Monitor                          ║");
  console.log("║   Checks gateway health and alerts on changes     ║");
  console.log("╚═══════════════════════════════════════════════════╝");

  // Parse --interval flag
  const intervalIdx = process.argv.indexOf("--interval");
  const intervalSec =
    intervalIdx !== -1 ? parseInt(process.argv[intervalIdx + 1], 10) : 0;

  if (intervalSec > 0) {
    console.log(`\nContinuous mode: checking every ${intervalSec}s (Ctrl+C to stop)`);
    let previous: HealthSnapshot | null = null;
    const tick = async () => {
      previous = await runOnce(previous);
    };
    await tick();
    setInterval(tick, intervalSec * 1000);
  } else {
    console.log("\nSingle check mode (use --interval N for continuous)");
    await runOnce(null);
    console.log("\nDone.");
  }
}

main().catch(console.error);
