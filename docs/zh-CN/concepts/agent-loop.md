---
read_when:
  - 你需要智能体循环或生命周期事件的详细说明
summary: 智能体循环生命周期、流和等待语义
title: 智能体循环
x-i18n:
  generated_at: "2026-02-03T10:05:11Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 0775b96eb3451e137297661a1095eaefb2bafeebb5f78123174a46290e18b014
  source_path: concepts/agent-loop.md
  workflow: 15
---

# 智能体循环（CrawClaw）

智能体循环是智能体的完整"真实"运行：接收 → 上下文组装 → 模型推理 → 工具执行 → 流式回复 → 持久化。这是将消息转化为操作和最终回复的权威路径，同时保持会话状态的一致性。

在 CrawClaw 中，循环是每个会话的单次序列化运行，在模型思考、调用工具和流式输出时发出生命周期和流事件。本文档解释了这个真实循环是如何端到端连接的。

## 入口点

- Gateway 网关 RPC：`agent` 和 `agent.wait`。
- CLI：`agent` 命令。

## 工作原理（高层次）

1. `agent` RPC 验证参数，解析会话（sessionKey/sessionId），持久化会话元数据，立即返回 `{ runId, acceptedAt }`。
2. `agentCommand` 运行智能体：
   - 解析模型 + 思考/详细模式默认值
   - 为本次运行注册 run context 和 runtime state
   - 加载 Skills 快照
   - 调用 `runEmbeddedPiAgent`（pi-agent-core 运行时）
   - 如果嵌入式循环未发出**生命周期结束/错误**事件，则发出该事件
3. `runEmbeddedPiAgent`：
   - 通过每会话 + 全局队列序列化运行
   - 解析模型 + 认证配置文件并构建 pi 会话
   - 订阅 pi 事件并流式传输助手/工具增量
   - 强制执行超时 -> 超时则中止运行
   - 返回有效负载 + 使用元数据
4. `subscribeEmbeddedPiSession` 将 pi-agent-core 事件桥接到 CrawClaw `agent` 流：
   - 工具事件 => `stream: "tool"`
   - 助手增量 => `stream: "assistant"`
   - 生命周期事件 => `stream: "lifecycle"`（`phase: "start" | "end" | "error"`）
   - 运行时进度 => task-backed agent progress 更新
5. `agent.wait` 使用 `waitForAgentJob`：
   - 等待 `runId` 的**生命周期结束/错误**
   - 返回 `{ status: ok|error|timeout, startedAt, endedAt, error? }`

## 运行时状态 + 任务跟踪

每次运行现在都有统一的运行时身份：

- `run context`：把 `runId` 绑定到 `sessionKey`、`sessionId`、`agentId`、
  可选 `parentAgentId` 和任务元数据
- `runtime state`：记录状态、当前步骤、工具调用数、最近心跳和终态结果
- `task record`：持久化后台/脱离式运行，使子智能体和 ACP 运行可以被
  恢复、审计和检查

这套基座同时服务于原生 subagent、ACP、guard、completion 和 loop
policy。

## 子智能体与 ACP 的边界

不同子运行共享的状态并不相同：

- **原生子智能体**会启动一个新的 CrawClaw session 和 task。它们拿到的是
  子任务 prompt 和 lineage 元数据，而不是父会话的完整 transcript。
- **Session memory** 由于按 `sessionId` 分桶，因此天然隔离。
- **Durable memory** 只要父子运行最终命中同一个
  `agentId + channel + userId` scope，就会共享。
- **Knowledge recall** 会在 prompt assembly 时从同一个 NotebookLM backend
  查询，不按 session id 隔离。
- **Workspace** 默认只在同一 agent 内继承；跨 agent spawn 会切到目标
  agent 自己的 workspace。
- **ACP 运行** 对 CrawClaw 来说同样是 task-backed、可 inspection 的，但
  harness 自身的内部上下文和记忆仍然由 ACP backend 管理。

## Inspection 快照

CrawClaw 现在还提供了一层面向 task-backed run 的 inspection seam。一次
inspection 快照会把这些状态聚合到一起：

- runtime state（`runId`、状态、当前步骤、tool 调用数）
- task record 和关联 refs
- 持久化的 runtime metadata
- capability snapshot / guard context
- trajectory 和 completion 结果
- diagnostic cache 里的最近 loop summary

