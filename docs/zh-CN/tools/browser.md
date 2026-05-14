---
read_when:
  - 添加智能体控制的浏览器自动化
  - 调试 crawclaw 干扰你自己 Chrome 的问题
  - 在本机客户端中实现浏览器设置和生命周期管理
summary: 基于 Rust native agent-browser 运行时的集成浏览器工具
title: 浏览器（CrawClaw 托管）
x-i18n:
  generated_at: "2026-05-14T00:00:00Z"
  source_path: tools/browser.md
---

# 浏览器（crawclaw 托管）

CrawClaw 通过 Rust native `browser` 工具控制浏览器，底层调用托管的
`agent-browser` CLI。默认 `crawclaw` 配置文件与个人浏览器隔离。

## 快速开始

通过智能体 `browser` 工具或 Gateway Tools Invoke API 调用：

```json
{ "action": "status", "profile": "crawclaw" }
```

```json
{ "action": "open", "profile": "crawclaw", "url": "https://example.com" }
```

```json
{ "action": "snapshot", "profile": "crawclaw", "interactive": true }
```

## native 运行机制

- Rust native plugin registry 声明 `browser` 工具和
  `browser-agent-browser-runtime` service。
- Rust handler 按需启动托管的 `agent-browser` CLI，并使用 JSON 输出协议。
- `snapshot` 输出继续按外部不可信内容包裹。
- `screenshot` 输出继续返回图片内容，而不是只返回路径。

## 配置

```json5
{
  browser: {
    enabled: true,
    provider: "agent-browser",
    defaultProfile: "crawclaw",
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    noSandbox: false,
    extraArgs: [],
  },
}
```

如果提示 `agent-browser` 运行时缺失，请运行：

```bash
crawclaw runtimes install
```

## 支持动作

- `status` / `start` / `stop` / `profiles`
- `open` / `navigate` / `tabs` / `focus` / `close`
- `snapshot` / `screenshot` / `pdf`
- `cookies` / `storage` / `network` / `console`
- `download` / `upload`
- `act` / `batch`

## 安全

- 浏览器页面内容是外部不可信内容。
- 快照会带外部内容边界，避免页面文本被当成系统指令。
- `browser act` 的 evaluate 类动作会在页面上下文执行 JavaScript；不需要时请关闭相关配置。
