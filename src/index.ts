import { defineAdapter } from "@browserkit/core";
import { z } from "zod";
import type { Page } from "patchright";
import { SELECTORS } from "./selectors.js";
import { scrapePostListing, scrapeThread } from "./scraper.js";

// ── Schemas ───────────────────────────────────────────────────────────────────

const VALID_SORTS = ["hot", "new", "top", "rising", "controversial"] as const;
const VALID_TIME = ["hour", "day", "week", "month", "year", "all"] as const;
const VALID_COMMENT_SORTS = ["confidence", "top", "new", "controversial", "old", "qa"] as const;
const VALID_SEARCH_SORTS = ["relevance", "hot", "top", "new", "comments"] as const;
const VALID_USER_SECTIONS = ["overview", "submitted", "comments"] as const;

const listingSchema = z.object({
  subreddit: z.string().min(1).describe("Subreddit name, e.g. 'programming', 'worldnews'"),
  sort: z.enum(VALID_SORTS).default("hot").describe("Sort: hot, new, top, rising, controversial"),
  time: z.enum(VALID_TIME).default("all").describe("Time filter (only applies to top/controversial): hour, day, week, month, year, all"),
  count: z.number().int().min(1).max(50).default(10).describe("Number of posts to return (1–50)"),
});

const threadSchema = z.object({
  thread_id: z
    .string()
    .min(1)
    .describe(
      "Reddit post ID (e.g. 'abc123') or full Reddit URL (e.g. 'https://old.reddit.com/r/programming/comments/abc123/...')"
    ),
  sort: z.enum(VALID_COMMENT_SORTS).default("confidence").describe("Comment sort: confidence (best), top, new, controversial, old, qa"),
  count: z.number().int().min(1).max(50).default(10).describe("Number of top-level comments to return (1–50)"),
});

const searchSchema = z.object({
  query: z.string().min(1).describe("Search query, e.g. 'TypeScript tutorial'"),
  subreddit: z.string().optional().describe("Restrict search to a subreddit, e.g. 'programming'"),
  sort: z.enum(VALID_SEARCH_SORTS).default("relevance").describe("Sort: relevance, hot, top, new, comments"),
  time: z.enum(VALID_TIME).default("all").describe("Time filter: hour, day, week, month, year, all"),
  count: z.number().int().min(1).max(50).default(10).describe("Number of results to return (1–50)"),
});

