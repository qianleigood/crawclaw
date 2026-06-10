---
read_when:
  - 更改日志输出或格式
  - 调试 Desktop、Gateway 或自动化输出
summary: 日志界面、文件日志、WebSocket 协议日志和控制台格式化
title: Gateway 日志
x-i18n:
  generated_at: "2026-06-10T20:16:06Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: a911d64ce6049b4e29c39090a544936a3aa46de5178254ca9832f2a22e5ba6f5
  source_path: gateway/logging.md
  workflow: 15
---

# 日志

关于面向用户的概述（Desktop + Gateway 客户端 + 配置），请参阅 [/logging](/logging)。

CrawClaw 有两个日志"界面"：

- **控制台输出**（你在终端 / 调试 UI 中看到的内容）。
- **文件日志**（JSON 行）由 gateway 日志写入器写入。

## 基于文件的日志记录器

- 默认滚动日志文件位于 `/tmp/crawclaw/`（每天一个文件）：`crawclaw-YYYY-MM-DD.log`
  - 日期使用 Gateway 网关主机的本地时区。
- 日志文件路径和级别可通过 `~/.crawclaw/crawclaw.json` 配置：
  - `logging.file`
  - `logging.level`

文件格式为每行一个 JSON 对象。

Gateway 客户端可通过 gateway（`logs.tail`）追踪此文件。
Desktop 诊断使用相同的 Gateway 日志流。

**详细 vs. 日志级别**

- **文件日志**由 `logging.level` 独家控制。
- 每次运行的详细程度仅影响**控制台详细程度**；它**不会**提高文件日志级别。
- 要在文件日志中捕获仅详细的信息，请将 `logging.level` 设置为 `debug` 或 `trace`。

## 控制台捕获

Gateway 运行时捕获 `console.log/info/warn/error/debug/trace` 并将它们写入文件日志，同时仍打印到其进程 stdout/stderr。

你可以通过以下方式独立调整控制台详细程度：

- `logging.consoleLevel`（默认 `info`）
- `logging.consoleStyle`（`pretty` | `compact` | `json`）

## 工具摘要脱敏

详细的工具摘要（例如 `🛠️ Exec: ...`）可以在进入控制台流之前掩盖敏感令牌。这是**仅限工具**的，不会更改文件日志。

- `logging.redactSensitive`：`off` | `tools`（默认：`tools`）
- `logging.redactPatterns`：正则表达式字符串数组（覆盖默认值）
  - 使用原始正则表达式字符串（自动 `gi`），如果需要自定义标志则使用 `/pattern/flags`。
  - 匹配通过保留前 6 + 后 4 个字符进行掩盖（长度 >= 18），否则为 `***`。
  - 默认值涵盖常见密钥分配、CLI 标志、JSON 字段、 bearer 头部、PEM 块和流行令牌前缀。

## Gateway WebSocket 日志

Gateway 通过同一套控制台/文件日志管线打印 WebSocket 协议日志：

- 普通控制台级别：仅打印有意义的 RPC 结果：
  - 错误（`ok=false`）
  - 慢调用（默认阈值：`>= 50ms`）
  - 解析错误
- `debug` 或 `trace` 控制台级别：打印更多协议细节。

Rust Gateway 二进制目前提供 `--bind`、`--port` 和 `--runtime-root` 启动标志。请通过配置调整日志：

```json5
{
  logging: {
    level: "debug",
    consoleLevel: "debug",
    consoleStyle: "compact",
  },
}
```

使用 `logs.tail` 或 Desktop 诊断查看文件日志流。

## 控制台格式化（子系统日志）

控制台格式化器是**TTY 感知的**，并打印一致的带前缀行。
子系统日志记录器保持输出分组和可扫描。

行为：

- **子系统前缀**在每行上（例如 `[gateway]`、`[canvas]`、`[tailscale]`）
- **子系统颜色**（每个子系统稳定）+ 级别颜色
- **当输出是 TTY 或环境看起来像富终端时着色**（`TERM`/`COLORTERM`/`TERM_PROGRAM`），尊重 `NO_COLOR`
- **缩短子系统前缀**：删除前导 `gateway/` + `channels/`，保留最后 2 个段（例如 `weixin/outbound`）
- **按子系统的子日志记录器**（自动前缀 + 结构化字段 `{ subsystem }`）
- **`logRaw()`** 用于 QR/UX 输出（无前缀，无格式化）
- **控制台样式**（`pretty | compact | json`）
- **控制台日志级别**与文件日志级别分开（当 `logging.level` 设置为 `debug`/`trace` 时，文件保持完整详情）
- **Weixin 消息正文**在 `debug` 级别记录（提高 `logging.consoleLevel` 或查看文件日志即可看到）

这在保持现有文件日志稳定的同时，使交互式输出可扫描。
