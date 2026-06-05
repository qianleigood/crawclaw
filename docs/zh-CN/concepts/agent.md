---
read_when:
  - 更改智能体运行时、工作区引导或会话行为
summary: 智能体运行时、工作区合约和会话引导
title: 智能体运行时
x-i18n:
  generated_at: "2026-06-05T14:12:37Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: af613a254a6c9efe0090f5aef012899a2f98b45479bd0d242e9395f30010d893
  source_path: concepts/agent.md
  workflow: 15
---

# 智能体运行时

CrawClaw 为每个活动运行提供基于任务的 Rust 智能体运行时，同时支持多个配置的一级智能体以及派生的子智能体和 ACP 子运行。

## 工作区（必需）

每个配置的智能体解析其自己的工作区目录。默认智能体使用 `agents.defaults.workspace`；其他一级智能体可以用自己的 workspace 设置覆盖它。运行使用其解析的智能体工作区作为工具和上下文的主要工作目录（`cwd`）。

推荐做法：如果 `~/.crawclaw/crawclaw.json` 不存在，使用 CrawClaw Desktop 或本地 Gateway API 创建它，并初始化工作区文件。

完整工作区布局 + 备份指南：[智能体工作区](/concepts/agent-workspace)

[Gateway 配置](/gateway/configuration))。

## 引导文件（注入）

在智能体工作区内，CrawClaw 保留多个用户可编辑文件，但默认运行时引导注入范围故意较窄：

- `AGENTS.md` — 正常运行时注入
- `HEARTBEAT.md` — 旧版 heartbeat 风格运行的兼容性文件

其他工作区文件（如 `SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md` 和 `BOOTSTRAP.md`）可能仍存在于工作区管理中，但它们不属于默认运行时注入路径。

空文件会被跳过。大型文件会被修剪并截断并添加标记，以保持提示简洁（读取文件以获取完整内容）。

如果活动的引导文件缺失，CrawClaw 会注入一行单一的“缺失文件”标记（并且 CrawClaw Desktop 或本地 Gateway API 将创建一个安全的默认模板）。

`BOOTSTRAP.md` 仅在**全新工作区**（不存在其他引导文件）时创建。如果在完成初始化后删除它，后续重新启动时不应重新创建它。

要完全禁用引导文件创建（对于预先填充的工作区），请设置：

```json5
{ agent: { skipBootstrap: true } }
```

## 内置工具

核心工具（read/exec/edit/write 及相关系统工具）始终可用，受工具策略约束。`apply_patch` 是可选的，由 `tools.exec.applyPatch` 控制。`TOOLS.md` **不**控制存在哪些工具；它是关于你希望如何使用它们的指导。

## Skills

CrawClaw 从三个位置加载 skills（命名冲突时工作区优先）：

- 捆绑（随安装附带）
- 托管/本地：`~/.crawclaw/skills`
- 工作区：`<workspace>/skills`

Skills 可以通过配置/env 进行门控（参见 [Gateway 配置](/gateway/configuration) 中的 `skills`）。

## 运行时边界

Rust 智能体运行时负责模型选择、工具连接、提示组装、会话状态和转录写入。TypeScript 限于 desktop 渲染器，不得重新进入智能体运行时路径。

## 基于任务的运行时

CrawClaw 现在将智能体运行视为基于任务的运行时单元，而非匿名会话副作用。

- 前台运行、子智能体运行和 ACP 运行都可以表示为任务记录。
- 每个运行保留运行时元数据，如 `agentId`、`parentAgentId`、模式（`foreground` / `background`）、会话引用和派生来源。
- 运行时进度通过共享智能体事件跟踪，然后反映到任务状态。
- 恢复逻辑可以在普通会话查找不足时回退到智能体运行时元数据。
- 检查和运维工具通过 CrawClaw Desktop、本地 Gateway API 和 `agent.inspect` RPC 读取相同的持久化运行时/任务元数据。

## 上下文归档

基于任务的运行也可以捕获到上下文归档。

