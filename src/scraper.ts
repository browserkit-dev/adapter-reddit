/**
 * Reddit data extraction using the Reddit JSON API.
 *
 * Reddit's JSON API (www.reddit.com/r/{sub}.json) is publicly accessible
 * without authentication or bot-detection challenges. We use Node.js fetch
 * for Phase 1 (public) tools — this works reliably in CI and without a
 * browser session. Phase 2 tools will use the browser page for authenticated
 * endpoints that require cookies.
 *
 * All public URL endpoints accept a .json suffix to get machine-readable data.
 * See: https://www.reddit.com/dev/api
 */

import type { Page } from "patchright";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RedditPost {
  /** Reddit post ID (without "t3_" prefix), e.g. "abc123" */
  id: string;
  rank: number;
  title: string;
  /** External URL (or commentsUrl for self posts) */
  url: string;
  domain: string;
  score: number;
  author: string;
  subreddit: string;
  /** Human-readable age, e.g. "3 hours ago" */
  age: string;
  /** ISO 8601 timestamp */
  ageIso: string;
  numComments: number;
  /** Full URL to the Reddit thread */
  commentsUrl: string;
  /** True for self (text) posts */
  isSelf: boolean;
  flair: string;
}

export interface RedditComment {
  /** Comment ID (without "t1_" prefix) */
  id: string;
  author: string;
  /** Score as number, or "[score hidden]" */
  score: number | string;
  age: string;
  ageIso: string;
  body: string;
  depth: number;
}

export interface RedditThread {
  post: RedditPost | null;
  comments: RedditComment[];
}

// ── Reddit API types (internal) ───────────────────────────────────────────────

interface RedditApiPost {
  id: string;
  title: string;
  url: string;
  domain: string;
  score: number;
  author: string;
  subreddit: string;
  created_utc: number;
  num_comments: number;
  permalink: string;
  is_self: boolean;
  link_flair_text: string | null;
  selftext?: string;
}

interface RedditApiComment {
  id: string;
  author: string;
  score: number | string;
  created_utc: number;
  body: string;
  replies?: { data?: { children?: Array<{ data?: RedditApiComment }> } } | string;
  depth?: number;
}

interface RedditApiListing {
  data: {
    children: Array<{ data: RedditApiPost }>;
  };
}

interface RedditApiThreadListing {
  data: {
    children: Array<{ data: RedditApiComment }>;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert Reddit's unix timestamp to a human-readable age string. */
function toAge(createdUtc: number): string {
  const now = Date.now();
  const diffMs = now - createdUtc * 1000;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  const diffMo = Math.floor(diffDays / 30);
  if (diffMo < 12) return `${diffMo} month${diffMo !== 1 ? "s" : ""} ago`;
  return `${Math.floor(diffMo / 12)} year${Math.floor(diffMo / 12) !== 1 ? "s" : ""} ago`;
}

/** Shared fetch call with a sensible User-Agent. */
async function redditFetch(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "browserkit/1.0 (https://github.com/browserkit-dev/browserkit)",
      "Accept": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Reddit API returned ${response.status} for ${url}`);
  }
  return response.json();
}

/**
 * Build the .json API URL from any Reddit listing/page URL.
 * Appends .json to the pathname (before the query string), then adds
 * limit and raw_json params.
 * e.g. https://www.reddit.com/r/programming/hot?t=day
 *   → https://www.reddit.com/r/programming/hot.json?t=day&limit=25&raw_json=1
 */
function toJsonUrl(url: string, limit: number): string {
  const u = new URL(url);
  // Strip trailing slash before adding .json
  u.pathname = u.pathname.replace(/\/$/, "") + ".json";
  u.searchParams.set("limit", String(Math.min(limit, 100)));
  u.searchParams.set("raw_json", "1");
  return u.toString();
}

/** Map a raw Reddit API post object to our RedditPost type. */
function toPost(raw: RedditApiPost, rank: number): RedditPost {
  return {
    id: raw.id,
    rank,
    title: raw.title,
    url: raw.is_self
      ? `https://www.reddit.com${raw.permalink}`
      : raw.url,
    domain: raw.domain,
    score: raw.score,
    author: raw.author,
    subreddit: raw.subreddit,
    age: toAge(raw.created_utc),
    ageIso: new Date(raw.created_utc * 1000).toISOString(),
    numComments: raw.num_comments,
    commentsUrl: `https://old.reddit.com${raw.permalink}`,
    isSelf: raw.is_self,
    flair: raw.link_flair_text ?? "",
  };
}

// ── Post listing ──────────────────────────────────────────────────────────────

/**
 * Fetch posts from any Reddit listing URL using the JSON API.
 * The `page` parameter is accepted for interface consistency (Phase 2 will use it).
 */
export async function scrapePostListing(
  _page: Page,
  count: number,
  listingUrl: string
): Promise<RedditPost[]> {
  const jsonUrl = toJsonUrl(listingUrl, count);
  const data = await redditFetch(jsonUrl) as RedditApiListing;

  return data.data.children
    .slice(0, count)
    .map((child, idx) => toPost(child.data, idx + 1))
    .filter((p) => p.title.length > 0);
}

// ── Thread (post + comments) ──────────────────────────────────────────────────

/**
 * Fetch a Reddit thread (post + top-level comments) using the JSON API.
 */
export async function scrapeThread(
  _page: Page,
  commentCount: number,
  threadUrl: string
): Promise<RedditThread> {
  const jsonUrl = toJsonUrl(threadUrl, commentCount);
  const data = await redditFetch(jsonUrl) as [RedditApiListing, RedditApiThreadListing];

  // data[0] = the post, data[1] = the comment listing
  const postRaw = data[0]?.data?.children?.[0]?.data;
  const post = postRaw ? toPost(postRaw as unknown as RedditApiPost, 0) : null;

  // Extract top-level comments (depth === 0)
  const commentChildren = data[1]?.data?.children ?? [];
  const comments: RedditComment[] = commentChildren
    .slice(0, commentCount)
    .filter((c) => c.data && c.data.author !== undefined)
    .map((c): RedditComment => {
      const raw = c.data;
      const scoreNum = typeof raw.score === "number" ? raw.score : -1;
      return {
        id: raw.id,
        author: raw.author,
        score: scoreNum === -1 ? "[score hidden]" : raw.score,
        age: toAge(raw.created_utc),
        ageIso: new Date(raw.created_utc * 1000).toISOString(),
        body: (raw.body ?? "").slice(0, 1000),
        depth: 0,
      };
    });

  return { post, comments };
}

// ── HTML to plain text (for potential future use with browser-rendered content) ─

/**
 * Convert comment HTML to plain text preserving links as markdown [text](url).
 * Used when browser-rendered comment HTML is available (Phase 2 scenarios).
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, href: string, text: string) => {
      const cleanText = text.replace(/<[^>]+>/g, "").trim();
      return cleanText ? `[${cleanText}](${href})` : href;
    })
    .replace(/<p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (_, inner: string) =>
      inner.replace(/^/gm, "> ").trim()
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
