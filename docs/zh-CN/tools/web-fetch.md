---
summary: "web_fetch tool -- 通过 bundled Spider provider 做 context-budgeted fetching"
read_when:
  - 你想 fetch 一个 URL 并提取 readable content
  - 你需要配置 web_fetch 或它的 Spider provider
  - 你想了解 web_fetch limits 和 caching
title: "Web Fetch"
sidebarTitle: "Web Fetch"
x-i18n:
  generated_at: "2026-06-10T12:04:39Z"
  model: codex
  provider: openai
  source_hash: 547d8652f3961993a7ead164e367c47c1d1a5181a56b8a61d795a3ba46dbb81b
  source_path: tools/web-fetch.md
  workflow: 15
---

# Web Fetch

`web_fetch` tool 返回一个 context-budgeted page snapshot。默认情况下，它会在 CrawClaw 完成正常 request validation 和 redirect handling 后，通过 bundled `spider-fetch` provider 路由，然后返回 `brief` response，而不是 dump 整个页面。

对于 JS-heavy sites 或 login-protected pages，请改用 [Web Browser](/tools/browser)。

## Quick start

`web_fetch` **默认启用**，无需配置。agent 可以直接调用：

```javascript
await web_fetch({ url: "https://example.com/article" });
```

## Tool parameters

| Parameter         | Type      | Description                                                          |
| ----------------- | --------- | -------------------------------------------------------------------- |
| `url`             | `string`  | 要 fetch 的 URL（必需，仅 http/https）                               |
| `detail`          | `string`  | `"brief"`（默认）、`"standard"` 或 `"full"`                          |
| `output`          | `string`  | `"markdown"`（默认）、`"text"`、`"html"` 或 `"structured"`           |
| `render`          | `string`  | Provider hint：`"auto"`（默认）、`"never"`、`"stealth"`、`"dynamic"` |
| `extractMode`     | `string`  | `"markdown"` 或 `"text"` 的 legacy alias                             |
| `extract`         | `string`  | `"readable"`（默认）、`"raw"`、`"links"` 或 `"metadata"`             |
| `mainContentOnly` | `boolean` | 可用时优先 main article content                                      |
| `timeoutMs`       | `number`  | 可选 per-request timeout override                                    |
| `waitUntil`       | `string`  | Provider-backed wait hint                                            |
| `waitFor`         | `string`  | Provider-backed selector/readiness hint                              |
| `sessionId`       | `string`  | 可选 sticky provider session id                                      |
| `maxChars`        | `number`  | 截断 returned content budget                                         |

## Return shape

`web_fetch` 现在返回 normalized snapshot，包含如下 fields：

- `detail`、`output`、`render`
- `summary`、`keyPoints`、`headings`、`contentPreview`
- `content`（仅 `standard` / `full`）
- `contentOmitted`、`estimatedTokens`
- legacy-compatible `text`

## How it works

<Steps>
  <Step title="Preflight">
    CrawClaw 先执行 lightweight request，并在 provider 被允许继续之前重新检查 redirects。
  </Step>
  <Step title="Default provider">
    Bundled `spider-fetch` provider 是默认 `web_fetch` path。Static requests 使用 Rust HTTP fetch；`render: "dynamic"` 和 `render: "stealth"` 使用 Spider 的 Rust Chrome integration。它可以 honor `render`、`waitUntil`、`waitFor` 和 `sessionId`，然后把结果塑造成 `brief`、`standard` 或 `full` budget。
  </Step>
  <Step title="Local fallback">
    `render: "auto"` 和 `render: "never"` 保持在 Rust HTTP path。Dynamic rendering 在缺少本地 browser capability 时返回 Spider error；CrawClaw 不会启动 Python sidecar。
  </Step>
  <Step title="Cache">
    Results 会缓存 15 分钟（可配置），以减少对同一 URL 的重复 fetch。
  </Step>
</Steps>

## Config

```json5
{
  plugins: {
    entries: {
      "spider-fetch": {
        enabled: true, // default: true
        config: {
          webFetch: {
            timeoutSeconds: 30,
            maxChars: 50000,
            render: "auto",
          },
        },
      },
    },
  },
  tools: {
    web: {
      fetch: {
        enabled: true, // default: true
        provider: "spider", // default bundled provider
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

Spider fetch 没有 Python virtualenv、service command、sidecar URL 或 runtime package bootstrap。Dynamic rendering 依赖 Rust Spider runtime 可用的 browser capability。

## Limits and safety

- `maxChars` 会被 clamp 到 `tools.web.fetch.maxCharsCap`
- Response body 在 parsing 前 capped at `maxResponseBytes`；oversized responses 会带 warning 截断
- URL scheme 和 redirect count 会在 provider execution 前验证
- Redirects 由 `maxRedirects` 检查并限制
- 默认 bundled provider 是 `spider`
- `web_fetch` 是 best-effort，有些 sites 需要 [Web Browser](/tools/browser)

## Tool profiles

如果使用 tool profiles 或 allowlists，添加 `web_fetch` 或 `group:web`：

```json5
{
  tools: {
    allow: ["web_fetch"],
    // or: allow: ["group:web"]  (includes both web_fetch and web_search)
  },
}
```

## 相关

- [Web Search](/tools/web) -- 使用多个 providers 搜索 web
- [Web Browser](/tools/browser) -- 为 JS-heavy sites 提供完整 browser automation
