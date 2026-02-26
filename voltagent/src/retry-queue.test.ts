/**
 * Unit tests for RetryQueue.
 *
 * Tests exponential backoff, max retries, dead-letter queue,
 * executor registration, and queue statistics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RetryQueue } from "./retry-queue.js";

describe("RetryQueue", () => {
  let queue: RetryQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new RetryQueue({ maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10_000 });
  });

  afterEach(() => {
    queue.stop();
    vi.useRealTimers();
  });

  it("starts with empty stats", () => {
    const stats = queue.getStats();
    expect(stats.pending).toBe(0);
    expect(stats.deadLetter).toBe(0);
    expect(stats.totalProcessed).toBe(0);
  });

  it("enqueues an item and shows it as pending", () => {
    queue.enqueue("lead_ingest", { name: "Test" }, "Connection failed");
    expect(queue.getStats().pending).toBe(1);
    expect(queue.getPending()).toHaveLength(1);
    expect(queue.getPending()[0].operation).toBe("lead_ingest");
    expect(queue.getPending()[0].lastError).toBe("Connection failed");
  });

  it("retries and succeeds on the first retry", async () => {
    const executor = vi.fn().mockResolvedValueOnce({ ohid: "test-123" });
    const onSuccess = vi.fn();
    const onRetry = vi.fn();

    queue = new RetryQueue({
      maxRetries: 3,
      baseDelayMs: 100,
      onSuccess,
      onRetry,
    });
    queue.registerExecutor("lead_ingest", executor);
    queue.enqueue("lead_ingest", { name: "Test" }, "Initial failure");

    // Advance past the base delay
    await vi.advanceTimersByTimeAsync(150);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(queue.getStats().pending).toBe(0);
    expect(queue.getStats().totalSucceeded).toBe(1);

    queue.stop();
  });

  it("moves to dead letter after max retries", async () => {
    const executor = vi.fn().mockRejectedValue(new Error("Still failing"));
    const onDeadLetter = vi.fn();

    queue = new RetryQueue({
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 10_000,
      onDeadLetter,
    });
    queue.registerExecutor("lead_ingest", executor);
    queue.enqueue("lead_ingest", { name: "Test" }, "Initial failure");

    // Retry 1: 100ms delay
    await vi.advanceTimersByTimeAsync(150);
    expect(executor).toHaveBeenCalledTimes(1);

    // Retry 2: 200ms delay (100 * 2^1)
    await vi.advanceTimersByTimeAsync(250);
    expect(executor).toHaveBeenCalledTimes(2);

    // Retry 3: 400ms delay (100 * 2^2)
    await vi.advanceTimersByTimeAsync(450);
    expect(executor).toHaveBeenCalledTimes(3);

    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(queue.getStats().pending).toBe(0);
    expect(queue.getStats().deadLetter).toBe(1);
    expect(queue.getStats().totalFailed).toBe(1);
    expect(queue.getDeadLetters()).toHaveLength(1);

    queue.stop();
  });

  it("dead-letters items with no registered executor", async () => {
    const onDeadLetter = vi.fn();
    queue = new RetryQueue({ maxRetries: 3, baseDelayMs: 100, onDeadLetter });
    // No executor registered
    queue.enqueue("unknown_op", { data: 1 }, "test");

    await vi.advanceTimersByTimeAsync(150);

    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(queue.getStats().deadLetter).toBe(1);

    queue.stop();
  });

  it("retryDeadLetter moves item back to pending", async () => {
    const executor = vi.fn().mockRejectedValue(new Error("fail"));
    queue = new RetryQueue({ maxRetries: 1, baseDelayMs: 100 });
    queue.registerExecutor("test_op", executor);
    queue.enqueue("test_op", {}, "fail");

    // Exhaust retries
    await vi.advanceTimersByTimeAsync(150);

    expect(queue.getStats().deadLetter).toBe(1);
    const dlId = queue.getDeadLetters()[0].id;

    // Now make executor succeed
    executor.mockResolvedValueOnce("ok");

    const success = queue.retryDeadLetter(dlId);
    expect(success).toBe(true);
    expect(queue.getStats().pending).toBe(1);
    expect(queue.getStats().deadLetter).toBe(0);

    queue.stop();
  });

  it("retryDeadLetter returns false for unknown id", () => {
    expect(queue.retryDeadLetter("nonexistent")).toBe(false);
  });
});
