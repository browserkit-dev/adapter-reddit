/**
 * L3 — MCP Protocol Tests (structural, no Reddit network calls)
 *
 * Tests that run in CI without network access to Reddit:
 * server lifecycle, tool registry, health check, schema validation, bearer token.
 *
 * Tests that require live Reddit access are in mcp-protocol.integration.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import redditAdapter from "../src/index.js";
import { createTestAdapterServer, type TestAdapterServer } from "@browserkit/core/testing";
import { createTestMcpClient, type TestMcpClient } from "@browserkit/core/testing";

// ── Shared server ─────────────────────────────────────────────────────────────

let server: TestAdapterServer;
let client: TestMcpClient;

beforeAll(async () => {
  server = await createTestAdapterServer(redditAdapter);
  client = await createTestMcpClient(server.url);
}, 30_000);

afterAll(async () => {
  await client.close();
  await server.stop();
});

// ── Tool registry ─────────────────────────────────────────────────────────────

describe("tool registry", () => {
  it("lists all 4 adapter tools", async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_subreddit");
    expect(names).toContain("get_thread");
    expect(names).toContain("search");
    expect(names).toContain("get_user");
  });

  it("includes auto-registered browser management tool", async () => {
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("browser");
  });

  it("all tools have a description", async () => {
    const tools = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `tool "${tool.name}" missing description`).toBeTruthy();
    }
  });
});

// ── health_check (no Reddit navigation needed) ────────────────────────────────

describe("health_check", () => {
  it("reports site=reddit, loggedIn=true, mode=headless", async () => {
    const result = await client.callTool("browser", { action: "health_check" });
    expect(result.isError).toBeFalsy();
    const status = JSON.parse(result.content[0]?.text ?? "{}") as {
      site: string;
      loggedIn: boolean;
      mode: string;
    };
    expect(status.site).toBe("reddit");
    expect(status.loggedIn).toBe(true);
    expect(status.mode).toBe("headless");
  });
});

// ── page_state (no Reddit navigation needed) ──────────────────────────────────

describe("page_state", () => {
  it("returns url, title, mode, isPaused", async () => {
    const result = await client.callTool("browser", { action: "page_state" });
    expect(result.isError).toBeFalsy();
    const state = JSON.parse(result.content[0]?.text ?? "{}") as {
      url: string; title: string; mode: string; isPaused: boolean;
    };
    expect(typeof state.url).toBe("string");
    expect(state.mode).toBe("headless");
    expect(state.isPaused).toBe(false);
  });
});

// ── Schema validation errors (no Reddit calls, pure input validation) ──────────

describe("schema validation errors", () => {
  it("schema error for missing subreddit", async () => {
    const result = await client.callTool("get_subreddit", {}).catch((e: Error) => e);
    if (result instanceof Error) {
      expect(result.message).toMatch(/validation|invalid/i);
    } else {
      expect(result.isError).toBe(true);
    }
  });

  it("schema error for empty query in search", async () => {
    const result = await client.callTool("search", { query: "" }).catch((e: Error) => e);
    if (result instanceof Error) {
      expect(result.message).toMatch(/validation|invalid/i);
    } else {
      expect(result.isError).toBe(true);
    }
  });

  it("schema error for count=0", async () => {
    const result = await client.callTool("get_subreddit", { subreddit: "programming", count: 0 }).catch((e: Error) => e);
    if (result instanceof Error) {
      expect(result.message).toMatch(/validation|invalid/i);
    } else {
      expect(result.isError).toBe(true);
    }
  });
});

// ── Bearer token auth ─────────────────────────────────────────────────────────

describe("bearer token auth", () => {
  let protectedServer: TestAdapterServer;

  beforeAll(async () => {
    protectedServer = await createTestAdapterServer(redditAdapter, "test-secret-token");
  }, 30_000);

  afterAll(async () => {
    await protectedServer.stop();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const unauthClient = await createTestMcpClient(protectedServer.url).catch((e) => e);
    if (unauthClient instanceof Error) {
      expect(unauthClient.message).toBeTruthy();
    } else {
      const result = await unauthClient.callTool("browser", { action: "health_check" }).catch((e: Error) => e);
      expect(result instanceof Error).toBe(true);
      await unauthClient.close();
    }
  });
});
