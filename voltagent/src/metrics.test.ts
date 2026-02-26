/**
 * Unit tests for MetricsStore.
 *
 * Tests metric recording, time-window queries, trend analysis,
 * downtime incident detection, and memory trimming.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MetricsStore } from "./metrics.js";

describe("MetricsStore", () => {
  let store: MetricsStore;

  beforeEach(() => {
    store = new MetricsStore(100);
  });

  // ── Recording ───────────────────────────────────────────────────

  it("records and retrieves health metrics", () => {
    store.recordHealth({
      timestamp: new Date().toISOString(),
      gatewayAlive: true,
      latencyMs: 42,
      envStatus: "ok",
      missingRequired: [],
    });

    const recent = store.getHealthSince(5);
    expect(recent).toHaveLength(1);
    expect(recent[0].latencyMs).toBe(42);
  });

  it("records and retrieves lead metrics", () => {
    store.recordLead({
      timestamp: new Date().toISOString(),
      source: "WEB",
      channel: "WEB_FORM",
      ohid: "ohid-abc",
      success: true,
      durationMs: 150,
    });

    const recent = store.getLeadsSince(5);
    expect(recent).toHaveLength(1);
    expect(recent[0].ohid).toBe("ohid-abc");
  });

  it("records and retrieves security metrics", () => {
    store.recordSecurity({
      timestamp: new Date().toISOString(),
      provider: "twilio",
      reachable: true,
      signatureValid: true,
      durationMs: 30,
    });

    const recent = store.getSecuritySince(5);
    expect(recent).toHaveLength(1);
    expect(recent[0].provider).toBe("twilio");
  });

  it("records and retrieves webhook metrics", () => {
    store.recordWebhook({
      timestamp: new Date().toISOString(),
      provider: "whatsapp",
      path: "/webhooks/whatsapp",
      statusCode: 200,
      pipelineResult: "ingested",
      durationMs: 200,
    });

    const recent = store.getWebhooksSince(5);
    expect(recent).toHaveLength(1);
    expect(recent[0].pipelineResult).toBe("ingested");
  });

  // ── Time window filtering ──────────────────────────────────────

  it("filters metrics by time window", () => {
    // Old metric (2 hours ago)
    store.recordHealth({
      timestamp: new Date(Date.now() - 120 * 60_000).toISOString(),
      gatewayAlive: true,
      latencyMs: 100,
      envStatus: "ok",
      missingRequired: [],
    });

    // Recent metric
    store.recordHealth({
      timestamp: new Date().toISOString(),
      gatewayAlive: true,
      latencyMs: 50,
      envStatus: "ok",
      missingRequired: [],
    });

    expect(store.getHealthSince(60)).toHaveLength(1);
    expect(store.getHealthSince(180)).toHaveLength(2);
  });

  // ── Trend analysis ─────────────────────────────────────────────

  it("generates trend report with correct uptime", () => {
    const now = Date.now();

    // 3 alive, 1 down
    store.recordHealth({
      timestamp: new Date(now - 30_000).toISOString(),
      gatewayAlive: true, latencyMs: 40, envStatus: "ok", missingRequired: [],
    });
    store.recordHealth({
      timestamp: new Date(now - 20_000).toISOString(),
      gatewayAlive: true, latencyMs: 60, envStatus: "ok", missingRequired: [],
    });
    store.recordHealth({
      timestamp: new Date(now - 10_000).toISOString(),
      gatewayAlive: false, latencyMs: 5000, envStatus: "unknown", missingRequired: [],
    });
    store.recordHealth({
      timestamp: new Date(now).toISOString(),
      gatewayAlive: true, latencyMs: 50, envStatus: "ok", missingRequired: [],
    });

    const trend = store.getTrend(5);
    expect(trend.healthChecks).toBe(4);
    expect(trend.uptimePercent).toBe(75);
    expect(trend.avgLatencyMs).toBe(50); // avg of 40, 60, 50
    expect(trend.maxLatencyMs).toBe(60);
  });

  it("detects downtime incidents", () => {
    const now = Date.now();

    store.recordHealth({
      timestamp: new Date(now - 40_000).toISOString(),
      gatewayAlive: true, latencyMs: 40, envStatus: "ok", missingRequired: [],
    });
    store.recordHealth({
      timestamp: new Date(now - 30_000).toISOString(),
      gatewayAlive: false, latencyMs: 5000, envStatus: "unknown", missingRequired: [],
    });
    store.recordHealth({
      timestamp: new Date(now - 20_000).toISOString(),
      gatewayAlive: false, latencyMs: 5000, envStatus: "unknown", missingRequired: [],
    });
    store.recordHealth({
      timestamp: new Date(now - 10_000).toISOString(),
      gatewayAlive: true, latencyMs: 50, envStatus: "ok", missingRequired: [],
    });

    const trend = store.getTrend(5);
    expect(trend.downtimeIncidents).toHaveLength(1);
    expect(trend.downtimeIncidents[0].endedAt).not.toBeNull();
    expect(trend.downtimeIncidents[0].durationMs).toBeGreaterThan(0);
  });

  it("reports ongoing downtime incident", () => {
    const now = Date.now();
    store.recordHealth({
      timestamp: new Date(now - 10_000).toISOString(),
      gatewayAlive: false, latencyMs: 5000, envStatus: "unknown", missingRequired: [],
    });

    const trend = store.getTrend(5);
    expect(trend.downtimeIncidents).toHaveLength(1);
    expect(trend.downtimeIncidents[0].endedAt).toBeNull();
  });

  // ── Snapshot ────────────────────────────────────────────────────

  it("provides a full snapshot with nested trends", () => {
    store.recordHealth({
      timestamp: new Date().toISOString(),
      gatewayAlive: true, latencyMs: 42, envStatus: "ok", missingRequired: [],
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.health).toBe(1);
    expect(snapshot.trends.last15m).toBeDefined();
    expect(snapshot.trends.last1h).toBeDefined();
    expect(snapshot.trends.last24h).toBeDefined();
  });

  // ── Memory trimming ────────────────────────────────────────────

  it("trims metrics when exceeding maxEntries", () => {
    const smallStore = new MetricsStore(5);
    for (let i = 0; i < 10; i++) {
      smallStore.recordHealth({
        timestamp: new Date().toISOString(),
        gatewayAlive: true,
        latencyMs: i * 10,
        envStatus: "ok",
        missingRequired: [],
      });
    }
    // Should only keep the last 5
    expect(smallStore.getHealthSince(5).length).toBeLessThanOrEqual(5);
  });

  // ── Lead stats in trends ───────────────────────────────────────

  it("counts leads and failures in trends", () => {
    store.recordLead({
      timestamp: new Date().toISOString(),
      source: "WEB", channel: "WEB_FORM", ohid: "ohid-1",
      success: true, durationMs: 100,
    });
    store.recordLead({
      timestamp: new Date().toISOString(),
      source: "TWILIO", channel: "SMS", ohid: null,
      success: false, durationMs: 200, error: "timeout",
    });

    const trend = store.getTrend(5);
    expect(trend.leadsIngested).toBe(1);
    expect(trend.leadFailures).toBe(1);
  });
});
