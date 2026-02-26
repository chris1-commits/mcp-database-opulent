/**
 * Retry Queue — Durable retry mechanism for failed operations.
 *
 * When a lead ingest, webhook validation, or n8n trigger fails, the
 * operation is queued for automatic retry with exponential backoff.
 *
 * Features:
 * - Exponential backoff (1s, 2s, 4s, 8s, 16s... capped at 5 min)
 * - Configurable max retries (default: 5)
 * - Dead-letter queue for permanently failed items
 * - Event callbacks for monitoring (onRetry, onSuccess, onDeadLetter)
 * - In-memory queue with full state inspection
 */

// ── Types ─────────────────────────────────────────────────────────

export interface RetryItem<T = unknown> {
  id: string;
  operation: string;
  payload: T;
  attempt: number;
  maxRetries: number;
  nextRetryAt: number;
  createdAt: string;
  lastError: string;
}

export interface RetryQueueOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (item: RetryItem, attempt: number) => void;
  onSuccess?: (item: RetryItem, result: unknown) => void;
  onDeadLetter?: (item: RetryItem) => void;
}

export interface QueueStats {
  pending: number;
  deadLetter: number;
  totalProcessed: number;
  totalSucceeded: number;
  totalFailed: number;
}

// ── Implementation ────────────────────────────────────────────────

export class RetryQueue {
  private queue: RetryItem[] = [];
  private deadLetterQueue: RetryItem[] = [];
  private processing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private totalProcessed = 0;
  private totalSucceeded = 0;
  private totalFailed = 0;

  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly onRetry?: (item: RetryItem, attempt: number) => void;
  private readonly onSuccess?: (item: RetryItem, result: unknown) => void;
  private readonly onDeadLetter?: (item: RetryItem) => void;

  /** Registered executor functions keyed by operation name. */
  private executors = new Map<string, (payload: unknown) => Promise<unknown>>();

  constructor(options: RetryQueueOptions = {}) {
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 300_000; // 5 min cap
    this.onRetry = options.onRetry;
    this.onSuccess = options.onSuccess;
    this.onDeadLetter = options.onDeadLetter;
  }

  /**
   * Register an executor function for an operation type.
   * When items with this operation name are retried, this function is called.
   */
  registerExecutor(operation: string, fn: (payload: unknown) => Promise<unknown>) {
    this.executors.set(operation, fn);
  }

  /**
   * Enqueue a failed operation for retry.
   */
  enqueue<T>(operation: string, payload: T, error: string): RetryItem<T> {
    const item: RetryItem<T> = {
      id: crypto.randomUUID(),
      operation,
      payload,
      attempt: 0,
      maxRetries: this.maxRetries,
      nextRetryAt: Date.now() + this.baseDelayMs,
      createdAt: new Date().toISOString(),
      lastError: error,
    };
    this.queue.push(item as RetryItem);
    this.scheduleProcessing();
    return item;
  }

  /**
   * Process all due items in the queue.
   */
  async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    const now = Date.now();
    const due = this.queue.filter((item) => item.nextRetryAt <= now);

    for (const item of due) {
      const executor = this.executors.get(item.operation);
      if (!executor) {
        // No executor registered — move to dead letter
        this.moveToDeadLetter(item, `No executor registered for "${item.operation}"`);
        continue;
      }

      item.attempt++;
      this.totalProcessed++;
      this.onRetry?.(item, item.attempt);

      try {
        const result = await executor(item.payload);
        // Success — remove from queue
        this.queue = this.queue.filter((q) => q.id !== item.id);
        this.totalSucceeded++;
        this.onSuccess?.(item, result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        item.lastError = msg;

        if (item.attempt >= item.maxRetries) {
          this.moveToDeadLetter(item, msg);
        } else {
          // Exponential backoff
          const delay = Math.min(
            this.baseDelayMs * Math.pow(2, item.attempt),
            this.maxDelayMs
          );
          item.nextRetryAt = Date.now() + delay;
        }
      }
    }

    this.processing = false;
    this.scheduleProcessing();
  }

  private moveToDeadLetter(item: RetryItem, error: string) {
    item.lastError = error;
    this.queue = this.queue.filter((q) => q.id !== item.id);
    this.deadLetterQueue.push(item);
    this.totalFailed++;
    this.onDeadLetter?.(item);
  }

  private scheduleProcessing() {
    if (this.timer) return;
    if (this.queue.length === 0) return;

    const nextDue = Math.min(...this.queue.map((q) => q.nextRetryAt));
    const delay = Math.max(0, nextDue - Date.now());

    this.timer = setTimeout(() => {
      this.timer = null;
      this.processQueue();
    }, delay);
  }

  /** Get current queue statistics. */
  getStats(): QueueStats {
    return {
      pending: this.queue.length,
      deadLetter: this.deadLetterQueue.length,
      totalProcessed: this.totalProcessed,
      totalSucceeded: this.totalSucceeded,
      totalFailed: this.totalFailed,
    };
  }

  /** Get all pending items. */
  getPending(): readonly RetryItem[] {
    return [...this.queue];
  }

  /** Get all dead-letter items. */
  getDeadLetters(): readonly RetryItem[] {
    return [...this.deadLetterQueue];
  }

  /** Retry a specific dead-letter item (moves it back to the queue). */
  retryDeadLetter(id: string): boolean {
    const idx = this.deadLetterQueue.findIndex((i) => i.id === id);
    if (idx === -1) return false;

    const item = this.deadLetterQueue.splice(idx, 1)[0];
    item.attempt = 0;
    item.nextRetryAt = Date.now() + this.baseDelayMs;
    this.queue.push(item);
    this.totalFailed--;
    this.scheduleProcessing();
    return true;
  }

  /** Clear all timers (for clean shutdown). */
  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
