/**
 * L4 — Reliability Tests
 *
 * Concurrency (LockManager serialises parallel calls), latency measurement,
 * and error recovery under bad inputs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import redditAdapter from "../src/index.js";
import { createTestAdapterServer, type TestAdapterServer } from "@browserkit/core/testing";
import { createTestMcpClient } from "@browserkit/core/testing";

// ── Shared server ─────────────────────────────────────────────────────────────

let server: TestAdapterServer;

beforeAll(async () => {
  server = await createTestAdapterServer(redditAdapter);
}, 30_000);

afterAll(async () => {
  await server.stop();
});

// ── Concurrency ───────────────────────────────────────────────────────────────

describe("concurrency", () => {
  it("serialises parallel tool calls — all succeed without race conditions", async () => {
    const NUM = 3;
    const clients = await Promise.all(
      Array.from({ length: NUM }, () => createTestMcpClient(server.url))
    );

    const results = await Promise.all(
      clients.map((c) => c.callTool("get_subreddit", { subreddit: "programming", count: 1 }))
    );

    for (const result of results) {
      expect(result.isError).toBeFalsy();
      const posts = JSON.parse(result.content[0]?.text ?? "[]") as unknown[];
      expect(Array.isArray(posts)).toBe(true);
    }

    expect(results).toHaveLength(NUM);
    await Promise.all(clients.map((c) => c.close()));
  }, 90_000);

  it("concurrent health_check calls (non-locking) all succeed", async () => {
    const NUM = 5;
    const clients = await Promise.all(
      Array.from({ length: NUM }, () => createTestMcpClient(server.url))
    );

    const results = await Promise.all(
      clients.map((c) => c.callTool("browser", { action: "health_check" }))
    );

    for (const result of results) {
      expect(result.isError).toBeFalsy();
      const status = JSON.parse(result.content[0]?.text ?? "{}") as { site: string };
      expect(status.site).toBe("reddit");
    }

    await Promise.all(clients.map((c) => c.close()));
  }, 30_000);
});

// ── Latency ───────────────────────────────────────────────────────────────────

describe("latency", () => {
  it("measures p50/p95 latency for get_subreddit across 5 serial calls", async () => {
    const client = await createTestMcpClient(server.url);
    const RUNS = 5;
    const latencies: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      const t0 = Date.now();
      const result = await client.callTool("get_subreddit", { subreddit: "programming", count: 3 });
      latencies.push(Date.now() - t0);
      expect(result.isError).toBeFalsy();
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(RUNS * 0.5)]!;
    const p95 = latencies[Math.floor(RUNS * 0.95)]!;

    console.log(
      `[latency] get_subreddit(count=3): ` +
      `min=${latencies[0]}ms p50=${p50}ms p95=${p95}ms max=${latencies[RUNS - 1]}ms`
    );

    expect(p50).toBeGreaterThan(0);
    expect(p95).toBeGreaterThanOrEqual(p50);
    expect(latencies[RUNS - 1]).toBeLessThan(30_000);

    await client.close();
  }, 90_000);

  it("health_check responds under 5s", async () => {
    const client = await createTestMcpClient(server.url);
    const t0 = Date.now();
    const result = await client.callTool("browser", { action: "health_check" });
    const elapsed = Date.now() - t0;

    expect(result.isError).toBeFalsy();
    expect(elapsed).toBeLessThan(5_000);

    await client.close();
  }, 15_000);
});

// ── Error recovery ────────────────────────────────────────────────────────────

describe("error recovery", () => {
  it("server remains usable after a schema-rejected call", async () => {
    const client = await createTestMcpClient(server.url);

    // Schema validation — should return error or throw
    const badResult = await client.callTool("get_subreddit", { subreddit: "" }).catch((e: Error) => e);
    const hasBadResult = badResult instanceof Error || (badResult as { isError?: boolean }).isError;
    expect(hasBadResult).toBe(true);

    // Server should still work
    const good = await client.callTool("browser", { action: "health_check" });
    expect(good.isError).toBeFalsy();

    await client.close();
  }, 30_000);

  it("server remains usable after a network tool call fails", async () => {
    const client = await createTestMcpClient(server.url);

    // get_thread with invalid ID should return isError or just empty thread
    const badResult = await client.callTool("get_thread", { thread_id: "INVALID___ID" });
    // Either isError or valid JSON — either is acceptable
    expect(typeof badResult.content[0]?.text).toBe("string");

    // Server should still work
    const good = await client.callTool("get_subreddit", { subreddit: "programming", count: 1 });
    expect(good.isError).toBeFalsy();

    await client.close();
  }, 30_000);

  it("rapid sequential calls do not leave the lock held", async () => {
    const client = await createTestMcpClient(server.url);

    for (let i = 0; i < 5; i++) {
      const result = await client.callTool("get_subreddit", { subreddit: "programming", count: 1 });
      expect(result.isError).toBeFalsy();
    }

    await client.close();
  }, 120_000);
});
