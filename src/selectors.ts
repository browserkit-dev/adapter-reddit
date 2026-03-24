/**
 * old.reddit.com DOM selectors — targeting Reddit's classic r2 HTML.
 *
 * old.reddit.com uses stable class names that haven't changed since ~2015.
 * It's the right target for automation: static HTML, no React, predictable DOM.
 *
 * Prefer data-* attributes on div.thing for post data — Reddit populates them
 * richly (data-fullname, data-author, data-score, data-num-comments, etc.)
 * CSS selectors here cover title/rank (not in data-*) and comment extraction.
 *
 * Selector stability: data-* attributes > semantic class names > structural
 */

export const SELECTORS = {
  // ── Post listing ────────────────────────────────────────────────────────────
  // Each post is a div.thing.link with rich data-* attributes:
  //   data-fullname, data-author, data-subreddit, data-url, data-domain,
  //   data-score, data-num-comments, data-permalink, data-timestamp
  post: "div.thing.link",
  postTitle: "a.title",      // title text + href (external URL)
  postRank: ".rank",         // rank number (e.g. "1.")
  postFlair: ".flair",       // link flair text (may be absent)

  // ── Thread page ─────────────────────────────────────────────────────────────
  // Top-level post on a comments/thread page
  threadPost: "div.thing.link",

  // ── Comments ─────────────────────────────────────────────────────────────────
  comment: "div.thing.comment",
  commentBody: ".usertext-body .md",     // rendered markdown HTML
  commentAuthor: ".entry .tagline a.author",
  commentScore: ".score.unvoted",         // may be ".score.dislikes" or ".score.likes"
  commentAge: "time.live-timestamp",      // datetime attribute = ISO timestamp
  // Indent image: width 0 = top-level, 10 = depth 1, 20 = depth 2, etc.
  commentIndent: ".entry .tagline",      // use data-* or parent .ind img for depth

  // ── Pagination ──────────────────────────────────────────────────────────────
  nextPage: ".nav-buttons .next-button a",

  // ── Auth (Phase 2) ───────────────────────────────────────────────────────────
  // Logged-in header shows: #header-bottom-right .user a[href^="/user/"]
  userLink: "#header-bottom-right .user a",
  loginForm: "#login_login-main",
} as const;
