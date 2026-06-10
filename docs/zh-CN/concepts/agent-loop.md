---
read_when:
  - 你需要智能体循环或生命周期事件的完整演练
summary: 智能体循环生命周期、流和等待语义
title: 智能体循环
x-i18n:
  generated_at: "2026-06-05T14:03:41Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 4d740d85e5acb49d3390827057b1dce31929b8323cf9f8b50732f3863dc07321
  source_path: concepts/agent-loop.md
  workflow: 15
---

# 智能体循环（CrawClaw）

智能体循环是智能体的完整“实际”运行过程：接收 → 上下文组装 → 模型推理 → 工具执行 → 流式回复 → 持久化。它是将消息转化为行动和最终回复的权威路径，同时保持会话状态一致。

在 CrawClaw 中，循环是每个会话的单一序列化运行，它在模型思考、调用工具和流式输出时发出生命周期和流事件。本文档解释了这一真实循环如何从头到尾连接。

## 入口点

- Gateway RPC：`agent.runTurn`、`agent.command.run`、`autoReply.run`、`agent` 和 `agent.wait`。
- Desktop UI 操作调用相同的 Gateway RPC 路径。

## 工作原理（高级概述）

1. Gateway RPC 验证参数、解析会话（`sessionKey`/`sessionId`）、持久化会话元数据，并记录 `{ runId, acceptedAt }`。
2. Rust `AgentRuntime` 运行此轮对话：
   - 解析模型 + 思考/详细模式默认值
   - 为此次运行注册运行上下文 + 运行时状态
   - 组装上下文、工具、对话记录和记忆输入
   - 发出流、工具、用量和对话记录事件
   - 在轮次后记录记忆摄取钩子
3. Rust 运行时序列化：
   - 通过每个会话 + 全局队列序列化运行
   - 从 Rust 提供商注册表解析提供商传输和模型默认值
   - 通过 gateway 事件流式传输 assistant/tool 增量
   - 强制超时 → 超时则中止运行
   - 返回负载 + 用量元数据
4. Gateway 流投影将 Rust 运行时事件映射到 CrawClaw `agent` 流：
   - 工具事件 => `stream: "tool"`
   - assistant 增量 => `stream: "assistant"`
   - 生命周期事件 => `stream: "lifecycle"`（`phase: "start" | "end" | "error"`）
   - 运行时进度 => 任务支持的智能体进度更新
5. `agent.wait` 使用 `waitForAgentJob`：
   - 等待 `runId` 的**生命周期结束/错误**
   - 返回 `{ status: ok|error|timeout, startedAt, endedAt, error? }`

## 运行时状态 + 任务追踪

每个运行现在都有一个共享的运行时标识：

- `run context`：将 `runId` 绑定到 `sessionKey`、`sessionId`、`agentId`、可选的 `parentAgentId` 和可选的任务元数据
- `runtime state`：跟踪状态、当前步骤、工具计数、上次心跳和终端结果
- `task record`：持久化独立/后台运行，以便子智能体和 ACP 运行可以在直播流之外恢复、审计和检查

这是原生子智能体、ACP 会话、守卫决策、完成评估和循环策略的共同基础。

## 子智能体和 ACP 边界

子运行并非都共享相同状态：

- **原生子智能体**启动新的 CrawClaw 会话和任务。它们接收特定于任务的子提示和谱系元数据，而非完整的父对话记录。
- **会话记忆**保持隔离，因为它按 `sessionId` 键控。
- **持久记忆**可以在父运行和子运行解析到相同 `agentId` 范围时共享。
- **经验回忆**在提示组装期间从相同的 Hindsight 后端查询；它不按会话 ID 分区。
- **工作区继承**默认是同智能体的。跨智能体生成切换到目标智能体的工作区，而非盲目继承调用者的工作区。
- **ACP 运行**是任务支持的，从 CrawClaw 的角度来看可检查，但工具链的内部上下文和记忆保持后端所有。

## 检查快照

CrawClaw 现在还为任务支持的运行暴露了运行时检查接口。单个检查快照可以聚合：

- 运行时状态（`runId`、状态、当前步骤、工具计数）
- 任务记录 + 任务引用
- 持久化的运行时元数据
- 能力快照 / 守卫上下文
- 轨迹 + 完成结果
- 来自诊断缓存的近期循环摘要

这用于调试、重放分析和未来的操作员工具。它不替换直播事件流；它为循环、守卫和完成系统已经持久化的状态提供了一致的读取模型。

今天基于此快照构建的操作界面：

- CrawClaw Desktop 运行时诊断界面
- gateway RPC `agent.inspect`

`agent.inspect` 现在还可以从归档的 `run.lifecycle.*` 事件重建紧凑的生命周期时间线，因此提供商/工具/子智能体/压缩决策可以从一个检查界面读取回来，而无需拼接多个调试日志。

## 队列 + 并发

- 运行按会话键（会话通道）序列化，可选地通过全局通道。
- 这防止了工具/会话竞争并保持会话历史一致。
- 消息渠道可以选择队列模式（collect/steer/followup）来供应该通道系统。
  参见[命令队列](/concepts/queue)。

## 会话 + 工作区准备

- Skills 被加载（或从快照重用）并注入到环境和提示中。
- 引导/上下文文件被解析并注入到系统提示报告中。
- 获取会话写锁；`SessionManager` 在流式传输前打开并准备就绪。

## 提示组装 + 系统提示

