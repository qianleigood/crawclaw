---
read_when:
  - 更改日志输出或格式
  - 调试 Desktop、Gateway 或自动化输出
summary: 日志界面、文件日志、WS 日志样式和控制台格式化
title: Gateway 日志
x-i18n:
  generated_at: "2026-06-05T14:17:33Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 4c4219933f769da1eb3ff91e74de28e55a0ab81c66b60f63b22579a708679896
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
- 每次运行的详细程度仅影响**控制台详细程度**（和 WS 日志样式）；它**不会**提高文件日志级别。
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

Gateway 以两种模式打印 WebSocket 协议日志：

- **正常模式（无 `--verbose`）**：仅打印"有趣"的 RPC 结果：
  - 错误（`ok=false`）
  - 慢调用（默认阈值：`>= 50ms`）
  - 解析错误
- **详细模式（`--verbose`）**：打印所有 WS 请求/响应流量。

### WS 日志样式

CrawClaw Desktop 或本地 Gateway API 支持按 Gateway 的样式切换：

- `--ws-log auto`（默认）：正常模式已优化；详细模式使用紧凑输出
- `--ws-log compact`：详细时使用紧凑输出（配对请求/响应）
- `--ws-log full`：详细时使用逐帧完整输出
- `--compact`：`--ws-log compact` 的别名

示例：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

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
- **控制台样式**（例如 `pretty | compact | json`）
- **控制台日志级别**与文件日志级别分开（当 `logging.level` 设置为 `debug`/`trace` 时，文件保持完整详情）
- **Weixin 消息正文**在 `debug` 级别记录（使用 `--verbose` 查看）

这在保持现有文件日志稳定的同时，使交互式输出可扫描。
