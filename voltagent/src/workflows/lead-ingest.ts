/**
 * Sample Workflow: Lead Ingestion
 *
 * Demonstrates the lead ingestion pipeline:
 * 1. Ingests a web form lead with full contact details
 * 2. Ingests a WhatsApp lead (phone only, no email)
 * 3. Re-ingests the first lead to show OHID deduplication
 *
 * Usage:
 *   npm run workflow:lead
 *   # or: npx tsx src/workflows/lead-ingest.ts
 */

import "dotenv/config";
import { leadIngestTool } from "../tools.js";

async function runLeadIngest() {
  console.log("=== Lead Ingestion Workflow ===\n");

  // Step 1: Web form lead
  console.log("1. Ingesting web form lead (Alice Smith)...");
  try {
    const lead1 = await leadIngestTool.execute(
      {
        source_system: "WEB",
        source_lead_id: "web-lead-001",
        channel: "WEB_FORM",
        first_name: "Alice",
        last_name: "Smith",
        email: "alice.smith@example.com",
        phone: "+44 7700 900001",
      },
      {} as any
    );
    console.log("   OHID:", JSON.stringify(lead1, null, 2));
  } catch (err) {
    console.error(
      "   FAILED:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }

  // Step 2: WhatsApp lead
  console.log("\n2. Ingesting WhatsApp lead (Bob Jones)...");
  try {
    const lead2 = await leadIngestTool.execute(
      {
        source_system: "WHATSAPP",
        source_lead_id: "wa-lead-002",
        channel: "WHATSAPP",
        first_name: "Bob",
        last_name: "Jones",
        phone: "+44 7700 900002",
      },
      {} as any
    );
    console.log("   OHID:", JSON.stringify(lead2, null, 2));
  } catch (err) {
    console.error(
      "   FAILED:",
      err instanceof Error ? err.message : String(err)
    );
  }

  // Step 3: Duplicate lead (same email as Alice)
  console.log("\n3. Re-ingesting lead with same email (OHID deduplication)...");
  try {
    const lead3 = await leadIngestTool.execute(
      {
        source_system: "META",
        source_lead_id: "meta-lead-003",
        channel: "META_LEAD_AD",
        first_name: "Alice",
        last_name: "Smith-Updated",
        email: "alice.smith@example.com",
      },
      {} as any
    );
    console.log("   OHID (should match lead 1):", JSON.stringify(lead3, null, 2));
  } catch (err) {
    console.error(
      "   FAILED:",
      err instanceof Error ? err.message : String(err)
    );
  }

  console.log("\n=== Lead ingestion workflow complete ===");
}

runLeadIngest().catch(console.error);
