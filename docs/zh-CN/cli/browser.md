---
read_when:
  - 你看到了旧的 `crawclaw browser` 链接
  - 你需要当前浏览器自动化入口
summary: 旧 browser CLI 页面；当前浏览器自动化使用智能体 browser 工具
title: browser
x-i18n:
  generated_at: "2026-05-14T00:00:00Z"
  source_path: cli/browser.md
---

# 浏览器自动化

当前 CrawClaw 不再注册独立的 `crawclaw browser` CLI 命令。浏览器自动化由
Rust native plugin registry 暴露为智能体 `browser` 工具。

当前入口：

- 在智能体会话中使用 `browser` 工具，或通过 `/tools` 查看可用工具。
- 直接自动化时，调用 Gateway [Tools Invoke API](/gateway/tools-invoke-http-api)，
  设置 `tool: "browser"`。
- 配置 profile 和 `agent-browser` 行为请参考 [Browser tool](/tools/browser)。

## 快速示例

```json
{ "action": "status", "profile": "crawclaw" }
```

```json
{ "action": "open", "profile": "crawclaw", "url": "https://example.com" }
```

```json
{ "action": "snapshot", "profile": "crawclaw", "interactive": true }
```

```json
{ "action": "act", "profile": "crawclaw", "kind": "click", "ref": "e12" }
```

## 运行时安装

如果工具提示 `agent-browser` 缺失，请运行：

```bash
crawclaw runtimes install
```
