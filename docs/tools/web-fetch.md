---
summary: "web_fetch tool -- context-budgeted fetching through the bundled Scrapling provider"
read_when:
  - You want to fetch a URL and extract readable content
  - You need to configure web_fetch or its Scrapling provider
  - You want to understand web_fetch limits and caching
title: "Web Fetch"
sidebarTitle: "Web Fetch"
---

# Web Fetch

The `web_fetch` tool returns a context-budgeted page snapshot. By default it
routes through the bundled `scrapling-fetch` provider after CrawClaw performs
its normal request validation and redirect handling, then returns a `brief` response instead of
dumping the whole page.

For JS-heavy sites or login-protected pages, use the
[Web Browser](/tools/browser) instead.

## Quick start

`web_fetch` is **enabled by default** -- no configuration needed. The agent can
call it immediately:

```javascript
await web_fetch({ url: "https://example.com/article" });
```

## Tool parameters

| Parameter         | Type      | Description                                                            |
| ----------------- | --------- | ---------------------------------------------------------------------- |
| `url`             | `string`  | URL to fetch (required, http/https only)                               |
| `detail`          | `string`  | `"brief"` (default), `"standard"`, or `"full"`                         |
| `output`          | `string`  | `"markdown"` (default), `"text"`, `"html"`, or `"structured"`          |
| `render`          | `string`  | Provider hint: `"auto"` (default), `"never"`, `"stealth"`, `"dynamic"` |
| `extractMode`     | `string`  | Legacy alias for `"markdown"` or `"text"`                              |
| `extract`         | `string`  | `"readable"` (default), `"raw"`, `"links"`, or `"metadata"`            |
| `mainContentOnly` | `boolean` | Prefer main article content when available                             |
| `timeoutMs`       | `number`  | Optional per-request timeout override                                  |
| `waitUntil`       | `string`  | Provider-backed wait hint                                              |
| `waitFor`         | `string`  | Provider-backed selector/readiness hint                                |
| `sessionId`       | `string`  | Optional sticky provider session id                                    |
| `maxChars`        | `number`  | Truncate returned content budget                                       |

## Return shape

`web_fetch` now returns a normalized snapshot with fields such as:

- `detail`, `output`, `render`
- `summary`, `keyPoints`, `headings`, `contentPreview`
- `content` (only for `standard` / `full`)
- `contentOmitted`, `estimatedTokens`
- legacy-compatible `text`

## How it works

<Steps>
  <Step title="Preflight">
    CrawClaw performs a lightweight request first and re-checks redirects before
    the provider is allowed to continue.
  </Step>
  <Step title="Default provider">
    The bundled `scrapling-fetch` provider is the default `web_fetch` path. It
    can honor `render`, `waitUntil`, `waitFor`, and `sessionId`, then shapes
    the result into a `brief`, `standard`, or `full` budget.
  </Step>
  <Step title="Local fallback">
    If the provider is unavailable or returns an error-like payload, CrawClaw
    falls back to the local HTTP + Readability path so plain pages still work
    without Python-side dependencies.
  </Step>
  <Step title="Cache">
    Results are cached for 15 minutes (configurable) to reduce repeated
    fetches of the same URL.
  </Step>
</Steps>

## Config

```json5
{
  plugins: {
    entries: {
      "scrapling-fetch": {
        enabled: true, // default: true
        config: {
          service: {
            baseUrl: "http://127.0.0.1:32119",
            command: "python3",
            bootstrap: true, // default: true
            bootstrapPackages: ["Scrapling==0.4.4", "curl-cffi==0.15.0", "playwright==1.58.0"],
            startupTimeoutMs: 15000,
          },
        },
      },
    },
  },
  tools: {
    web: {
      fetch: {
        enabled: true, // default: true
        provider: "scrapling", // default bundled provider
        maxChars: 50000, // max output chars
        maxCharsCap: 50000, // hard cap for maxChars param
        maxResponseBytes: 2000000, // max download size before truncation
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
        maxRedirects: 3,
        readability: true, // use Readability extraction
        userAgent: "Mozilla/5.0 ...", // override User-Agent
      },
    },
  },
}
```

When `plugins.entries["scrapling-fetch"].config.service.bootstrap` is left at
its default `true`, gateway creates a plugin-owned virtualenv under the plugin
state directory and installs the pinned Scrapling runtime packages before the
sidecar starts. Set it to `false` only if you manage the Python environment
yourself.

## Limits and safety

- `maxChars` is clamped to `tools.web.fetch.maxCharsCap`
- Response body is capped at `maxResponseBytes` before parsing; oversized
  responses are truncated with a warning
- URL scheme and redirect count are validated before provider execution
- Redirects are checked and limited by `maxRedirects`
- The default bundled provider is `scrapling`
- `web_fetch` is best-effort -- some sites need the [Web Browser](/tools/browser)

## Tool profiles

If you use tool profiles or allowlists, add `web_fetch` or `group:web`:

```json5
{
  tools: {
    allow: ["web_fetch"],
    // or: allow: ["group:web"]  (includes both web_fetch and web_search)
  },
}
```

## Related

- [Web Search](/tools/web) -- search the web with multiple providers
- [Web Browser](/tools/browser) -- full browser automation for JS-heavy sites
