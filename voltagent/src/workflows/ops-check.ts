/**
 * Sample Workflow: Operations Health Check
 *
 * Demonstrates a complete ops workflow that:
 * 1. Pings the gateway to verify connectivity
 * 2. Checks environment health for missing variables
 * 3. Triggers an n8n notification workflow with the results
 *
 * Usage:
 *   npm run workflow:ops
 *   # or: npx tsx src/workflows/ops-check.ts
 */

import "dotenv/config";
import {
  healthPingTool,
  healthEnvTool,
  n8nWorkflowTriggerTool,
} from "../tools.js";

async function runOpsCheck() {
  console.log("=== Opulent Gateway Operations Check ===\n");

  // Step 1: Ping
  console.log("1. Pinging gateway...");
  try {
    const ping = await healthPingTool.execute({}, {} as any);
    console.log("   Result:", JSON.stringify(ping, null, 2));
  } catch (err) {
    console.error(
      "   FAILED:",
      err instanceof Error ? err.message : String(err)
    );
    console.log(
      "\n   Ensure the gateway is running: uvicorn gateway.main:create_app --port 8000"
    );
    process.exit(1);
  }

  // Step 2: Environment health
  console.log("\n2. Checking environment health...");
  try {
    const env = await healthEnvTool.execute({}, {} as any);
    console.log("   Result:", JSON.stringify(env, null, 2));
  } catch (err) {
    console.error(
      "   FAILED:",
      err instanceof Error ? err.message : String(err)
    );
  }

  // Step 3: n8n notification (if configured)
  console.log("\n3. Triggering n8n notification...");
  try {
    const n8nResult = await n8nWorkflowTriggerTool.execute(
      {
        payload: {
          event_type: "HealthCheck",
          timestamp: new Date().toISOString(),
          source: "voltagent-ops-workflow",
          status: "completed",
        },
      },
      {} as any
    );
    console.log("   Result:", JSON.stringify(n8nResult, null, 2));
  } catch (err) {
    console.log(
      "   Skipped (N8N_WEBHOOK_URL not configured):",
      err instanceof Error ? err.message : String(err)
    );
  }

  console.log("\n=== Operations check complete ===");
}

runOpsCheck().catch(console.error);
