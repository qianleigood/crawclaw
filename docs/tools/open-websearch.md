---
summary: "Open-WebSearch provider -- route web_search to a CrawClaw-managed local open-websearch daemon with no API keys"
read_when:
  - You want web_search without API keys
  - You want CrawClaw to use a local open-websearch daemon
  - You need multi-engine fallback search with local control
title: "Open-WebSearch"
---

# Open-WebSearch

CrawClaw can use a bundled [`open-websearch`](https://github.com/Aas-ee/open-webSearch)
daemon as a `web_search` provider. This keeps the existing CrawClaw
`web_search` tool, but routes requests to a managed local daemon instead of a
remote API-backed search provider.

## What This Gives You

- No API keys for search itself
- Multi-engine search behind one local endpoint
- CrawClaw starts the daemon with gateway startup and reuses it for you
- A cleaner fallback path when managed providers are unavailable

## Setup

In normal installs you do not need to install or start a separate service.
When the plugin is enabled and `autoStart` is left on, CrawClaw bootstraps the
daemon during gateway startup and keeps reusing it for `web_search`.

To make it the default `web_search` provider explicitly:

```json5
{
  tools: {
    web: {
      search: {
        provider: "open-websearch",
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

If you already run your own daemon, you can still override the managed URL:

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

## Notes

- `baseUrl` should point at the daemon root, not the MCP endpoint
- Plain `http://` is only accepted for trusted private or loopback hosts
- The bundled plugin is enabled by default
- When no API-backed search provider is configured, CrawClaw can fall back to
  Open-WebSearch as the default keyless provider

## Related

- [Web Search overview](/tools/web)
- [DuckDuckGo Search](/tools/duckduckgo-search)
- [SearXNG Search](/tools/searxng-search)