它的用途是排障、replay 分析和后续的运维工具，而不是替代 live event stream。
换句话说，它提供的是一份稳定的只读视图，把 loop、guard、completion
已经落盘的状态统一收口出来。

当前基于这套 inspection seam 的运维入口有：

- `crawclaw agent inspect`
- `crawclaw agents status`
- `crawclaw agents harness report`
- `crawclaw agents harness promote-check`
- gateway RPC `agent.inspect`

现在 `agent inspect` 还会从归档的 `run.lifecycle.*` 事件里重建一条紧凑的
lifecycle timeline，把 provider / tool / subagent / compaction 的决策收口到
同一个 inspection surface 上，不再需要手动拼多份 debug log。

## 队列 + 并发

- 运行按会话键（会话通道）序列化，可选择通过全局通道。
- 这可以防止工具/会话竞争并保持会话历史的一致性。
- 消息渠道可以选择队列模式（collect/steer/followup）来馈送此通道系统。参见[命令队列](/concepts/queue)。

## 会话 + 工作区准备

- 解析并创建工作区；沙箱隔离运行可能会重定向到沙箱工作区根目录。
- 加载 Skills（或从快照中复用）并注入到环境和提示中。
- 解析引导/上下文文件并注入到系统提示报告中。
- 获取会话写锁；在流式传输之前打开并准备 `SessionManager`。

## 提示组装 + 系统提示

- 系统提示由 CrawClaw 的基础提示、Skills 提示、引导上下文和每次运行的覆盖构建。
- 强制执行模型特定的限制和压缩保留令牌。
- 参见[系统提示](/concepts/system-prompt)了解模型看到的内容。

## 钩子点（可以拦截的位置）

CrawClaw 有两个钩子系统：

- **内部钩子**（Gateway 网关钩子）：用于命令和生命周期事件的事件驱动脚本。
- **插件钩子**：智能体/工具生命周期和 Gateway 网关管道中的扩展点。

### 内部钩子（Gateway 网关钩子）

- **`agent:bootstrap`**：在系统提示最终确定之前构建引导文件时运行。用于添加/删除引导上下文文件。
- **命令钩子**：`/new`、`/stop` 和其他命令事件（参见钩子文档）。

参见[钩子](/automation/hooks)了解设置和示例。

### 插件钩子（智能体 + Gateway 网关生命周期）

这些在智能体循环或 Gateway 网关管道内运行：

- **`before_model_resolve`**：在建会话前运行（此时还没有 `messages`），可确定性覆盖 provider/model。
- **`before_prompt_build`**：在 session 加载后运行（此时已有 `messages`），返回结构化 `queryContextPatch` 来塑造提示词输入。动态逐轮内容放进 `prependUserContextSections`，完整系统提示覆盖走 `replaceSystemPromptSections`，稳定系统上下文走 `prependSystemContextSections` / `appendSystemContextSections`。
- **`before_model_resolve` / `before_prompt_build`**：当前唯一有效的预运行 hook 阶段。model/provider 选择和提示词上下文修改都通过这两个 hook 完成。
- **`before_agent_reply`**：在 inline action 之后、真正发起 LLM 调用之前运行，可直接接管当前回合并返回 synthetic reply，或者把本轮静默掉。
- **`agent_end`**：在完成后检查最终消息列表和运行元数据。
- **`before_compaction` / `after_compaction`**：观察或注释压缩周期。
- **`before_tool_call` / `after_tool_call`**：拦截工具参数/结果。
- **`before_install`**：检查内置安装扫描结果，并可阻止 skill / plugin 安装。
- **`tool_result_persist`**：在工具结果写入会话记录之前同步转换它们。
- **`message_received` / `message_sending` / `message_sent`**：入站 + 出站消息钩子。
- **`session_start` / `session_end`**：会话生命周期边界。
- **`gateway_start` / `gateway_stop`**：Gateway 网关生命周期事件。

出站/tool guard 类 hook 的决策规则：

