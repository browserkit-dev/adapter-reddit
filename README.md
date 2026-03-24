# @browserkit/adapter-reddit

[Reddit](https://old.reddit.com) adapter for [browserkit](https://github.com/browserkit-dev/browserkit) — browse subreddits, threads, search, and user profiles via your local browser session.

Targets `old.reddit.com` — Reddit's classic r2 HTML interface with stable class names unchanged since ~2015. No React DOM churn.

## Tools

| Tool | Key inputs | Description |
|---|---|---|
| `get_subreddit` | `subreddit`, `sort?` (hot/new/top/rising/controversial), `time?`, `count?` | Posts from a subreddit |
| `get_thread` | `thread_id` (post ID or URL), `sort?`, `count?` | Post + top-level comments |
| `search` | `query`, `subreddit?`, `sort?`, `time?`, `count?` | Search Reddit |
| `get_user` | `username`, `section?` (overview/submitted/comments), `count?` | Public user profile |

Plus auto-registered management tools from the framework: `browser` (health check, screenshot, page state, mode switch, navigate), `close_session`.

## Setup

```bash
pnpm add @browserkit/adapter-reddit
```

```js
// browserkit.config.js
import { defineConfig } from "@browserkit/core";

export default defineConfig({
  adapters: {
    "@browserkit/adapter-reddit": { port: 3849 },
  },
});
```

No login required — all four Phase 1 tools work on public Reddit content without authentication.

```bash
browserkit start --config browserkit.config.js
```

Connect your MCP client to `http://127.0.0.1:3849/mcp`.

## Examples

```
// Hot posts from r/programming
get_subreddit({ subreddit: "programming", sort: "hot", count: 10 })

// Top posts of the past week
get_subreddit({ subreddit: "worldnews", sort: "top", time: "week", count: 25 })

// Get a thread and its comments
get_thread({ thread_id: "abc123", sort: "confidence", count: 20 })
get_thread({ thread_id: "https://old.reddit.com/r/programming/comments/abc123/", count: 10 })

// Search
search({ query: "TypeScript performance", subreddit: "programming", sort: "top", time: "month" })

// User profile
get_user({ username: "GovSchwarzenegger", section: "submitted", count: 10 })
```

## Tests

```bash
pnpm test                # L1 unit + L3 MCP protocol + L4 reliability
pnpm test:integration    # L2 live scraping against real old.reddit.com
```

Reddit is a public site — both test suites run without authentication and are safe for CI.

## License

MIT
