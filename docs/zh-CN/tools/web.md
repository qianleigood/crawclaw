---
read_when:
  - 你想启用 web_search、x_search 或 web_fetch
  - 你想了解当前捆绑的 Open-WebSearch 路径
summary: Web 搜索 + 获取工具（web_search、x_search、web_fetch）
title: Web 工具
x-i18n:
  generated_at: "2026-02-03T10:12:43Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 760b706cc966cb421e370f10f8e76047f8ca9fe0a106d90c05d979976789465a
  source_path: tools/web.md
  workflow: 15
---

# Web 工具

CrawClaw 提供轻量级 Web 工具：

- `web_search` — 通过 CrawClaw 捆绑的本地 `open-websearch` daemon 搜索网络。
- `x_search` — 搜索 X（原 Twitter）帖子。
- `web_fetch` — 通过捆绑的 Scrapling provider 抓取页面并返回带上下文预算的快照。

这些**不是**浏览器自动化。对于 JS 密集型网站或需要登录的情况，请使用[浏览器工具](/tools/browser)。

## 工作原理

- `web_search` 通过捆绑的 Open-WebSearch provider 返回结构化结果。
- 结果按查询缓存 15 分钟（可配置）。
- `web_fetch` 默认走捆绑的 `scrapling-fetch` provider；CrawClaw 先做轻量请求和重定向处理，再把抓取交给 provider，并按 `brief` 预算裁剪返回。
- `web_fetch` 默认启用（除非显式禁用）。

## 当前捆绑提供商

当前托管 `web_search` 走的是捆绑的
[Open-WebSearch](/tools/open-websearch) provider。

这意味着：

- `web_search` 本身不需要 API 密钥
- CrawClaw 可以按需自动启动并复用本地 daemon
- 当前托管 `web_search` 只支持 `query`、`count` 这 2 个参数
- CrawClaw 默认会使用内置的全量支持引擎集合
- 旧的提供商专属参数现在不属于当前 `web_search` schema

如果你想显式写进配置，可以这样设置：

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

## web_search

通过捆绑的 Open-WebSearch provider 搜索网络。

### 要求

- `tools.web.search.enabled` 不能为 `false`（默认：启用）
- 正常安装下不需要额外 API 密钥

### 配置

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

Open-WebSearch 专属配置放在
`plugins.entries.open-websearch.config.webSearch.*`。

如果你已经自己运行 daemon，也可以覆盖地址：

```bash
export OPEN_WEBSEARCH_BASE_URL="http://127.0.0.1:3210"
```

### 工具参数

- `query`（必需）
- `count`（1–10；默认来自配置）

CrawClaw 会自动使用内置的全量支持引擎集合。

**示例：**

```javascript
// 基础搜索
await web_search({
  query: "CrawClaw plugin SDK",
});

// 显式限制返回条数
await web_search({
  query: "AI developments",
  count: 3,
});

await web_search({ query: "OpenAI latest news", count: 5 });
```

## web_fetch

获取 URL 并提取可读内容。

### 要求

- `tools.web.fetch.enabled` 不能为 `false`（默认：启用）
- 默认不需要 API 密钥。

### 配置

```json5
{
  plugins: {
    entries: {
      "scrapling-fetch": {
        enabled: true,
        config: {
          service: {
            baseUrl: "http://127.0.0.1:32119",
            command: "python3",
            bootstrap: true,
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
        enabled: true,
        provider: "scrapling",
        maxChars: 50000,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
        maxRedirects: 3,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        readability: true,
      },
    },
  },
}
```

`plugins.entries["scrapling-fetch"].config.service.bootstrap` 默认是 `true`。
gateway 会在插件 state 目录下创建受管虚拟环境，并在 sidecar 启动前安装
固定版本的 Scrapling 运行时依赖。只有当你明确自己维护 Python 环境时，
才建议把它关掉。

### 工具参数

- `url`（必需，仅限 http/https）
- `detail`（`brief` 默认、`standard`、`full`）
- `output`（`markdown` 默认、`text`、`html`、`structured`）
- `render`（provider 提示：`auto` 默认、`never`、`stealth`、`dynamic`）
- `extractMode`（旧参数别名：`markdown` | `text`）
- `extract`（`readable` 默认、`raw`、`links`、`metadata`）
- `mainContentOnly`（优先主正文）
- `timeoutMs`、`waitUntil`、`waitFor`、`sessionId`（provider 扩展参数）
- `maxChars`（内容预算上限）

### 返回结构

`web_fetch` 现在会返回标准化页面快照，常见字段包括：

- `detail`、`output`、`render`
- `summary`、`keyPoints`、`headings`、`contentPreview`
- `content`（仅 `standard` / `full` 默认返回）
- `contentOmitted`、`estimatedTokens`
- 兼容旧调用的 `text`

注意：

- `web_fetch` 默认先走 `scrapling-fetch` provider；如果 provider 不可用或返回错误型 payload，才回退到本地 HTTP + Readability 路径。
- `web_fetch` 默认发送类 Chrome 的 User-Agent 和 `Accept-Language`；如需要可覆盖 `userAgent`。
- `web_fetch` 会校验 URL 协议并重新检查重定向（用 `maxRedirects` 限制）。
- `web_fetch` 是尽力提取；某些网站需要浏览器工具。
- 响应会被缓存（默认 15 分钟）以减少重复获取。
- 如果你使用工具配置文件/允许列表，添加 `web_search`、`x_search`、`web_fetch` 或 `group:web`。

## x_search

`x_search` 通过 xAI 查询 X（原 Twitter）帖子，并返回带引用的综合结果。
它支持自然语言查询，也支持一组结构化过滤条件。CrawClaw 只会在这次
工具调用所对应的请求里挂上内置的 xAI `x_search` 工具。

<Note>
  对于单条帖子上的转发、回复、书签、浏览量等精确指标，优先查询精确的
  帖子 URL 或 status ID。宽泛关键词搜索虽然可能找到目标帖子，但返回的
  单帖元数据通常没有精确定位那么完整。
</Note>

### x_search 配置

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
            apiKey: "xai-...",
          },
        },
      },
    },
  },
}
```

### x_search 参数

- `query`：查询词，必填
- `allowed_x_handles`：只允许这些 X 账号
- `excluded_x_handles`：排除这些 X 账号
- `from_date`：只包含该日期及之后的帖子（`YYYY-MM-DD`）
- `to_date`：只包含该日期及之前的帖子（`YYYY-MM-DD`）
- `enable_image_understanding`：让 xAI 额外理解命中帖文中的图片
- `enable_video_understanding`：让 xAI 额外理解命中帖文中的视频

### x_search 示例

```javascript
await x_search({
  query: "dinner recipes",
  allowed_x_handles: ["nytfood"],
  from_date: "2026-03-01",
});
```

```javascript
await x_search({
  query: "https://x.com/huntharo/status/1905678901234567890",
});
```

## 相关文档

- [Web Fetch](/tools/web-fetch)
- [Browser](/tools/browser)
- [Open-WebSearch](/tools/open-websearch)
