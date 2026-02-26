/**
 * Guardrails for the Opulent MCP Agent platform.
 *
 * Provides input/output safety layers that protect the gateway from:
 * - Prompt injection attacks
 * - PII leakage (email, phone, sensitive numbers)
 * - Profanity in agent outputs
 * - Oversized inputs that could overwhelm the gateway
 * - HTML/script injection in webhook payloads
 *
 * Uses VoltAgent v2 built-in guardrail factories plus a custom
 * guardrail for gateway-specific lead schema validation.
 */

import {
  createInputGuardrail,
  createInputLengthGuardrail,
  createPIIInputGuardrail,
  createPromptInjectionGuardrail,
  createHTMLSanitizerInputGuardrail,
  createDefaultPIIGuardrails,
  createDefaultSafetyGuardrails,
  type InputGuardrail,
  type OutputGuardrail,
} from "@voltagent/core";

// ── Built-in input guardrails ───────────────────────────────────

/** Blocks inputs exceeding 10,000 characters to prevent gateway abuse. */
export const inputLengthGuardrail = createInputLengthGuardrail({
  maxCharacters: 10_000,
});

/** Detects and blocks prompt injection attempts in user messages. */
export const promptInjectionGuardrail = createPromptInjectionGuardrail();

/** Detects PII (emails, phones, SSNs) in inputs and warns/blocks. */
export const piiInputGuardrail = createPIIInputGuardrail();

/** Strips HTML/script tags from inputs to prevent injection. */
export const htmlSanitizerGuardrail = createHTMLSanitizerInputGuardrail();

// ── Custom gateway-specific guardrails ──────────────────────────

const ALLOWED_SOURCES = new Set([
  "META",
  "WEB",
  "WHATSAPP",
  "TWILIO",
  "ZOHO_SOCIAL",
  "ZOHO_CRM",
]);
const ALLOWED_CHANNELS = new Set([
  "WEB_FORM",
  "META_LEAD_AD",
  "INBOUND_CALL",
  "OUTBOUND_CALL",
  "WHATSAPP",
  "SMS",
  "SOCIAL",
  "CRM",
]);

export const leadSchemaGuardrail: InputGuardrail = createInputGuardrail({
  name: "lead-schema-validator",
  description:
    "Validates lead ingest parameters against allowed source_system and channel values",
  handler: async ({ inputText }) => {
    const sourceMatch = inputText.match(/source_system['":\s]+(\w+)/i);
    if (sourceMatch && !ALLOWED_SOURCES.has(sourceMatch[1].toUpperCase())) {
      return {
        pass: false,
        action: "block" as const,
        message: `Invalid source_system "${sourceMatch[1]}". Allowed: ${[...ALLOWED_SOURCES].join(", ")}`,
      };
    }

    const channelMatch = inputText.match(/channel['":\s]+(\w+)/i);
    if (channelMatch && !ALLOWED_CHANNELS.has(channelMatch[1].toUpperCase())) {
      return {
        pass: false,
        action: "block" as const,
        message: `Invalid channel "${channelMatch[1]}". Allowed: ${[...ALLOWED_CHANNELS].join(", ")}`,
      };
    }

    return { pass: true };
  },
});

// ── Exports for agent configuration ─────────────────────────────

/** Input guardrails applied to all agents. */
export const inputGuardrails: InputGuardrail[] = [
  inputLengthGuardrail,
  promptInjectionGuardrail,
  htmlSanitizerGuardrail,
  leadSchemaGuardrail,
];

/** Output guardrails for agents that handle PII (lead-agent, security-agent). */
export const piiOutputGuardrails: OutputGuardrail<any>[] =
  createDefaultPIIGuardrails();

/** Output guardrails for the supervisor (general safety). */
export const supervisorOutputGuardrails: OutputGuardrail<any>[] =
  createDefaultSafetyGuardrails();
