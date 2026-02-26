/**
 * Sample Workflow: Webhook Signature Validation
 *
 * Demonstrates validation for all three webhook providers:
 * 1. Twilio SMS webhook (HMAC-SHA1, base64)
 * 2. WhatsApp Cloud API webhook (HMAC-SHA256)
 * 3. Notion webhook (HMAC-SHA256)
 *
 * These use sample data — signatures will only validate if the gateway
 * has the matching secrets configured.
 *
 * Usage:
 *   npm run workflow:security
 *   # or: npx tsx src/workflows/webhook-validate.ts
 */

import "dotenv/config";
import {
  twilioWebhookValidatorTool,
  whatsappWebhookValidatorTool,
  notionWebhookValidatorTool,
} from "../tools.js";

async function runWebhookValidation() {
  console.log("=== Webhook Signature Validation Workflow ===\n");

  // Step 1: Twilio
  console.log("1. Validating Twilio SMS webhook signature...");
  try {
    const twilio = await twilioWebhookValidatorTool.execute(
      {
        url: "https://your-domain.com/api/twilio/webhook",
        params: {
          AccountSid: "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          From: "+15551234567",
          To: "+15559876543",
          Body: "Hi, I am interested in the property listing",
          MessageSid: "SM1234567890abcdef",
        },
        signature: "sample-twilio-signature-base64",
      },
      {} as any
    );
    console.log("   Valid:", JSON.stringify(twilio, null, 2));
  } catch (err) {
    console.error(
      "   FAILED:",
      err instanceof Error ? err.message : String(err)
    );
  }

  // Step 2: WhatsApp
  console.log("\n2. Validating WhatsApp Cloud API webhook signature...");
  try {
    const waBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "123456789",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                messages: [
                  {
                    from: "447700900001",
                    id: "wamid.abc123",
                    timestamp: "1709049600",
                    type: "text",
                    text: { body: "Please send me details on the 3-bed flat" },
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    });

    const whatsapp = await whatsappWebhookValidatorTool.execute(
      { body: waBody, signature: "sha256=sample-whatsapp-hmac-hex" },
      {} as any
    );
    console.log("   Valid:", JSON.stringify(whatsapp, null, 2));
  } catch (err) {
    console.error(
      "   FAILED:",
      err instanceof Error ? err.message : String(err)
    );
  }

  // Step 3: Notion
  console.log("\n3. Validating Notion webhook signature...");
  try {
    const notionBody = JSON.stringify({
      type: "page.created",
      id: "evt-abc123",
      data: {
        page_id: "page-xyz-789",
        title: "New lead from web form",
      },
    });

    const notion = await notionWebhookValidatorTool.execute(
      { body: notionBody, signature: "sha256=sample-notion-hmac-hex" },
      {} as any
    );
    console.log("   Valid:", JSON.stringify(notion, null, 2));
  } catch (err) {
    console.error(
      "   FAILED:",
      err instanceof Error ? err.message : String(err)
    );
  }

  console.log("\n=== Webhook validation workflow complete ===");
  console.log(
    "\nNote: Signatures above are samples. Real validation requires matching\n" +
      "TWILIO_AUTH_TOKEN, WHATSAPP_APP_SECRET, and NOTION_WEBHOOK_SECRET\n" +
      "configured on the Python gateway."
  );
}

runWebhookValidation().catch(console.error);
