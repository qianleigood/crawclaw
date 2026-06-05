---
read_when:
  - 你需要一份面向初学者的日志简介
  - 你想配置日志级别或格式
  - 你正在故障排除，需要快速找到日志
summary: 日志概述：文件日志、控制台输出和 Gateway 日志追踪
title: 日志概述
x-i18n:
  generated_at: "2026-06-05T14:40:50Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 57798e779b0c24c6899e74a21ae86c2574d2ca7fbe851f139c2b9bcd636c93cd
  source_path: logging.md
  workflow: 15
---

# 日志

CrawClaw 在两个位置记录日志：

- **文件日志**（JSON 行），由 Gateway 写入。
- **控制台输出**，显示在终端中。

本页面说明日志的存放位置、如何阅读日志，以及如何配置日志级别和格式。

## 日志存放位置

默认情况下，Gateway 在以下位置写入滚动日志文件：

`/tmp/crawclaw/crawclaw-YYYY-MM-DD.log`

日期使用 gateway 主机的本地时区。

你可以在 `~/.crawclaw/crawclaw.json` 中覆盖此设置：

```json
{
  "logging": {
    "file": "/path/to/crawclaw.log"
  }
}
```

## 如何阅读日志

### Desktop 和 Gateway API 实时追踪

使用 CrawClaw Desktop 诊断工具或本地 Gateway API 通过 RPC 追踪 gateway 日志文件。

输出模式：

- **TTY 会话**：美化的、带颜色的、结构化日志行。
- **非 TTY 会话**：纯文本。
- `--json`：行分隔的 JSON（每行一个日志事件）。
- `--plain`：在 TTY 会话中强制使用纯文本。
- `--no-color`：禁用 ANSI 颜色。

在 JSON 模式下，Gateway 日志流发送 `type` 标记的对象：

- `meta`：流元数据（文件、光标、大小）
- `log`：解析后的日志条目
- `notice`：截断/轮换提示
- `raw`：未解析的日志行

如果 Gateway 无法访问，CLI 会打印简短提示：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 实现自动化。

### 仅渠道日志

要过滤渠道活动（Weixin/Feishu 等），请使用：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 实现自动化。

## 日志格式

### 文件日志（JSONL）

日志文件中的每一行都是一个 JSON 对象。CLI 解析这些条目以呈现结构化输出（时间、级别、子系统、消息）。

### 控制台输出

控制台日志是 **TTY 感知的**，并为可读性而格式化：

- 子系统前缀（例如 `gateway/channels/index`）
- 级别着色（info/warn/error）
- 可选的紧凑或 JSON 模式

控制台格式化由 `logging.consoleStyle` 控制。

## 配置日志记录

所有日志配置位于 `~/.crawclaw/crawclaw.json` 的 `logging` 下。

```json
{
  "logging": {
    "level": "info",
    "file": "/tmp/crawclaw/crawclaw-YYYY-MM-DD.log",
    "consoleLevel": "info",
    "consoleStyle": "pretty",
    "redactSensitive": "tools",
    "redactPatterns": ["sk-.*"]
  }
}
```

### 日志级别

- `logging.level`：**文件日志**（JSONL）级别。
- `logging.consoleLevel`：**控制台**详细程度级别。

你可以通过 **`CRAWCLAW_LOG_LEVEL`** 环境变量覆盖两者（例如 `CRAWCLAW_LOG_LEVEL=debug`）。环境变量优先于配置文件，因此你可以在不编辑 `crawclaw.json` 的情况下为单个 Desktop 或 Gateway 进程提高详细程度。

`--verbose` 仅影响控制台输出；不会更改文件日志级别。

### 控制台样式

`logging.consoleStyle`：

- `pretty`：适合人类阅读的、带颜色的、带时间戳的。
- `compact`：更紧凑的输出（适合长时间会话）。
- `json`：每行一个 JSON（用于日志处理器）。

### 脱敏

工具摘要可以在进入控制台之前对敏感 token 进行脱敏：

- `logging.redactSensitive`：`off` | `tools`（默认：`tools`）
- `logging.redactPatterns`：用于覆盖默认集合的正则表达式字符串列表

脱敏仅影响**控制台输出**，不会更改文件日志。

## 诊断 + OpenTelemetry

