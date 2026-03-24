/**
 * L1 — Unit Tests
 *
 * Pure fast tests: adapter metadata, tool names, Zod schemas, helper functions.
 * No browser, no network.
 */
import { describe, it, expect } from "vitest";
import adapter from "../src/index.js";
import { htmlToText } from "../src/scraper.js";
import { SELECTORS } from "../src/selectors.js";

// ── Metadata ──────────────────────────────────────────────────────────────────

describe("Reddit adapter metadata", () => {
  it("has correct site identifier", () => {
    expect(adapter.site).toBe("reddit");
  });

  it("has correct domain", () => {
    expect(adapter.domain).toBe("reddit.com");
  });

  it("loginUrl points to old.reddit.com/login", () => {
    expect(adapter.loginUrl).toContain("old.reddit.com/login");
  });

  it("is always considered logged in (Phase 1: public content only)", async () => {
    const loggedIn = await adapter.isLoggedIn({} as never);
    expect(loggedIn).toBe(true);
  });

  it("exports selectors for health_check reporting", () => {
    expect(adapter.selectors).toBeDefined();
    expect(typeof adapter.selectors?.post).toBe("string");
  });
});

// ── Tool registry ─────────────────────────────────────────────────────────────

describe("tool registry", () => {
  it("exposes all 4 Phase 1 tools", () => {
    const names = adapter.tools().map((t) => t.name);
    expect(names).toContain("get_subreddit");
    expect(names).toContain("get_thread");
    expect(names).toContain("search");
    expect(names).toContain("get_user");
    expect(names).toHaveLength(4);
  });

  it("every tool has a non-empty description", () => {
    for (const tool of adapter.tools()) {
      expect(tool.description, `tool "${tool.name}" missing description`).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("every tool has a handler function", () => {
    for (const tool of adapter.tools()) {
      expect(typeof tool.handler, `tool "${tool.name}" missing handler`).toBe("function");
    }
  });
});

// ── get_subreddit schema ──────────────────────────────────────────────────────

describe("get_subreddit schema", () => {
  const tool = () => adapter.tools().find((t) => t.name === "get_subreddit")!;

  it("accepts minimal valid input", () => {
    expect(tool().inputSchema.safeParse({ subreddit: "programming" }).success).toBe(true);
  });

  it("applies defaults (sort=hot, time=all, count=10)", () => {
    const result = tool().inputSchema.parse({ subreddit: "programming" });
    expect(result.sort).toBe("hot");
    expect(result.time).toBe("all");
    expect(result.count).toBe(10);
  });

  it("accepts valid sort values", () => {
    for (const sort of ["hot", "new", "top", "rising", "controversial"]) {
      expect(tool().inputSchema.safeParse({ subreddit: "programming", sort }).success).toBe(true);
    }
  });

  it("rejects invalid sort", () => {
    expect(tool().inputSchema.safeParse({ subreddit: "programming", sort: "viral" }).success).toBe(false);
  });

  it("accepts valid time values", () => {
    for (const time of ["hour", "day", "week", "month", "year", "all"]) {
      expect(tool().inputSchema.safeParse({ subreddit: "programming", time }).success).toBe(true);
    }
  });

  it("rejects empty subreddit", () => {
    expect(tool().inputSchema.safeParse({ subreddit: "" }).success).toBe(false);
  });

  it("rejects missing subreddit", () => {
    expect(tool().inputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts count=1 (min)", () => {
    expect(tool().inputSchema.safeParse({ subreddit: "programming", count: 1 }).success).toBe(true);
  });

  it("accepts count=50 (max)", () => {
    expect(tool().inputSchema.safeParse({ subreddit: "programming", count: 50 }).success).toBe(true);
  });

  it("rejects count=0", () => {
    expect(tool().inputSchema.safeParse({ subreddit: "programming", count: 0 }).success).toBe(false);
  });

  it("rejects count=51", () => {
    expect(tool().inputSchema.safeParse({ subreddit: "programming", count: 51 }).success).toBe(false);
  });
});

// ── get_thread schema ─────────────────────────────────────────────────────────

describe("get_thread schema", () => {
  const tool = () => adapter.tools().find((t) => t.name === "get_thread")!;

  it("accepts a bare post ID", () => {
    expect(tool().inputSchema.safeParse({ thread_id: "abc123" }).success).toBe(true);
  });

  it("accepts a full old.reddit.com URL", () => {
    expect(
      tool().inputSchema.safeParse({
        thread_id: "https://old.reddit.com/r/programming/comments/abc123/a_title/",
      }).success
    ).toBe(true);
  });

  it("accepts a www.reddit.com URL", () => {
    expect(
      tool().inputSchema.safeParse({
        thread_id: "https://www.reddit.com/r/programming/comments/abc123/",
      }).success
    ).toBe(true);
  });

  it("applies defaults (sort=confidence, count=10)", () => {
    const result = tool().inputSchema.parse({ thread_id: "abc123" });
    expect(result.sort).toBe("confidence");
    expect(result.count).toBe(10);
  });

  it("rejects empty thread_id", () => {
    expect(tool().inputSchema.safeParse({ thread_id: "" }).success).toBe(false);
  });

  it("rejects missing thread_id", () => {
    expect(tool().inputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts valid sort values", () => {
    for (const sort of ["confidence", "top", "new", "controversial", "old", "qa"]) {
      expect(tool().inputSchema.safeParse({ thread_id: "abc123", sort }).success).toBe(true);
    }
  });

  it("rejects invalid sort", () => {
    expect(tool().inputSchema.safeParse({ thread_id: "abc123", sort: "best" }).success).toBe(false);
  });
});

// ── search schema ─────────────────────────────────────────────────────────────

describe("search schema", () => {
  const tool = () => adapter.tools().find((t) => t.name === "search")!;

  it("accepts minimal valid input", () => {
    expect(tool().inputSchema.safeParse({ query: "TypeScript" }).success).toBe(true);
  });

  it("applies defaults (sort=relevance, time=all, count=10, no subreddit)", () => {
    const result = tool().inputSchema.parse({ query: "TypeScript" });
    expect(result.sort).toBe("relevance");
    expect(result.time).toBe("all");
    expect(result.count).toBe(10);
    expect(result.subreddit).toBeUndefined();
  });

  it("accepts optional subreddit", () => {
    expect(tool().inputSchema.safeParse({ query: "async", subreddit: "programming" }).success).toBe(true);
  });

  it("rejects empty query", () => {
    expect(tool().inputSchema.safeParse({ query: "" }).success).toBe(false);
  });

  it("rejects missing query", () => {
    expect(tool().inputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts valid search sort values", () => {
    for (const sort of ["relevance", "hot", "top", "new", "comments"]) {
      expect(tool().inputSchema.safeParse({ query: "test", sort }).success).toBe(true);
    }
  });

  it("rejects invalid sort", () => {
    expect(tool().inputSchema.safeParse({ query: "test", sort: "rising" }).success).toBe(false);
  });
});

// ── get_user schema ───────────────────────────────────────────────────────────

describe("get_user schema", () => {
  const tool = () => adapter.tools().find((t) => t.name === "get_user")!;

  it("accepts minimal valid input", () => {
    expect(tool().inputSchema.safeParse({ username: "spez" }).success).toBe(true);
  });

  it("applies defaults (section=overview, count=10)", () => {
    const result = tool().inputSchema.parse({ username: "spez" });
    expect(result.section).toBe("overview");
    expect(result.count).toBe(10);
  });

  it("accepts valid section values", () => {
    for (const section of ["overview", "submitted", "comments"]) {
      expect(tool().inputSchema.safeParse({ username: "spez", section }).success).toBe(true);
    }
  });

  it("rejects invalid section", () => {
    expect(tool().inputSchema.safeParse({ username: "spez", section: "saved" }).success).toBe(false);
  });

  it("rejects empty username", () => {
    expect(tool().inputSchema.safeParse({ username: "" }).success).toBe(false);
  });

  it("rejects missing username", () => {
    expect(tool().inputSchema.safeParse({}).success).toBe(false);
  });
});

// ── htmlToText helper ─────────────────────────────────────────────────────────

describe("htmlToText", () => {
  it("converts anchor tags to markdown links", () => {
    const result = htmlToText('<a href="https://example.com">click here</a>');
    expect(result).toBe("[click here](https://example.com)");
  });

  it("strips paragraph tags with newlines", () => {
    const result = htmlToText("<p>first</p><p>second</p>");
    expect(result).toContain("first");
    expect(result).toContain("second");
  });

  it("strips unknown HTML tags", () => {
    const result = htmlToText("<strong>bold text</strong>");
    expect(result).toBe("bold text");
  });

  it("decodes HTML entities", () => {
    expect(htmlToText("a &amp; b")).toBe("a & b");
    expect(htmlToText("&gt; quoted")).toBe("> quoted");
    expect(htmlToText("it&#x27;s")).toBe("it's");
  });

  it("collapses excessive newlines", () => {
    const result = htmlToText("a\n\n\n\nb");
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("returns empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
  });
});

// ── SELECTORS export ──────────────────────────────────────────────────────────

describe("SELECTORS export", () => {
  it("exports post selector as string", () => {
    expect(typeof SELECTORS.post).toBe("string");
    expect(SELECTORS.post).toContain("thing");
  });

  it("exports postTitle selector", () => {
    expect(typeof SELECTORS.postTitle).toBe("string");
  });

  it("exports comment selector as string", () => {
    expect(typeof SELECTORS.comment).toBe("string");
    expect(SELECTORS.comment).toContain("comment");
  });
});
