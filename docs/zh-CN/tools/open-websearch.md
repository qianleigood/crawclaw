---
read_when:
  - 你想在不使用 API key 的情况下启用 web_search
  - 你想让 CrawClaw 对接本地 open-websearch daemon
  - 你需要本地可控的多引擎搜索回退
summary: Open-WebSearch 提供商：把 web_search 转发到 CrawClaw 托管的本地 open-websearch daemon
title: Open-WebSearch
---

# Open-WebSearch

CrawClaw 可以把内置的 [`open-websearch`](https://github.com/Aas-ee/open-webSearch)
本地 daemon 作为 `web_search` 提供商使用。这样保留的是 CrawClaw 自己的
`web_search` 工具，但实际搜索由 CrawClaw 托管的本地 daemon 完成。

## 适合什么场景

- 不想为搜索单独配置 API key
- 想走本地可控的多引擎搜索
- 希望 CrawClaw 随 gateway 启动并持续复用搜索 daemon
- 想把 CrawClaw 的 `web_search` 接到 `open-websearch`

## 配置方式

正常安装下，你不需要再单独安装或手工启动这个服务。插件启用且 `autoStart`
保持默认开启时，CrawClaw 会在 gateway 启动阶段自动 bootstrap 并拉起 daemon，后续 `web_search` 直接复用。

如果你想明确把它设成默认 `web_search` provider，可以这样配：

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

如果你已经有自己管理的 daemon，也可以显式覆盖地址：

```bash
export OPEN_WEBSEARCH_BASE_URL="http://127.0.0.1:3210"
```

## 工具参数

- `query`：搜索词，必填
- `count`：返回条数，1 到 10

CrawClaw 会自动使用内置的全量支持引擎集合。

## 注意

- `baseUrl` 指向的是 daemon 根地址，不是 MCP endpoint
- 使用 `http://` 时，只允许可信的内网或 loopback 地址
- 这个 bundled plugin 默认启用
- 当没有可用的 API 搜索提供商时，CrawClaw 可以把它当作默认的 keyless provider

## 相关文档

- [Web 工具总览](/tools/web)
- [DuckDuckGo Search](/tools/duckduckgo-search)
- [SearXNG Search](/tools/searxng-search)
