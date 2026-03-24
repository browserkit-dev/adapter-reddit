/**
 * L3 — MCP Protocol Tests (live Reddit dispatch)
 *
 * Tests that require live Reddit API access. Excluded from CI (datacenter IPs
 * get 403 from Reddit's API). Run locally with: pnpm test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import redditAdapter from "../src/index.js";
import { createTestAdapterServer, type TestAdapterServer } from "@browserkit/core/testing";
import { createTestMcpClient, type TestMcpClient } from "@browserkit/core/testing";

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

describe("get_subreddit tool dispatch", () => {
  it("returns a JSON array of posts from r/programming", async () => {
    const result = await client.callTool("get_subreddit", { subreddit: "programming", count: 3 });
    expect(result.isError).toBeFalsy();
    const posts = JSON.parse(result.content[0]?.text ?? "[]") as Array<{
      id: string; title: string; score: number; subreddit: string; commentsUrl: string;
    }>;
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0]?.title.length).toBeGreaterThan(0);
    expect(posts[0]?.subreddit.toLowerCase()).toContain("programming");
    expect(result.content[0]?.type).toBe("text");
  }, 30_000);
});

describe("search tool dispatch", () => {
  it("returns results for a broad query", async () => {
    const result = await client.callTool("search", { query: "TypeScript", count: 3 });
    expect(result.isError).toBeFalsy();
    const posts = JSON.parse(result.content[0]?.text ?? "[]") as Array<{ title: string }>;
    expect(Array.isArray(posts)).toBe(true);
  }, 30_000);
});

describe("get_thread tool dispatch", () => {
  it("returns a thread from a current hot post", async () => {
    const listResult = await client.callTool("get_subreddit", { subreddit: "programming", sort: "hot", count: 3 });
    const posts = JSON.parse(listResult.content[0]?.text ?? "[]") as Array<{ id: string; numComments: number }>;
    const postWithComments = posts.find((p) => p.numComments > 0) ?? posts[0];
    expect(postWithComments).toBeDefined();

    const result = await client.callTool("get_thread", { thread_id: postWithComments!.id, count: 3 });
    expect(result.isError).toBeFalsy();
    const thread = JSON.parse(result.content[0]?.text ?? "{}") as { post: unknown; comments: unknown[] };
    expect(Array.isArray(thread.comments)).toBe(true);
  }, 30_000);
});