诊断是为模型运行提供的结构化机器可读事件**以及**消息流遥测（webhook、排队、会话状态）。它们**不会**替代日志；它们存在是为了向指标、追踪和其他导出器提供数据。

诊断事件在进程内发送，但导出器仅在诊断和导出器插件都启用时才会附加。

### OpenTelemetry 与 OTLP

- **OpenTelemetry (OTel)**：用于追踪、指标和日志的数据模型 + SDK。
- **OTLP**：用于将 OTel 数据导出到收集器/后端的线协议。
- CrawClaw 目前通过 **OTLP/HTTP (protobuf)** 导出。

### 导出的信号

- **指标**：计数器和直方图（token 使用量、消息流、排队）。
- **追踪**：运行生命周期、模型使用、webhook/消息处理和渠道流式决策的跨度。
- **日志**：当 `diagnostics.otel.logs` 启用时通过 OTLP 导出。日志量可能很大；请注意 `logging.level` 和导出器过滤器。

### 观察上下文

CrawClaw 现在使用 `ObservationContext` 作为单一的追踪和关联契约。模块应传递观察上下文，而不是手动构建 `traceId`、`spanId` 或 `parentSpanId` 字段。

一个观察包含：

- `trace.traceId`：默认为 `run-loop:${runId ?? sessionKey ?? sessionId}`。
- `trace.spanId`：当前操作跨度。
- `trace.parentSpanId`：父跨度，或运行根的 `null`。
- `trace.traceparent` 和 `trace.tracestate`：进程或渠道边界的可选 W3C 传播值。
- `runtime.runId`、`runtime.sessionId`、`runtime.sessionKey`、`runtime.agentId`、`runtime.taskId` 和工作流 id：运行时关联 id。
- `phase` 和 `decisionCode`：由运行循环主线拥有的生命周期语义。
- `refs`：小型业务引用，如 `requestId`、`messageId`、`toolCallId` 或 `correlationId`。

运行循环生命周期总线是运行时生命周期语义的所有者。诊断事件、缓存追踪 JSONL、Action Feed、Context Archive、任务轨迹、日志和 OTel 导出是投影或接收器。它们读取 `ObservationContext`；它们不会创建第二个生命周期模型。

子系统日志自动将当前观察作用域附加到控制台和文件元数据。`withContext` 仍然适用于业务字段，但追踪标识应来自观察上下文。

导出到 OTel 的指标故意避免高基数的观察 id，如 `traceId`、`spanId`、`runId`、`sessionId` 和 `sessionKey`。跨度和日志保留这些 id，以便调试会话可以连接时间线记录、日志、诊断事件、缓存追踪条目和 OTel 属性。

### 诊断事件目录

模型使用：

- `model.usage`：token、成本、持续时间、上下文、提供商/模型/渠道、会话 id。

消息流：

- `webhook.received`：每个渠道的 webhook 入口。
- `webhook.processed`：webhook 已处理 + 持续时间。
- `webhook.error`：webhook 处理程序错误。
- `message.queued`：消息加入处理队列。
- `message.processed`：结果 + 持续时间 + 可选错误。

队列 + 会话：

- `queue.lane.enqueue`：命令队列通道加入 + 深度。
- `queue.lane.dequeue`：命令队列通道离开 + 等待时间。
- `session.state`：会话状态转换 + 原因。
- `session.stuck`：会话卡住警告 + 年龄。
- `run.attempt`：运行重试/尝试元数据。
- `run.lifecycle`：运行循环生命周期阶段、观察上下文、决策、指标和引用。
- `diagnostic.heartbeat`：聚合计数器（webhook/队列/会话）。
- `channel.streaming.decision`：每个渠道的流式启用/禁用决策，包含 `surface` 和 `reason` 元数据。

### 启用诊断（无导出器）

如果你希望诊断事件可用于插件或自定义接收器，请使用此选项：

```json
{
  "diagnostics": {
    "enabled": true
  }
}
```

### 诊断标志（定向日志）

使用标志开启额外的、定向的调试日志，而无需提高 `logging.level`。标志不区分大小写，支持通配符（例如 `feishu.*` 或 `*`）。

```json
{
  "diagnostics": {
    "flags": ["feishu.http"]
  }
}
```

