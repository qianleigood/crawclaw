---
read_when:
  - 你想要启用或配置 web_search
  - 你想要了解捆绑的 SearXNG 路径
sidebarTitle: Web Search
summary: web_search 和 web_fetch -- 搜索网页或获取页面内容
title: Web 搜索
x-i18n:
  generated_at: "2026-06-10T19:38:50Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 983d2b7a03e171310d35cd86f7f90092fb790581d8e81937591e5e7319fe6594
  source_path: tools/web.md
  workflow: 15
---

# Web 搜索

这个 `web_search` 工具通过捆绑的 SearXNG 提供商搜索网络，并返回结构化结果。结果按查询缓存，默认缓存 15 分钟。

`web_fetch` 获取特定 URL 到受上下文预算限制的页面快照。对于需要 JavaScript 的站点或需要认证的页面，请使用 [Web 浏览器](/tools/browser)。

## 快速开始

<Steps>
  <Step title="启用 web_search">
    `searxng` 是唯一的捆绑托管 `web_search` 提供商。在大多数安装中，你不需要 API 密钥或单独托管的服务。
  </Step>
  <Step title="可选配置">
    保持默认值，除非你需要不同的结果限制、超时、缓存 TTL 或预先存在的 SearXNG 端点。这些值位于 `tools.web.search.*` 和 `plugins.entries.searxng.config.webSearch.*` 下。
  </Step>
  <Step title="使用它">
    ```javascript
    await web_search({ query: "CrawClaw plugin SDK" });
    await web_fetch({ url: "https://docs.crawclaw.ai" });
    ```
  </Step>
</Steps>

## 托管提供商

`web_search` 通过 CrawClaw 托管的 SearXNG 路由：

- 无需 API 密钥即可使用 `web_search`
- CrawClaw 可以自动启动并重用 local loopback 边车
- 模型可见 schema 支持 `query`、 `count`、 `engines`、
  `categories`、 `language`、 `safeSearch`、 `timeRange`和 `timeoutSeconds`
- 较旧的基于 API 的搜索提供商不再属于托管工具

## 配置

```json5
{
  tools: {
    web: {
      search: {
        enabled: true,
        provider: "searxng",
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
      },
    },
  },
  plugins: {
    entries: {
      searxng: {
        enabled: true,
        config: {
          webSearch: {
            autoStart: true,
            host: "127.0.0.1",
            port: 3210,
            healthPath: "/",
          },
        },
      },
    },
  },
}
```

SearXNG 特定配置位于
`plugins.entries.searxng.config.webSearch.*`。`baseUrl` 是显式管理的 SearXNG 端点的高级覆盖；纯 `http://` 端点必须是 loopback（本地回环），而远程端点必须使用 `https://`。

## 工具参数

| 工具         | 参数             | 描述                             |
| ------------ | ---------------- | -------------------------------- |
| `web_search` | `query`          | 搜索查询（必填）                 |
| `web_search` | `count`          | 返回结果数量（1-10，默认 5）     |
| `web_search` | `engines`        | 可选 SearXNG engine id           |
| `web_search` | `categories`     | 可选 SearXNG category            |
| `web_search` | `language`       | 可选结果语言                     |
| `web_search` | `safeSearch`     | `off`、`moderate` 或 `strict`    |
| `web_search` | `timeRange`      | `day`、`week`、`month` 或 `year` |
| `web_search` | `timeoutSeconds` | 请求超时时间                     |
| `web_fetch`  | `url`            | 要获取的 HTTP 或 HTTPS URL       |

## 工具配置

如果你使用工具配置或允许列表，请添加 `web_search`、 `web_fetch`或
`group:web`：

```json5
{
  tools: {
    allow: ["web_search", "web_fetch"],
  },
}
```

## 相关

- [Web 获取](/tools/web-fetch) -- 获取 URL 并提取可读内容
- [Web 浏览器](/tools/browser) -- 适用于需要 JavaScript 站点的完整浏览器自动化
