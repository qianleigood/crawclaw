---
title: "Web Search"
sidebarTitle: "Web Search"
summary: "web_search and web_fetch -- search the web or fetch page content"
read_when:
  - You want to enable or configure web_search
  - You want to understand the bundled Open-WebSearch path
---

# Web Search

The `web_search` tool searches the web through the bundled
[Open-WebSearch](/tools/open-websearch) provider and returns structured
results. Results are cached by query for 15 minutes by default.

`web_fetch` fetches a specific URL into a context-budgeted page snapshot. For
JS-heavy sites or authenticated pages, use the [Web Browser](/tools/browser).

## Quick start

<Steps>
  <Step title="Enable web_search">
    `open-websearch` is the only bundled managed `web_search` provider. In most
    installs you do not need an API key or a separate service.
  </Step>
  <Step title="Optional configuration">
    ```bash
    crawclaw configure --section web
    ```
  </Step>
  <Step title="Use it">
    ```javascript
    await web_search({ query: "CrawClaw plugin SDK" });
    await web_fetch({ url: "https://docs.crawclaw.ai" });
    ```
  </Step>
</Steps>

## Managed provider

`web_search` routes through [Open-WebSearch](/tools/open-websearch):

- no API key is required for `web_search`
- CrawClaw can auto-start and reuse the local daemon
- the model-visible schema supports `query` and `count`
- older API-backed search providers are no longer part of the managed tool

## Native Codex web search

Codex-capable models can optionally use the provider-native Responses
`web_search` tool instead of CrawClaw's managed function.

- Configure it under `tools.web.search.openaiCodex`
- It only activates for Codex-capable models
- Managed `web_search` still applies to non-Codex models
- `mode: "cached"` is the default and recommended setting
- `tools.web.search.enabled: false` disables both managed and native search

```json5
{
  tools: {
    web: {
      search: {
        enabled: true,
        provider: "open-websearch",
        openaiCodex: {
          enabled: true,
          mode: "cached",
          allowedDomains: ["example.com"],
        },
      },
    },
  },
}
```

## Config

```json5
{
  tools: {
    web: {
      search: {
        enabled: true,
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
[Open-WebSearch](/tools/open-websearch) for daemon options.

## Tool parameters

| Tool         | Parameter | Description                         |
| ------------ | --------- | ----------------------------------- |
| `web_search` | `query`   | Search query (required)             |
| `web_search` | `count`   | Results to return (1-10, default 5) |
| `web_fetch`  | `url`     | HTTP or HTTPS URL to fetch          |

## Tool profiles

If you use tool profiles or allowlists, add `web_search`, `web_fetch`, or
`group:web`:

```json5
{
  tools: {
    allow: ["web_search", "web_fetch"],
  },
}
```

## Related

- [Web Fetch](/tools/web-fetch) -- fetch a URL and extract readable content
- [Web Browser](/tools/browser) -- full browser automation for JS-heavy sites
- [Open-WebSearch](/tools/open-websearch) -- bundled provider used by managed `web_search`
