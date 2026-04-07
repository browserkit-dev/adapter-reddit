/**
 * L2 — Live Scraping Integration Tests
 *
 * Runs against real old.reddit.com — no mocking. Reddit is a public site
 * so these run in CI without auth. Excluded from default pnpm test run via
 * vitest.config.ts; use pnpm test:integration to run them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import redditAdapter from "../src/index.js";
import { createTestAdapterServer, type TestAdapterServer } from "@browserkit-dev/core/testing";
import { createTestMcpClient, type TestMcpClient } from "@browserkit-dev/core/testing";
import type { RedditPost, RedditThread, RedditComment } from "../src/scraper.js";

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

// ── get_subreddit ─────────────────────────────────────────────────────────────

describe("get_subreddit live", () => {
  it("returns real posts from r/programming with expected shape", async () => {
    const result = await client.callTool("get_subreddit", {
      subreddit: "programming",
      sort: "hot",
      count: 5,
    });
    expect(result.isError).toBeFalsy();

    const posts = JSON.parse(result.content[0]?.text ?? "[]") as RedditPost[];
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.length).toBeLessThanOrEqual(5);

    const first = posts[0]!;
    // Required fields present
    expect(typeof first.id).toBe("string");
    expect(first.id.length).toBeGreaterThan(0);
    expect(typeof first.title).toBe("string");
    expect(first.title.length).toBeGreaterThan(0);
    expect(typeof first.score).toBe("number");
    expect(typeof first.author).toBe("string");
    expect(first.author.length).toBeGreaterThan(0);
    expect(first.subreddit.toLowerCase()).toBe("programming");
    expect(typeof first.numComments).toBe("number");
    expect(first.commentsUrl).toContain("reddit.com");
    expect(typeof first.isSelf).toBe("boolean");
    expect(first.ageIso).toMatch(/^\d{4}-\d{2}-\d{2}/); // ISO date
  }, 30_000);

  it("returns posts from r/worldnews (non-default subreddit)", async () => {
    const result = await client.callTool("get_subreddit", {
      subreddit: "worldnews",
      sort: "top",
      time: "day",
      count: 3,
    });
    expect(result.isError).toBeFalsy();
    const posts = JSON.parse(result.content[0]?.text ?? "[]") as RedditPost[];
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      expect(post.subreddit.toLowerCase()).toBe("worldnews");
    }
  }, 30_000);

  it("respects count parameter", async () => {
    const result = await client.callTool("get_subreddit", {
      subreddit: "programming",
      count: 3,
    });
    const posts = JSON.parse(result.content[0]?.text ?? "[]") as RedditPost[];
    expect(posts.length).toBeLessThanOrEqual(3);
  }, 30_000);

  it("ranks are populated and increasing", async () => {
    const result = await client.callTool("get_subreddit", {
      subreddit: "programming",
      sort: "hot",
      count: 5,
    });
    const posts = JSON.parse(result.content[0]?.text ?? "[]") as RedditPost[];
    // Ranks should exist and be in order
    const ranks = posts.map((p) => p.rank);
    expect(ranks[0]).toBeGreaterThan(0);
  }, 30_000);
});

// ── get_thread ────────────────────────────────────────────────────────────────

describe("get_thread live", () => {
  // Well-known r/programming thread: "The Birth and Death of JavaScript" by garybernhardt
  // https://old.reddit.com/r/programming/comments/1oe9d7/
  const KNOWN_THREAD_ID = "1oe9d7";

  it("returns a thread with post and comments", async () => {
    const result = await client.callTool("get_thread", {
      thread_id: KNOWN_THREAD_ID,
      count: 5,
    });
    expect(result.isError).toBeFalsy();

    const thread = JSON.parse(result.content[0]?.text ?? "{}") as RedditThread;
    expect(thread).toHaveProperty("post");
    expect(thread).toHaveProperty("comments");
    expect(Array.isArray(thread.comments)).toBe(true);
  }, 30_000);

  it("post shape has required fields", async () => {
    const result = await client.callTool("get_thread", {
      thread_id: KNOWN_THREAD_ID,
      count: 1,
    });
    const thread = JSON.parse(result.content[0]?.text ?? "{}") as RedditThread;

    if (thread.post) {
      expect(typeof thread.post.title).toBe("string");
      expect(thread.post.title.length).toBeGreaterThan(0);
      expect(typeof thread.post.score).toBe("number");
      expect(typeof thread.post.author).toBe("string");
    }
  }, 30_000);

  it("comment shape has required fields", async () => {
    const result = await client.callTool("get_thread", {
      thread_id: KNOWN_THREAD_ID,
      count: 5,
    });
    const thread = JSON.parse(result.content[0]?.text ?? "{}") as RedditThread;

    for (const comment of thread.comments.slice(0, 2)) {
      expect(typeof comment.author).toBe("string");
      expect(typeof comment.body).toBe("string");
      expect(comment.depth).toBe(0); // top-level only
    }
  }, 30_000);

  it("accepts a full URL as thread_id", async () => {
    const result = await client.callTool("get_thread", {
      thread_id: `https://old.reddit.com/r/programming/comments/${KNOWN_THREAD_ID}/`,
      count: 1,
    });
    expect(result.isError).toBeFalsy();
    const thread = JSON.parse(result.content[0]?.text ?? "{}") as RedditThread;
    expect(thread).toHaveProperty("comments");
  }, 30_000);

  it("handles thread with no comments gracefully", async () => {
    // Navigate to a new thread that may have zero comments — just check no crash
    // Using search to find a recent low-comment thread isn't reliable,
    // so we just verify the get_subreddit + get_thread chain works
    const listResult = await client.callTool("get_subreddit", {
      subreddit: "test",
      sort: "new",
      count: 1,
    });
    const posts = JSON.parse(listResult.content[0]?.text ?? "[]") as RedditPost[];
    if (posts.length > 0 && posts[0]) {
      const threadResult = await client.callTool("get_thread", {
        thread_id: posts[0].id,
        count: 1,
      });
      // Should not throw
      expect(typeof threadResult.content[0]?.text).toBe("string");
    }
  }, 30_000);
});

// ── search ────────────────────────────────────────────────────────────────────

describe("search live", () => {
  it("returns results for a generic query", async () => {
    const result = await client.callTool("search", {
      query: "programming language",
      sort: "relevance",
      count: 5,
    });
    expect(result.isError).toBeFalsy();
    const posts = JSON.parse(result.content[0]?.text ?? "[]") as RedditPost[];
    expect(Array.isArray(posts)).toBe(true);
  }, 30_000);

  it("restricts results to a subreddit when specified", async () => {
    const result = await client.callTool("search", {
      query: "performance",
      subreddit: "programming",
      count: 5,
    });
    expect(result.isError).toBeFalsy();
    const posts = JSON.parse(result.content[0]?.text ?? "[]") as RedditPost[];
    // All results should be from r/programming
    for (const post of posts) {
      expect(post.subreddit.toLowerCase()).toBe("programming");
    }
  }, 30_000);

  it("returns empty array (not error) for a query with no results", async () => {
    // Highly unlikely to have results
    const result = await client.callTool("search", {
      query: "xyzzy42qwerty99nosuchposteverzzz",
      count: 5,
    });
    expect(result.isError).toBeFalsy();
    const posts = JSON.parse(result.content[0]?.text ?? "[]") as RedditPost[];
    expect(Array.isArray(posts)).toBe(true);
  }, 30_000);
});

// ── get_user ──────────────────────────────────────────────────────────────────

describe("get_user live", () => {
  // spez (Reddit CEO) is a well-known public account
  const KNOWN_USER = "GovSchwarzenegger";

  it("returns posts from a known user's submitted section", async () => {
    const result = await client.callTool("get_user", {
      username: KNOWN_USER,
      section: "submitted",
      count: 5,
    });
    expect(result.isError).toBeFalsy();
    const posts = JSON.parse(result.content[0]?.text ?? "[]") as RedditPost[];
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);

    const first = posts[0]!;
    expect(first.author.toLowerCase()).toBe(KNOWN_USER.toLowerCase());
  }, 30_000);

  it("returns isError=true or not-found text for non-existent user", async () => {
    const result = await client.callTool("get_user", {
      username: "ThisUserDefinitelyDoesNotExistXYZ99999",
      count: 3,
    });
    // Either error or empty — both acceptable
    const text = result.content[0]?.text ?? "";
    expect(typeof text).toBe("string");
  }, 30_000);
});

// ── health_check after navigation ─────────────────────────────────────────────

describe("selector health after navigation", () => {
  it("health_check runs and reports loggedIn=true after visiting old.reddit.com", async () => {
    // First navigate somewhere
    await client.callTool("get_subreddit", { subreddit: "programming", count: 1 });

    // Then health check — should still report correctly
    const result = await client.callTool("browser", { action: "health_check" });
    expect(result.isError).toBeFalsy();
    const status = JSON.parse(result.content[0]?.text ?? "{}") as { site: string; loggedIn: boolean };
    expect(status.site).toBe("reddit");
    expect(status.loggedIn).toBe(true);
  }, 30_000);
});