环境变量覆盖（一次性）：

```
CRAWCLAW_DIAGNOSTICS=feishu.http,feishu.payload
```

注意事项：

- 标志日志写入标准日志文件（与 `logging.file` 相同）。
- 输出仍根据 `logging.redactSensitive` 进行脱敏。
- 完整指南：[/diagnostics/flags](/diagnostics/flags)。

### 导出到 OpenTelemetry

诊断可以通过 Rust 诊断管道通过 OTLP/HTTP 导出。这适用于任何接受 OTLP/HTTP 的 OpenTelemetry 收集器/后端。

```json
{
  "diagnostics": {
    "enabled": true,
    "otel": {
      "enabled": true,
      "endpoint": "http://otel-collector:4318",
      "protocol": "http/protobuf",
      "serviceName": "crawclaw-gateway",
      "traces": true,
      "metrics": true,
      "logs": true,
      "sampleRate": 0.2,
      "flushIntervalMs": 60000
    }
  }
}
```

注意事项：

- 你也可以使用 CrawClaw Desktop 或本地 Gateway API 启用诊断。
- `protocol` 目前仅支持 `http/protobuf`。`grpc` 会被忽略。
- 指标包括 token 使用量、成本、上下文大小、运行持续时间以及消息流计数器/直方图（webhook、排队、会话状态、队列深度/等待）。
- 可以使用 `traces`/`metrics` 切换追踪/指标（默认：开启）。追踪在启用时包括 `crawclaw.run.lifecycle.<phase>` 跨度、模型使用跨度以及 webhook/消息处理跨度。
- 带有 `trace` 封套的事件在存在这些字段时导出共享属性 `crawclaw.traceId`、`crawclaw.spanId`、`crawclaw.parentSpanId`、`crawclaw.runId`、`crawclaw.sessionId`、`crawclaw.sessionKey`、`crawclaw.agentId`、`crawclaw.lifecycle.phase` 和 `crawclaw.decisionCode`。
- 渠道流式决策作为指标 `crawclaw.channel.streaming.decision` 导出，属性包括 `crawclaw.channel`、`crawclaw.streaming.surface`、`crawclaw.streaming.reason` 和 `crawclaw.streaming.enabled`。
- 当追踪启用时，CrawClaw 还会导出 `crawclaw.channel.streaming.decision` 跨度，以便将渠道传递行为与消息流追踪的其余部分关联起来。
- 当收集器需要认证时设置 `headers`。
- 支持的环境变量：`OTEL_EXPORTER_OTLP_ENDPOINT`、`OTEL_SERVICE_NAME`、`OTEL_EXPORTER_OTLP_PROTOCOL`。

### 导出的指标（名称 + 类型）

模型使用：

- `crawclaw.tokens`（计数器，属性：`crawclaw.token`、`crawclaw.channel`、`crawclaw.provider`、`crawclaw.model`）
- `crawclaw.cost.usd`（计数器，属性：`crawclaw.channel`、`crawclaw.provider`、`crawclaw.model`）
- `crawclaw.run.duration_ms`（直方图，属性：`crawclaw.channel`、`crawclaw.provider`、`crawclaw.model`）
- `crawclaw.context.tokens`（直方图，属性：`crawclaw.context`、`crawclaw.channel`、`crawclaw.provider`、`crawclaw.model`）

消息流：

- `crawclaw.webhook.received`（计数器，属性：`crawclaw.channel`、`crawclaw.webhook`）
- `crawclaw.webhook.error`（计数器，属性：`crawclaw.channel`、`crawclaw.webhook`）
- `crawclaw.webhook.duration_ms`（直方图，属性：`crawclaw.channel`、`crawclaw.webhook`）
- `crawclaw.message.queued`（计数器，属性：`crawclaw.channel`、`crawclaw.source`）
- `crawclaw.message.processed`（计数器，属性：`crawclaw.channel`、`crawclaw.outcome`）
- `crawclaw.message.duration_ms`（直方图，属性：`crawclaw.channel`、`crawclaw.outcome`）

队列 + 会话：