- 系统提示由 CrawClaw 的基础提示、skills 提示、引导上下文和每运行覆盖构建。
- 模型特定限制和压缩保留令牌被强制执行。
- 参见[系统提示](/concepts/system-prompt)了解模型看到的内容。

## 钩子点（你可以拦截的地方）

CrawClaw 当前的公共钩子表面是 Gateway SDK 生命周期钩子 API。
Claude Code 兼容的 SDK 客户端在 `initialize` 期间注册回调匹配器，
Gateway 在会话开始、提示提交、工具使用、权限检查、压缩、子智能体运行、通知和会话结束时调用它们。

这些钩子可以向支持的生命周期点添加上下文，并且可以阻止或调整工具和权限流。它们不是本地 TypeScript 钩子模块加载器，已移除的类型化插件 SDK 生命周期钩子不再是第三方插件注册表面。

参见[钩子](/automation/hooks)了解支持的事件和回调行为。

### 运行时生命周期

智能体循环仍有运行时拥有的生命周期阶段，用于模型选择、提示组装、工具执行、对话记录持久化、压缩和出站传递。内部 Rust 扩展点可以在产品运行时内部调整这些阶段，但它们不是公共插件或本地脚本 API。

## 流式传输 + 部分回复

- Assistant 增量从 Rust 智能体运行时流式传输并作为 `assistant` 事件发出。
- 分块流式传输可以在 `text_end` 或 `message_end` 上发出部分回复。
- 推理流可以作为单独流或块回复发出。
- 参见[流式传输](/concepts/streaming)了解分块和块回复行为。

## 工具执行 + 消息工具

- 工具开始/更新/结束事件在 `tool` 流上发出。
- 工具结果在记录/发出前被清理大小和图像负载。
- 消息工具发送被跟踪以抑制重复的 assistant 确认。

## 完成 + 轨迹

任务支持的运行现在维护一个轨迹文件，记录：

- 工具步骤
- assistant 输出快照
- 完成证据，如 `answer_provided`、`file_changed`、`test_passed`、`assertion_met` 和 `user_confirmed`

当任务支持的运行达到终止状态时，CrawClaw 评估完成守卫并将结果与轨迹一起存储。这不替换直播智能体循环；它为检查和重放添加了结构化完成记录。

循环进度以相同方式跟踪：每个工具调用贡献一个归一化进度信封，直播运行时、重放工具链和策略层都消费相同的信封历史。诊断会话缓存仅镜像检查的最近窗口；它不再是循环状态的真实来源。

工具链现在可以从捕获的场景构建摘要报告和基线/候选 diffs，因此循环和完成更改可以在发布前与相同的归一化运行时数据进行比较。轻量级推广门控可以根据这些 diffs 将候选分类为 `promote`、`shadow` 或 `reject`，为策略和 skills 实验提供离线验收路径，然后再影响直播运行。

## 回复整形 + 抑制

- 最终负载从以下内容组装：
  - assistant 文本（和可选推理）
  - 内联工具摘要（当详细模式 + 允许时）
  - 模型错误时的 assistant 错误文本
- `NO_REPLY` 被视为静默令牌并从出站负载中过滤。
- 消息工具重复项从最终负载列表中移除。
- 如果没有可渲染的负载剩余且工具出错，则发出回退工具错误回复（除非消息工具已发送用户可见回复）。

## 压缩 + 重试

- 自动压缩发出 `compaction` 流事件并可以触发重试。
- 重试时，内存缓冲区和工具摘要被重置以避免重复输出。
- 参见[压缩](/concepts/compaction)了解压缩管道。

## 事件流（当前）

- `lifecycle`：由 `subscribeRustAgentSession` 发出（作为回退由 `agent.command.run` 发出）
- `assistant`：从 Rust 智能体运行时流式传输的增量
- `tool`：从 Rust 智能体运行时流式传输的工具事件

在内部，运行时进度事件也馈送到任务状态和任务轨迹，但这些作为运行时元数据持久化，而非作为单独的公共流暴露。

## 聊天渠道处理

- Assistant 增量被缓冲到聊天 `delta` 消息中。
- 聊天 `final` 在**生命周期结束/错误**时发出。

## 超时

- `agent.wait` 默认值：30s（仅等待）。`timeoutMs` 参数覆盖。
- 智能体运行时：`agents.defaults.timeoutSeconds` 默认 172800s（48 小时）；由 Rust 运行时中止计时器强制执行。

## 可能提前结束的地方

- 智能体超时（中止）
- AbortSignal（取消）
- Gateway 断开连接或 RPC 超时
- `agent.wait` 超时（仅等待，不停止智能体）

## 循环策略

循环检测仍在工具调用之前运行，但操作层现在更加结构化：

- `warn`：继续进行，记录信号
- `nudge`：继续进行，但发出无进展 / 乒乓行为信号
- `soft_block_exact_repeat`：阻止完全重复的无进展调用
- `require_plan_refresh`：阻止并强制调用者修改其下一步

检测器仍使用阈值和模式匹配，但策略层不再将每个关键结果视为相同的通用阻止。

## 相关

- [工具](/tools) — 可用的智能体工具
- [钩子](/automation/hooks) — SDK 生命周期钩子和 webhooks
- [压缩](/concepts/compaction) — 长对话如何被摘要
- [执行审批](/tools/exec-approvals) — shell 命令的审批门控
- [思考](/tools/thinking) — 思考/推理级别配置
