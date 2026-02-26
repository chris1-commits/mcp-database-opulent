/**
 * Agent lifecycle hooks for observability and operational intelligence.
 *
 * Provides structured logging for:
 * - Agent start/end lifecycle
 * - Tool execution tracing (which tools, output, duration)
 * - Error tracking with context
 * - Sub-agent handoff monitoring
 * - Step-by-step execution visibility
 *
 * All hooks emit structured logs via @voltagent/logger for VoltOps
 * console ingestion and local debugging.
 */

import { createHooks, type AgentHooks } from "@voltagent/core";
import { createPinoLogger } from "@voltagent/logger";

const log = createPinoLogger({ level: "info" });

/**
 * Hooks for sub-agents (ops, lead, security).
 * Traces tool calls and errors at the individual agent level.
 */
export const subAgentHooks: AgentHooks = createHooks({
  onStart: async ({ agent }) => {
    log.info(`[${agent.name}] started`);
  },

  onEnd: async ({ agent, conversationId, error }) => {
    if (error) {
      log.error(`[${agent.name}] failed — conversation: ${conversationId}`);
    } else {
      log.info(`[${agent.name}] completed — conversation: ${conversationId}`);
    }
  },

  onToolStart: async ({ agent, tool }) => {
    log.info(`[${agent.name}] tool:start → ${tool.name}`);
  },

  onToolEnd: async ({ agent, tool, output }) => {
    const preview =
      typeof output === "string"
        ? output.slice(0, 100)
        : JSON.stringify(output).slice(0, 100);
    log.info(`[${agent.name}] tool:end → ${tool.name} — ${preview}`);
  },

  onToolError: async ({ agent, tool, error }) => {
    log.error(
      `[${agent.name}] tool:error → ${tool.name} — ${error instanceof Error ? error.message : String(error)}`
    );
  },

  onError: async ({ agent, error }) => {
    log.error(
      `[${agent.name}] error — ${error instanceof Error ? error.message : String(error)}`
    );
  },
});

/**
 * Hooks for the supervisor agent.
 * Adds handoff tracking on top of standard tracing.
 */
export const supervisorHooks: AgentHooks = createHooks({
  onStart: async ({ agent }) => {
    log.info(`[${agent.name}] supervisor started`);
  },

  onEnd: async ({ agent, conversationId, error }) => {
    if (error) {
      log.error(
        `[${agent.name}] supervisor failed — conversation: ${conversationId}`
      );
    } else {
      log.info(
        `[${agent.name}] supervisor completed — conversation: ${conversationId}`
      );
    }
  },

  onHandoff: async ({ agent, sourceAgent }) => {
    log.info(`[${sourceAgent.name}] handoff → ${agent.name}`);
  },

  onHandoffComplete: async ({ agent, sourceAgent, result }) => {
    const preview = result.slice(0, 100);
    log.info(
      `[${sourceAgent.name}] handoff complete ← ${agent.name} — ${preview}`
    );
  },

  onToolStart: async ({ agent, tool }) => {
    log.info(`[${agent.name}] tool:start → ${tool.name}`);
  },

  onToolEnd: async ({ agent, tool, output }) => {
    const preview =
      typeof output === "string"
        ? output.slice(0, 100)
        : JSON.stringify(output).slice(0, 100);
    log.info(`[${agent.name}] tool:end → ${tool.name} — ${preview}`);
  },

  onToolError: async ({ agent, tool, error }) => {
    log.error(
      `[${agent.name}] tool:error → ${tool.name} — ${error instanceof Error ? error.message : String(error)}`
    );
  },

  onStepFinish: async ({ agent, step }) => {
    log.info(`[${agent.name}] step finished — ${JSON.stringify(step).slice(0, 80)}`);
  },

  onError: async ({ agent, error }) => {
    log.error(
      `[${agent.name}] error — ${error instanceof Error ? error.message : String(error)}`
    );
  },
});