- `agent.inspect` 可以显示归档引用、查询上下文诊断以及从归档生命周期事件重建的紧凑运行时间线
- 上下文归档为模型可见上下文、工具决策和轮次后完成状态保持面向回放的真相层

这与普通会话转录分开。转录仍然是面向产品的对话日志；上下文归档是回放/导出层。

## 两阶段审查

CrawClaw 支持专门的“尝试破坏它”两阶段审查路径，在任务被认为真正完成之前进行验证。

- 面向用户的入口是聊天命令 `/review [focus]`。
- 在内部，`/review` 调用 `review_task` 流程，该流程首先派生 `review-spec`，然后除非 spec 失败，再派生 `review-quality`。
- `/review` 是唯一的公开审查入口。
- 审查运行使用专用系统提示和受限的验证工具集，而不是继承完整的父工具表面。
- 审查运行故意设计为只读：它们可以检查、运行检查并产生裁决，但不能修补文件或递归派生更多审查运行。
- 确定性聚合器产生 `REVIEW_PASS`、`REVIEW_FAIL` 或 `REVIEW_PARTIAL`。只有 `REVIEW_PASS` 可以成为审查完成证据。

## 会话

会话转录以 JSONL 格式存储在：

- `~/.crawclaw/agents/<agentId>/sessions/<SessionId>.jsonl`

会话 ID 是稳定的，由 CrawClaw 选择。
不读取来自其他工具的旧版会话文件夹。

基于任务的运行也在以下位置持久化运行时元数据和完成追踪：

- `~/.crawclaw/agents/<agentId>/tasks/<TaskId>.json`
- `~/.crawclaw/agents/<agentId>/tasks/<TaskId>.trajectory.json`
- `~/.crawclaw/agents/<agentId>/tasks/<TaskId>.capabilities.json`

任务 JSON 存储运行时元数据（会话引用、模式、父/子智能体链接、派生来源）。轨迹 JSON 存储步骤追踪、完成证据和完成守护输出。能力快照存储请求者引用），供守护和检查使用。

## 流式传输时的操控

当队列模式为 `steer` 时，入站消息被注入到当前运行中。排队的操控在**当前助手轮次完成执行其工具调用后**、下一个 LLM 调用之前传递。操控不再跳过当前助手消息中剩余的工具调用；而是在下一个模型边界注入排队的消息。

当队列模式为 `followup` 或 `collect` 时，入站消息会保留直到当前轮次结束，然后新的智能体轮次以排队的负载开始。参见[队列](/concepts/queue)了解模式 + 防抖/上限行为。

分块流式传输在完成的助手块一完成就立即发送；它**默认关闭**（`agents.defaults.blockStreamingDefault: "off"`）。
通过 `agents.defaults.blockStreamingBreak` 调整边界（`text_end` vs `message_end`；默认为 text_end）。
使用 `agents.defaults.blockStreamingChunk` 控制软分块大小（默认为 800–1200 字符；优先段落分隔，然后是换行；最后是句子）。
使用 `agents.defaults.blockStreamingCoalesce` 合并流式传输的块以减少单行刷屏（发送前基于空闲的合并）。非 Feishu 渠道需要显式 `*.blockStreaming: true` 才能启用分块回复。
详细的工具摘要在工具开始时发出（无防抖）；浏览器客户端在可用时通过智能体事件流式传输工具输出。
更多详情：[流式传输 + 分块](/concepts/streaming)。

## 模型引用

配置中的模型引用（例如 `agents.defaults.model` 和 `agents.defaults.models`）通过在**第一个**`/` 处拆分来解析。

- 配置模型时使用 `provider/model`。
- 如果模型 ID 本身包含 `/`（OpenRouter 风格），请包含提供商前缀（示例：`openrouter/moonshotai/kimi-k2`）。
- 如果省略提供商，CrawClaw 将输入视为别名或**默认提供商**的模型（仅在模型 ID 中没有 `/` 时有效）。

## 配置（最小）

至少设置：

- `agents.defaults.workspace`
- `channels.weixin.allowFrom`（强烈推荐）

---

_下一页：[群聊](/channels/group-messages)_ 🦀