- `crawclaw.queue.lane.enqueue`（计数器，属性：`crawclaw.lane`）
- `crawclaw.queue.lane.dequeue`（计数器，属性：`crawclaw.lane`）
- `crawclaw.queue.depth`（直方图，属性：`crawclaw.lane` 或 `crawclaw.channel=heartbeat`）
- `crawclaw.queue.wait_ms`（直方图，属性：`crawclaw.lane`）
- `crawclaw.session.state`（计数器，属性：`crawclaw.state`、`crawclaw.reason`）
- `crawclaw.session.stuck`（计数器，属性：`crawclaw.state`）
- `crawclaw.session.stuck_age_ms`（直方图，属性：`crawclaw.state`）
- `crawclaw.run.attempt`（计数器，属性：`crawclaw.attempt`）
- `crawclaw.channel.streaming.decision`（计数器，属性：`crawclaw.channel`、`crawclaw.streaming.surface`、`crawclaw.streaming.reason`、`crawclaw.streaming.enabled`）

当诊断事件携带 `ObservationContext` 时，追踪跨度，日志会获得共享的 `crawclaw.traceId`/`crawclaw.spanId` 关联属性。指标属性故意省略这些高基数 id。

### 导出的跨度（名称 + 关键属性）

- `crawclaw.run.lifecycle.<phase>`
  - `crawclaw.lifecycle.phase`、`crawclaw.decisionCode`
  - 存在时的共享追踪属性
  - 用于小型生命周期指标和引用的 `crawclaw.metrics.*` 和 `crawclaw.refs.*`
- `crawclaw.model.usage`
  - `crawclaw.channel`、`crawclaw.provider`、`crawclaw.model`
  - `crawclaw.sessionKey`、`crawclaw.sessionId`
  - `crawclaw.tokens.*`（input/output/cache_read/cache_write/total）
- `crawclaw.webhook.processed`
  - `crawclaw.channel`、`crawclaw.webhook`、`crawclaw.chatId`
- `crawclaw.webhook.error`
  - `crawclaw.channel`、`crawclaw.webhook`、`crawclaw.chatId`、`crawclaw.error`
- `crawclaw.message.processed`
  - `crawclaw.channel`、`crawclaw.outcome`、`crawclaw.chatId`、`crawclaw.messageId`、`crawclaw.sessionKey`、`crawclaw.sessionId`、`crawclaw.reason`
- `crawclaw.session.stuck`
  - `crawclaw.state`、`crawclaw.ageMs`、`crawclaw.queueDepth`、`crawclaw.sessionKey`、`crawclaw.sessionId`
- `crawclaw.channel.streaming.decision`
  - `crawclaw.channel`、`crawclaw.streaming.surface`、`crawclaw.streaming.reason`、`crawclaw.streaming.enabled`
  - 可选：`crawclaw.accountId`、`crawclaw.sessionKey`、`crawclaw.sessionId`、`crawclaw.chatId`

### 采样 + 刷新

- 追踪采样：`diagnostics.otel.sampleRate`（0.0–1.0，仅限根跨度）。
- 指标导出间隔：`diagnostics.otel.flushIntervalMs`（最少 1000ms）。

### 协议说明

- OTLP/HTTP 端点可以通过 `diagnostics.otel.endpoint` 或 `OTEL_EXPORTER_OTLP_ENDPOINT` 设置。
- 如果端点已包含 `/v1/traces` 或 `/v1/metrics`，则按原样使用。
- 如果端点已包含 `/v1/logs`，则按原样用于日志。
- `diagnostics.otel.logs` 为主日志输出启用 OTLP 日志导出。

### 日志导出行为

- OTLP 日志使用写入 `logging.file` 的相同结构化记录。
- 遵守 `logging.level`（文件日志级别）。控制台脱敏**不适用于** OTLP 日志。
- 大容量安装应优先使用 OTLP 收集器采样/过滤。

## 故障排除提示

- **Gateway 无法访问？** 首先运行 CrawClaw Desktop 或本地 Gateway API。
- **日志为空？** 检查 Gateway 是否正在运行并写入 `logging.file` 中的文件路径。
- **需要更多细节？** 将 `logging.level` 设置为 `debug` 或 `trace` 并重试。

## 相关

- [Gateway 日志内部机制](/gateway/logging) — WS 日志样式、子系统前缀和控制台捕获
- [诊断](/gateway/configuration-reference#diagnostics) — OpenTelemetry 导出和缓存追踪配置
