/**
 * Metrics Store — In-memory metric aggregation with trend analysis.
 *
 * Collects health check results, latency measurements, lead pipeline
 * stats, and security audit results. Provides trend analysis so the
 * agent can report things like "gateway was down for 12 minutes at 3am"
 * or "average latency increased 40% in the last hour".
 *
 * Designed to be queried by the automation runner and exposed via the
 * webhook listener's /metrics endpoint.
 */

// ── Types ─────────────────────────────────────────────────────────

export interface HealthMetric {
  timestamp: string;
  gatewayAlive: boolean;
  latencyMs: number;
  envStatus: string;
  missingRequired: string[];
}

export interface LeadMetric {
  timestamp: string;
  source: string;
  channel: string;
  ohid: string | null;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface SecurityMetric {
  timestamp: string;
  provider: "twilio" | "whatsapp" | "notion";
  reachable: boolean;
  signatureValid: boolean | null;
  durationMs: number;
}

export interface WebhookMetric {
  timestamp: string;
  provider: "twilio" | "whatsapp" | "notion";
  path: string;
  statusCode: number;
  pipelineResult: "validated" | "rejected" | "ingested" | "error";
  durationMs: number;
}

export interface DowntimeIncident {
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

export interface TrendReport {
  period: string;
  healthChecks: number;
  uptimePercent: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  leadsIngested: number;
  leadFailures: number;
  securityAudits: number;
  webhooksProcessed: number;
  downtimeIncidents: DowntimeIncident[];
}

// ── Implementation ────────────────────────────────────────────────

export class MetricsStore {
  private healthMetrics: HealthMetric[] = [];
  private leadMetrics: LeadMetric[] = [];
  private securityMetrics: SecurityMetric[] = [];
  private webhookMetrics: WebhookMetric[] = [];

  /** Max entries per metric type (prevents unbounded memory growth). */
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  // ── Record methods ──────────────────────────────────────────────

  recordHealth(metric: HealthMetric) {
    this.healthMetrics.push(metric);
    this.trim(this.healthMetrics);
  }

  recordLead(metric: LeadMetric) {
    this.leadMetrics.push(metric);
    this.trim(this.leadMetrics);
  }

  recordSecurity(metric: SecurityMetric) {
    this.securityMetrics.push(metric);
    this.trim(this.securityMetrics);
  }

  recordWebhook(metric: WebhookMetric) {
    this.webhookMetrics.push(metric);
    this.trim(this.webhookMetrics);
  }

  // ── Query methods ───────────────────────────────────────────────

  /** Get metrics recorded in the last N minutes. */
  getHealthSince(minutes: number): HealthMetric[] {
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
    return this.healthMetrics.filter((m) => m.timestamp >= cutoff);
  }

  getLeadsSince(minutes: number): LeadMetric[] {
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
    return this.leadMetrics.filter((m) => m.timestamp >= cutoff);
  }

  getSecuritySince(minutes: number): SecurityMetric[] {
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
    return this.securityMetrics.filter((m) => m.timestamp >= cutoff);
  }

  getWebhooksSince(minutes: number): WebhookMetric[] {
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
    return this.webhookMetrics.filter((m) => m.timestamp >= cutoff);
  }

  // ── Trend analysis ──────────────────────────────────────────────

  /**
   * Generate a trend report for the specified time window.
   * @param minutes — lookback window in minutes
   */
  getTrend(minutes: number): TrendReport {
    const health = this.getHealthSince(minutes);
    const leads = this.getLeadsSince(minutes);
    const security = this.getSecuritySince(minutes);
    const webhooks = this.getWebhooksSince(minutes);

    // Uptime calculation
    const aliveChecks = health.filter((h) => h.gatewayAlive).length;
    const uptimePercent =
      health.length > 0 ? (aliveChecks / health.length) * 100 : 100;

    // Latency stats
    const latencies = health
      .filter((h) => h.gatewayAlive)
      .map((h) => h.latencyMs);
    const avgLatencyMs =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;
    const maxLatencyMs =
      latencies.length > 0 ? Math.max(...latencies) : 0;

    // Downtime incidents
    const downtimeIncidents = this.detectDowntimeIncidents(health);

    // Lead stats
    const leadsIngested = leads.filter((l) => l.success).length;
    const leadFailures = leads.filter((l) => !l.success).length;

    // Period label
    const periodLabel =
      minutes >= 1440
        ? `${Math.round(minutes / 1440)}d`
        : minutes >= 60
          ? `${Math.round(minutes / 60)}h`
          : `${minutes}m`;

    return {
      period: `last ${periodLabel}`,
      healthChecks: health.length,
      uptimePercent: Math.round(uptimePercent * 100) / 100,
      avgLatencyMs: Math.round(avgLatencyMs),
      maxLatencyMs,
      leadsIngested,
      leadFailures,
      securityAudits: security.length,
      webhooksProcessed: webhooks.length,
      downtimeIncidents,
    };
  }

  /**
   * Detect contiguous downtime incidents from health metrics.
   */
  private detectDowntimeIncidents(health: HealthMetric[]): DowntimeIncident[] {
    const incidents: DowntimeIncident[] = [];
    let currentDown: DowntimeIncident | null = null;

    for (const h of health) {
      if (!h.gatewayAlive) {
        if (!currentDown) {
          currentDown = {
            startedAt: h.timestamp,
            endedAt: null,
            durationMs: null,
          };
        }
      } else if (currentDown) {
        currentDown.endedAt = h.timestamp;
        currentDown.durationMs =
          new Date(h.timestamp).getTime() -
          new Date(currentDown.startedAt).getTime();
        incidents.push(currentDown);
        currentDown = null;
      }
    }

    // If still down at the end
    if (currentDown) {
      incidents.push(currentDown);
    }

    return incidents;
  }

  // ── Snapshot ────────────────────────────────────────────────────

  /** Full snapshot of all current metrics counts. */
  getSnapshot() {
    return {
      health: this.healthMetrics.length,
      leads: this.leadMetrics.length,
      security: this.securityMetrics.length,
      webhooks: this.webhookMetrics.length,
      trends: {
        last15m: this.getTrend(15),
        last1h: this.getTrend(60),
        last24h: this.getTrend(1440),
      },
    };
  }

  // ── Internal ────────────────────────────────────────────────────

  private trim<T>(arr: T[]) {
    if (arr.length > this.maxEntries) {
      arr.splice(0, arr.length - this.maxEntries);
    }
  }
}