const userSchema = z.object({
  username: z.string().min(1).describe("Reddit username (without u/ prefix), e.g. 'spez'"),
  section: z.enum(VALID_USER_SECTIONS).default("overview").describe("Section: overview, submitted (posts only), comments (comments only)"),
  count: z.number().int().min(1).max(50).default(10).describe("Number of items to return (1–50)"),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse thread_id: accepts either a bare post ID (alphanumeric) or a full
 * Reddit URL. Returns the post ID string.
 */
function parseThreadId(input: string): string {
  // Full URL: https://(old|www).reddit.com/r/sub/comments/ID/...
  if (input.includes("reddit.com/")) {
    const match = /\/comments\/([a-z0-9]+)/i.exec(input);
    return match?.[1] ?? input;
  }
  return input;
}

/** Build a thread URL from an ID and sort */
function buildThreadUrl(id: string, sort: string): string {
  return `https://www.reddit.com/comments/${id}/?sort=${sort}`;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export default defineAdapter({
  site: "reddit",
  domain: "reddit.com",
  loginUrl: "https://old.reddit.com/login",
  selectors: { post: SELECTORS.post, nextPage: SELECTORS.nextPage },
  rateLimit: { minDelayMs: 2_000 },

  // Phase 1: public content only — always return true.
  // Phase 2 will replace this with real auth detection on the browser page.
  async isLoggedIn(_page: Page): Promise<boolean> {
    return true;
  },

  tools: () => [

    // ── get_subreddit ───────────────────────────────────────────────────────
    {
      name: "get_subreddit",
      description: [
        "Get posts from a subreddit on Reddit.",
        "Returns ranked posts with title, score, author, comment count, and URLs.",
        "",
        "Examples:",
        "  get_subreddit({ subreddit: 'programming', sort: 'hot', count: 10 })",
        "  get_subreddit({ subreddit: 'worldnews', sort: 'top', time: 'day', count: 25 })",
      ].join("\n"),
      inputSchema: listingSchema,
      annotations: { readOnlyHint: true as const, openWorldHint: true as const },
      async handler(page: Page, input: unknown) {
        const { subreddit, sort, time, count } = listingSchema.parse(input);

        // time param only affects top/controversial
        const timeParam = (sort === "top" || sort === "controversial") ? `?t=${time}` : "";
        const url = `https://www.reddit.com/r/${subreddit}/${sort}${timeParam}`;

        const posts = await scrapePostListing(page, count, url);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(posts, null, 2) }],
        };
      },
    },

    // ── get_thread ──────────────────────────────────────────────────────────
    {
      name: "get_thread",
      description: [
        "Get a Reddit post and its top-level comments.",
        "Accepts a post ID (e.g. 'abc123') or a full Reddit URL.",
        "",
        "Returns: { post: RedditPost, comments: RedditComment[] }",
        "",
        "Examples:",
        "  get_thread({ thread_id: 'abc123', count: 10 })",
        "  get_thread({ thread_id: 'https://old.reddit.com/r/programming/comments/abc123/title/', sort: 'top' })",
      ].join("\n"),
      inputSchema: threadSchema,
      annotations: { readOnlyHint: true as const, openWorldHint: true as const },
      async handler(page: Page, input: unknown) {
        const { thread_id, sort, count } = threadSchema.parse(input);
        const postId = parseThreadId(thread_id);

        if (!postId || !/^[a-z0-9]+$/i.test(postId)) {
          return {
            content: [{ type: "text" as const, text: `Invalid thread ID: "${thread_id}". Provide a post ID or a full Reddit URL.` }],
            isError: true,
          };
        }

        const url = buildThreadUrl(postId, sort);

        try {
          const thread = await scrapeThread(page, count, url);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(thread, null, 2) }],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("404") || message.includes("403")) {
            return {
              content: [{ type: "text" as const, text: `Thread "${postId}" not found or private.` }],
              isError: true,
            };
          }
          throw err;
        }
      },
    },

    // ── search ──────────────────────────────────────────────────────────────
    {
      name: "search",
      description: [
        "Search Reddit for posts matching a query.",
        "Optionally restrict to a specific subreddit.",
        "",
        "Returns an array of matching posts with title, score, subreddit, and URLs.",
        "",
        "Examples:",
        "  search({ query: 'TypeScript async await', sort: 'relevance', count: 10 })",
        "  search({ query: 'best practices', subreddit: 'programming', sort: 'top', time: 'month' })",
      ].join("\n"),
      inputSchema: searchSchema,
      annotations: { readOnlyHint: true as const, openWorldHint: true as const },
      async handler(page: Page, input: unknown) {
        const { query, subreddit, sort, time, count } = searchSchema.parse(input);

        const params = new URLSearchParams({ q: query, sort, t: time });
        let url: string;
        if (subreddit) {
          params.set("restrict_sr", "on");
          url = `https://www.reddit.com/r/${subreddit}/search?${params.toString()}`;
        } else {
          url = `https://www.reddit.com/search?${params.toString()}`;
        }

        const posts = await scrapePostListing(page, count, url);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(posts, null, 2) }],
        };
      },
    },

    // ── get_user ────────────────────────────────────────────────────────────
    {
      name: "get_user",
      description: [
        "Get posts or comments from a Reddit user's public profile.",
        "",
        "Sections: overview (posts + comments), submitted (posts only), comments (comments only)",
        "",
        "Returns an array of posts from the user's profile page.",
        "",
        "Examples:",
        "  get_user({ username: 'spez', section: 'submitted', count: 10 })",
        "  get_user({ username: 'GovSchwarzenegger', section: 'overview', count: 20 })",
      ].join("\n"),
      inputSchema: userSchema,
      annotations: { readOnlyHint: true as const, openWorldHint: true as const },
      async handler(page: Page, input: unknown) {
        const { username, section, count } = userSchema.parse(input);

        const url = `https://www.reddit.com/user/${username}/${section}`;

        try {
          const posts = await scrapePostListing(page, count, url);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(posts, null, 2) }],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("404") || message.includes("403")) {
            return {
              content: [{ type: "text" as const, text: `User "${username}" not found or account suspended.` }],
              isError: true,
            };
          }
          throw err;
        }
      },
    },

  ],
});
