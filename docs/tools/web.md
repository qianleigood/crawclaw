---
title: "Web Search"
sidebarTitle: "Web Search"
summary: "web_search, x_search, and web_fetch -- search the web, search X posts, or fetch page content"
read_when:
  - You want to enable or configure web_search
  - You want to enable or configure x_search
  - You want to understand the bundled Open-WebSearch path
---

# Web Search

The `web_search` tool searches the web through the bundled
[Open-WebSearch](/tools/open-websearch) provider and returns structured
results. Results are cached by query for 15 minutes (configurable).

CrawClaw also includes `x_search` for X (formerly Twitter) posts and
`web_fetch` for context-budgeted page fetching through the bundled Scrapling path.

<Info>
  `web_search` is a lightweight HTTP tool, not browser automation. For
  JS-heavy sites or logins, use the [Web Browser](/tools/browser). For
  fetching a specific URL, use [Web Fetch](/tools/web-fetch).
</Info>

## Quick start

<Steps>
  <Step title="Enable web_search">
    `open-websearch` is the bundled managed provider. In most installs you do
    not need an API key or a separate service.
  </Step>
  <Step title="Optional configuration">
    ```bash
    crawclaw configure --section web
    ```
    This lets you confirm `web_search` is enabled and optionally override the
    local daemon URL.
  </Step>
  <Step title="Use it">
    The agent can now call `web_search`:

    ```javascript
    await web_search({ query: "CrawClaw plugin SDK" });
    ```

    For X posts, use:

    ```javascript
    await x_search({ query: "dinner recipes" });
    ```

  </Step>
</Steps>

## Bundled provider

`web_search` now routes through the bundled
[Open-WebSearch](/tools/open-websearch) provider.

What this means in practice:

- No API key is required for `web_search` itself
- CrawClaw can auto-start and reuse the local daemon for you
- The managed `web_search` tool currently supports only the parameters exposed
  by Open-WebSearch: `query` and `count`
- CrawClaw uses its built-in supported engine set by default
- Provider-specific parameters from older API-backed integrations are not part of
  the current managed `web_search` schema

## Native Codex web search

Codex-capable models can optionally use the provider-native Responses `web_search` tool instead of CrawClaw's managed `web_search` function.

- Configure it under `tools.web.search.openaiCodex`
- It only activates for Codex-capable models (`openai-codex/*` or providers using `api: "openai-codex-responses"`)
- Managed `web_search` still applies to non-Codex models
- `mode: "cached"` is the default and recommended setting
- `tools.web.search.enabled: false` disables both managed and native search

```json5
{
  tools: {
    web: {
      search: {
        enabled: true,
        openaiCodex: {
          enabled: true,
          mode: "cached",
          allowedDomains: ["example.com"],
          contextSize: "high",
          userLocation: {
            country: "US",
            city: "New York",
            timezone: "America/New_York",
          },
        },
      },
    },
  },
}
```

If native Codex search is enabled but the current model is not Codex-capable, CrawClaw keeps the normal managed `web_search` behavior.

## Setting up web search

CrawClaw uses the bundled `open-websearch` provider for managed `web_search`.
In normal installs, no extra setup is required beyond enabling `web_search`.

## Config

```json5
{
  tools: {
    web: {
      search: {
        enabled: true, // default: true
        provider: "open-websearch",
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
      },
    },
  },
  plugins: {
    entries: {
      "open-websearch": {
        enabled: true,
        config: {
          webSearch: {
            autoStart: true,
            host: "127.0.0.1",
            port: 3210,
          },
        },
      },
    },
  },
}
```

Open-WebSearch-specific config lives under
`plugins.entries.open-websearch.config.webSearch.*`. See
[Open-WebSearch](/tools/open-websearch) for the daemon-specific options.

For `x_search`, configure `plugins.entries.xai.config.xSearch.*`. It uses the
same `XAI_API_KEY` fallback as Grok web search.
Legacy `tools.web.x_search.*` config is auto-migrated by `crawclaw doctor --fix`.
When you choose Grok during `crawclaw onboard` or `crawclaw configure --section web`,
CrawClaw can also offer optional `x_search` setup with the same key.
This is a separate follow-up step inside the Grok path, not a separate top-level
web-search provider choice. If you pick another provider, CrawClaw does not
show the `x_search` prompt.

### Optional daemon override

If you already run your own daemon, you can point CrawClaw at it:

```bash
export OPEN_WEBSEARCH_BASE_URL="http://127.0.0.1:3210"
```

## Tool parameters

| Parameter | Description                          |
| --------- | ------------------------------------ |
| `query`   | Search query (required)              |
| `count`   | Results to return (1-10, default: 5) |

CrawClaw uses the built-in supported engine set automatically for managed
`web_search` calls.

## x_search

`x_search` queries X (formerly Twitter) posts using xAI and returns
AI-synthesized answers with citations. It accepts natural-language queries and
optional structured filters. CrawClaw only enables the built-in xAI `x_search`
tool on the request that serves this tool call.

<Note>
  xAI documents `x_search` as supporting keyword search, semantic search, user
  search, and thread fetch. For per-post engagement stats such as reposts,
  replies, bookmarks, or views, prefer a targeted lookup for the exact post URL
  or status ID. Broad keyword searches may find the right post but return less
  complete per-post metadata. A good pattern is: locate the post first, then
  run a second `x_search` query focused on that exact post.
</Note>

### x_search config

```json5
{
  plugins: {
    entries: {
      xai: {
        config: {
          xSearch: {
            enabled: true,
            model: "grok-4-1-fast-non-reasoning",
            inlineCitations: false,
            maxTurns: 2,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
          webSearch: {
            apiKey: "xai-...", // optional if XAI_API_KEY is set
          },
        },
      },
    },
  },
}
```

### x_search parameters

| Parameter                    | Description                                            |
| ---------------------------- | ------------------------------------------------------ |
| `query`                      | Search query (required)                                |
| `allowed_x_handles`          | Restrict results to specific X handles                 |
| `excluded_x_handles`         | Exclude specific X handles                             |
| `from_date`                  | Only include posts on or after this date (YYYY-MM-DD)  |
| `to_date`                    | Only include posts on or before this date (YYYY-MM-DD) |
| `enable_image_understanding` | Let xAI inspect images attached to matching posts      |
| `enable_video_understanding` | Let xAI inspect videos attached to matching posts      |

### x_search example

```javascript
await x_search({
  query: "dinner recipes",
  allowed_x_handles: ["nytfood"],
  from_date: "2026-03-01",
});
```

```javascript
// Per-post stats: use the exact status URL or status ID when possible
await x_search({
  query: "https://x.com/huntharo/status/1905678901234567890",
});
```

## Examples

```javascript
// Basic search
await web_search({ query: "CrawClaw plugin SDK" });

// Explicit result count
await web_search({ query: "AI developments", count: 3 });

await web_search({ query: "OpenAI latest news", count: 5 });
```

## Tool profiles

If you use tool profiles or allowlists, add `web_search`, `x_search`, or `group:web`:

```json5
{
  tools: {
    allow: ["web_search", "x_search"],
    // or: allow: ["group:web"]  (includes web_search, x_search, and web_fetch)
  },
}
```

## Related

- [Web Fetch](/tools/web-fetch) -- fetch a URL and extract readable content
- [Web Browser](/tools/browser) -- full browser automation for JS-heavy sites
- [Open-WebSearch](/tools/open-websearch) -- bundled provider used by managed `web_search`
