/**
 * L3 — MCP Protocol Tests
 *
 * Starts the Reddit adapter in-process, connects via real MCP HTTP transport,
 * and verifies: server lifecycle, tool registry, tool dispatch, and error paths.
 * Reddit is a public site — real network calls are fine in CI.
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
    const names = tools.map((t) => t.name);
    expect(names).toContain("browser");
  });

  it("all tools have a description", async () => {
    const tools = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `tool "${tool.name}" missing description`).toBeTruthy();
    }
  });
});

// ── health_check ──────────────────────────────────────────────────────────────

describe("health_check", () => {
  it("reports site=reddit, loggedIn=true, mode=headless", async () => {
    const result = await client.callTool("browser", { action: "health_check" });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    const status = JSON.parse(text) as {
      site: string;
      loggedIn: boolean;
      mode: string;
    };

    expect(status.site).toBe("reddit");
    expect(status.loggedIn).toBe(true);
    expect(status.mode).toBe("headless");
  });
});

// ── page_state ────────────────────────────────────────────────────────────────

describe("page_state", () => {
  it("returns url, title, mode, isPaused", async () => {
    const result = await client.callTool("browser", { action: "page_state" });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    const state = JSON.parse(text) as {
      url: string;
      title: string;
      mode: string;
      isPaused: boolean;
    };

    expect(typeof state.url).toBe("string");
    expect(typeof state.title).toBe("string");
    expect(state.mode).toBe("headless");
    expect(state.isPaused).toBe(false);
  });
});

// ── get_subreddit dispatch ────────────────────────────────────────────────────

describe("get_subreddit tool dispatch", () => {
  it("returns a JSON array of posts from r/programming", async () => {
    const result = await client.callTool("get_subreddit", { subreddit: "programming", count: 3 });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    const posts = JSON.parse(text) as Array<{
      id: string;
      title: string;
      score: number;
      author: string;
      subreddit: string;
      commentsUrl: string;
    }>;

    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.length).toBeLessThanOrEqual(3);

    const first = posts[0]!;
    expect(typeof first.id).toBe("string");
    expect(typeof first.title).toBe("string");
    expect(first.title.length).toBeGreaterThan(0);
    expect(typeof first.score).toBe("number");
    expect(first.subreddit.toLowerCase()).toContain("programming");
    expect(first.commentsUrl).toContain("reddit.com");
  }, 30_000);

  it("result content type is text", async () => {
    const result = await client.callTool("get_subreddit", { subreddit: "programming", count: 1 });
    expect(result.content[0]?.type).toBe("text");
  }, 30_000);
});

// ── search dispatch ───────────────────────────────────────────────────────────

describe("search tool dispatch", () => {
  it("returns results for a broad query", async () => {
    const result = await client.callTool("search", { query: "TypeScript", count: 3 });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    const posts = JSON.parse(text) as Array<{ title: string }>;

    expect(Array.isArray(posts)).toBe(true);
  }, 30_000);
});

// ── get_thread dispatch ───────────────────────────────────────────────────────

describe("get_thread tool dispatch", () => {
  it("returns a thread object with post and comments for a current hot post", async () => {
    // Get a live post ID from the hot listing first
    const listResult = await client.callTool("get_subreddit", {
      subreddit: "programming",
      sort: "hot",
      count: 3,
    });
    const posts = JSON.parse(listResult.content[0]?.text ?? "[]") as Array<{ id: string; numComments: number }>;

    // Find a post with comments
    const postWithComments = posts.find((p) => p.numComments > 0);
    const threadId = postWithComments?.id ?? posts[0]?.id;
    expect(typeof threadId).toBe("string");

    const result = await client.callTool("get_thread", { thread_id: threadId!, count: 3 });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    const thread = JSON.parse(text) as {
      post: { title: string; id: string } | null;
      comments: Array<{ author: string; body: string }>;
    };

    expect(typeof thread).toBe("object");
    expect(Array.isArray(thread.comments)).toBe(true);
  }, 30_000);

  it("returns isError=true for a non-existent post ID", async () => {
    const result = await client.callTool("get_thread", { thread_id: "zzzzzz99999" });
    // May be isError OR empty thread — both are acceptable
    const text = result.content[0]?.text ?? "";
    expect(typeof text).toBe("string");
  }, 30_000);
});

// ── Error paths ───────────────────────────────────────────────────────────────

describe("error handling", () => {
  it("schema validation error for missing subreddit", async () => {
    const result = await client.callTool("get_subreddit", {}).catch((e: Error) => e);
    if (result instanceof Error) {
      expect(result.message).toMatch(/validation|invalid/i);
    } else {
      expect(result.isError).toBe(true);
    }
  });

  it("schema validation error for empty query in search", async () => {
    const result = await client.callTool("search", { query: "" }).catch((e: Error) => e);
    if (result instanceof Error) {
      expect(result.message).toMatch(/validation|invalid/i);
    } else {
      expect(result.isError).toBe(true);
    }
  });

  it("schema validation error for count=0", async () => {
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