- `before_tool_call`: `{ block: true }` 是终态，低优先级处理器不会再继续。
- `before_tool_call`: `{ block: false }` 只是 no-op，不会清掉前面已经产生的 block。
- `before_install`: `{ block: true }` 是终态。
- `before_install`: `{ block: false }` 只是 no-op。
- `message_sending`: `{ cancel: true }` 是终态。
- `message_sending`: `{ cancel: false }` 只是 no-op。

参见[插件架构](/plugins/architecture#provider-runtime-hooks)了解 hook API 和注册详情。

## 流式传输 + 部分回复

- 助手增量从 pi-agent-core 流式传输并作为 `assistant` 事件发出。
- 分块流式传输可以在 `text_end` 或 `message_end` 时发出部分回复。
- 推理流式传输可以作为单独的流或作为块回复发出。
- 参见[流式传输](/concepts/streaming)了解分块和块回复行为。

## 工具执行 + 消息工具

- 工具开始/更新/结束事件在 `tool` 流上发出。
- 工具结果在记录/发出之前会对大小和图像有效负载进行清理。
- 消息工具发送会被跟踪以抑制重复的助手确认。

## Completion + trajectory

task-backed 运行现在会维护一份 trajectory 文件，记录：

- tool step
- assistant 输出快照
- 完成证据，例如 `answer_provided`、`file_changed`、`test_passed`、
  `assertion_met`、`user_confirmed`

当 task-backed run 进入终态时，CrawClaw 会评估 completion guard，并把
结果写回 trajectory。它不会取代 live agent loop，只是为检查和 replay
补上一份结构化完成记录。

loop progress 也走同一条路：每次 tool 调用都会生成标准化的 progress
envelope，live runtime、replay harness 和 policy layer 都消费同一份 envelope
历史。diagnostic session cache 现在只镜像最近窗口用于排查，不再是 loop
状态的事实来源。

harness 现在还能基于这些 scenario 生成 summary report，并对 baseline /
candidate 两版策略做 diff，这样在真正收紧 loop policy 之前就能先做离线比较。
在这之上，promotion gate 还能直接把 candidate 判成 `promote`、`shadow`
或 `reject`，让 policy / skill 实验先走离线准入，再决定是否影响 live run。

## 回复整形 + 抑制

- 最终有效负载由以下内容组装：
  - 助手文本（和可选的推理）
  - 内联工具摘要（当详细模式 + 允许时）
  - 模型出错时的助手错误文本
- `NO_REPLY` 被视为静默令牌，从出站有效负载中过滤。
- 消息工具重复项从最终有效负载列表中移除。
- 如果没有剩余可渲染的有效负载且工具出错，则发出回退工具错误回复（除非消息工具已经发送了用户可见的回复）。

## 压缩 + 重试

- 自动压缩发出 `compaction` 流事件，可以触发重试。
- 重试时，内存缓冲区和工具摘要会重置以避免重复输出。
- 参见[压缩](/concepts/compaction)了解压缩管道。

## 事件流（当前）

- `lifecycle`：由 `subscribeEmbeddedPiSession` 发出（以及作为 `agentCommand` 的回退）
- `assistant`：从 pi-agent-core 流式传输的增量
- `tool`：从 pi-agent-core 流式传输的工具事件

运行时 progress event 也会被写入任务状态和 task trajectory，但目前还没
作为单独的公开流暴露出去。

## 聊天渠道处理

- 助手增量被缓冲到聊天 `delta` 消息中。
- 在**生命周期结束/错误**时发出聊天 `final`。

## 超时

- `agent.wait` 默认：30 秒（仅等待）。`timeoutMs` 参数可覆盖。
- 智能体运行时：`agents.defaults.timeoutSeconds` 默认 172800 秒（48 小时）；在 `runEmbeddedPiAgent` 中止计时器中强制执行。使用 `0` 可完全禁用超时。

## 可能提前结束的情况

- 智能体超时（中止）
- AbortSignal（取消）
- Gateway 网关断开连接或 RPC 超时
- `agent.wait` 超时（仅等待，不会停止智能体）

## Loop policy

工具循环检测仍然发生在 `before_tool_call` 之前，但动作层现在已经从单一
“block” 收口成显式策略：

- `warn`
- `nudge`
- `soft_block_exact_repeat`
- `require_plan_refresh`

也就是说，critical 命中不再全部变成同一种阻断；不同 detector 会映射
到不同的运行时动作。
