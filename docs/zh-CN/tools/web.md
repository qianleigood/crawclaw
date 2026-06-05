---
read_when:
  - 你想启用或配置 web_search
  - 你想了解捆绑的 SearXNG 路径
sidebarTitle: Web Search
summary: web_search 和 web_fetch -- 搜索网络或获取页面内容
title: 网络搜索
x-i18n:
  generated_at: "2026-06-05T15:01:41Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: a26e26ef6aaff0009316f506d73b97713d4507afad09f3789fb84e7ee242230e
  source_path: tools/web.md
  workflow: 15
---

# 网络搜索

`web_search` 工具通过捆绑的 SearXNG 提供商搜索网络并返回结构化结果。默认情况下，结果按查询缓存 15 分钟。

`web_fetch` 获取特定 URL 到上下文预算内的页面快照。对于 JS-heavy 站点或需要认证的页面，请使用 [Web Browser](/tools/browser)。

## 快速开始

<Steps>
  <Step title="启用 web_search">
    `searxng` 是唯一捆绑的托管 `web_search` 提供商。在大多数安装中，你不需要 API 密钥或单独托管的服务。
  </Step>
  <Step title="可选配置">
    使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。
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

- `web_search` 不需要 API 密钥
- CrawClaw 可以自动启动并重用本地 loopback sidecar
- 模型可见 schema 支持 `query`、`count`、`engines`、`categories`、`language`、`safeSearch`、`timeRange` 和 `timeoutSeconds`
- 旧的 API 支持的搜索提供商不再是托管工具的一部分

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

SearXNG 特定配置位于 `plugins.entries.searxng.config.webSearch.*`。`baseUrl` 是对明确托管的 SearXNG 端点的高级覆盖；纯 `http://` 端点必须是 loopback，而远程端点必须使用 `https://`。

## 工具参数

| 工具         | 参数             | 描述                             |
| ------------ | ---------------- | -------------------------------- |
| `web_search` | `query`          | 搜索查询（必需）                 |
| `web_search` | `count`          | 返回结果数量（1-10，默认 5）     |
| `web_search` | `engines`        | 可选的 SearXNG 引擎 ID           |
| `web_search` | `categories`     | 可选的 SearXNG 类别              |
| `web_search` | `language`       | 可选的结果语言                   |
| `web_search` | `safeSearch`     | `off`、`moderate` 或 `strict`    |
| `web_search` | `timeRange`      | `day`、`week`、`month` 或 `year` |
| `web_search` | `timeoutSeconds` | 请求超时                         |
| `web_fetch`  | `url`            | 要获取的 HTTP 或 HTTPS URL       |

## 工具配置文件

如果你使用工具配置文件或允许列表，请添加 `web_search`、`web_fetch` 或 `group:web`：

```json5
{
  tools: {
    allow: ["web_search", "web_fetch"],
  },
}
```

## 相关内容

- [Web Fetch](/tools/web-fetch) -- 获取 URL 并提取可读内容
- [Web Browser](/tools/browser) -- 适用于 JS-heavy 站点的完整浏览器自动化
