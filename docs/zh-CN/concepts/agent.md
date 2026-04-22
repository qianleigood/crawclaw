---
read_when:
  - 更改智能体运行时、工作区引导或会话行为时
summary: 智能体运行时、工作区契约和 task-backed 会话引导
title: 智能体运行时
x-i18n:
  generated_at: "2026-02-03T10:04:53Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: c3dae51493da0c047435d3adf2992fdb6cdec551c071c987f3040b601573b462
  source_path: concepts/agent.md
  workflow: 15
---

# 智能体运行时 🤖

CrawClaw 会为每个活动运行创建一份 task-backed 的嵌入式智能体运行时，同时支持多个已配置的顶层智能体，以及生成出来的 subagent / ACP 子运行。

## 工作区（必需）

每个已配置智能体都会解析自己的 workspace。默认智能体使用
`agents.defaults.workspace`；其他顶层智能体可以覆盖为自己的 workspace。
一次运行会把解析出来的 agent workspace 作为主要工作目录（`cwd`），用于工具和上下文。

建议：使用 `crawclaw setup` 在缺失时创建 `~/.crawclaw/crawclaw.json` 并初始化工作区文件。

<Note>
如果你当前关注的是“整个项目的总结构”，而不是单个 agent run 的行为，请先读 [项目整体架构总览](/concepts/project-architecture-overview)。这篇更偏执行内核与会话运行时。
</Note>

完整工作区布局 + 备份指南：[智能体工作区](/concepts/agent-workspace)

如果启用了 `agents.defaults.sandbox`，非主会话可以在 `agents.defaults.sandbox.workspaceRoot` 下使用按会话隔离的工作区覆盖此设置（参见 [Gateway 网关配置](/gateway/configuration)）。

## 引导文件（注入）

在 agent workspace 内，CrawClaw 期望以下用户可编辑的文件：

- `AGENTS.md` — 操作指令 + "记忆"
- `SOUL.md` — 人设、边界、语气
- `TOOLS.md` — 用户维护的工具说明（例如 `imsg`、`sag`、约定）
- `BOOTSTRAP.md` — 一次性首次运行仪式（完成后删除）
- `IDENTITY.md` — 智能体名称/风格/表情
- `USER.md` — 用户档案 + 偏好称呼

在新会话的第一轮，CrawClaw 将这些文件的内容直接注入智能体上下文。

空文件会被跳过。大文件会被修剪和截断并添加标记，以保持提示词精简（阅读文件获取完整内容）。

如果文件缺失，CrawClaw 会注入一行"文件缺失"标记（`crawclaw setup` 将创建安全的默认模板）。

`BOOTSTRAP.md` 仅在**全新工作区**（没有其他引导文件存在）时创建。如果你在完成仪式后删除它，后续重启不应重新创建。

要完全禁用引导文件创建（用于预置工作区），请设置：

```json5
{ agent: { skipBootstrap: true } }
```

## 内置工具

核心工具（read/exec/edit/write 及相关系统工具）始终可用，受工具策略约束。`apply_patch` 是可选的，由 `tools.exec.applyPatch` 控制。`TOOLS.md` **不**控制哪些工具存在；它是关于*你*希望如何使用它们的指导。

## Skills

CrawClaw 从三个位置加载 Skills（名称冲突时工作区优先）：

- 内置（随安装包提供）
- 托管/本地：`~/.crawclaw/skills`
- 工作区：`<workspace>/skills`

Skills 可通过配置/环境变量控制（参见 [Gateway 网关配置](/gateway/configuration) 中的 `skills`）。

从职责上看：

- `tools` 是执行能力底座
- `skills` 是行为与提示覆盖层

这两个概念在项目级架构里已经被正式分开，见 [项目整体架构总览](/concepts/project-architecture-overview)。

## 运行时边界

CrawClaw 复用 Pi agent core 的模型、工具和 prompt pipeline，但**会话管理、任务化运行时、设备发现、工具装配和消息投递由 CrawClaw 负责**。

- 不读取 `~/.pi/agent` 或 `<workspace>/.pi` 设置。

## task-backed 运行时

CrawClaw 现在把智能体运行视为带任务身份的运行时单元，而不是只有
`sessionId` 的匿名副作用。

- 前台主运行、子智能体运行、ACP 运行都可以挂到正式任务记录上。
- 每次运行会保留 `agentId`、`parentAgentId`、模式（`foreground` /
  `background`）、会话引用和 `spawnSource` 等运行时元数据。
- 运行时进度通过统一的 agent event 汇总，再回写到任务状态。
- `resume` 在普通 session 查找不够时，可以回退到 agent runtime metadata。
- `crawclaw agent inspect`、`crawclaw agents status` 和 gateway `agent.inspect`
  都直接读取这套持久化 runtime/task 元数据。

## Context Archive

task-backed run 现在还可以被捕获到 Context Archive。

- `agent inspect` 可以展示匹配运行的 archive refs、query-context 诊断，
  以及根据归档 lifecycle 事件重建出来的紧凑 run timeline
- `agent export-context` 可以把匹配运行导出成 replay / debug bundle
- Context Archive 保存的是面向回放的真相层：模型可见上下文、tool 决策、
  以及 post-turn completion 状态

它和普通 session transcript 不是一回事。transcript 仍然是产品侧会话记录，
Context Archive 则是 replay / export 层。

## 两阶段 review

CrawClaw 支持一条专门的两阶段 review 路径，用来在任务被视为真正完成前做“尽量找问题”的验证。

- 用户入口是聊天命令 `/review [focus]`。
- 内部实现上，`/review` 会调用 `review_task` flow，先创建 `review-spec`，如果 spec 阶段没有失败，再创建 `review-quality`。
- `/review` 是唯一公开的 review 入口。
- review 运行使用专用 system prompt 和受限的验证工具集，而不是继承父 agent 的完整工具面。
- review 运行被刻意设计成只读：它可以检查、运行验证、给出 verdict，但不能改文件，也不能递归再创建 review run。
- 确定性聚合器会产出 `REVIEW_PASS`、`REVIEW_FAIL` 或 `REVIEW_PARTIAL`。只有 `REVIEW_PASS` 可以成为 review completion evidence。

## 会话

会话记录以 JSONL 格式存储在：

- `~/.crawclaw/agents/<agentId>/sessions/<SessionId>.jsonl`

会话 ID 是稳定的，由 CrawClaw 选择。
**不**读取旧版 Pi/Tau 会话文件夹。

task-backed 运行还会额外落盘：

- `~/.crawclaw/agents/<agentId>/tasks/<TaskId>.json`
- `~/.crawclaw/agents/<agentId>/tasks/<TaskId>.trajectory.json`
- `~/.crawclaw/agents/<agentId>/tasks/<TaskId>.capabilities.json`

其中 task JSON 保存运行时元数据（会话引用、模式、父子 agent 关系、
spawn 来源），trajectory JSON 保存步骤轨迹、完成证据和 completion
guard 结果，capabilities JSON 保存 guard / inspection 使用的运行时执行包络
（runtime、model、sandbox、workspace、requester 引用等）。

## 流式传输中的引导

当队列模式为 `steer` 时，入站消息会注入当前运行。
排队的 steer 消息会在**当前助手回合完成本轮工具调用之后**、下一个 LLM
调用之前送达；它不再跳过当前助手消息剩余的工具调用。

当队列模式为 `followup` 或 `collect` 时，入站消息会保留到当前轮次结束，然后使用排队的载荷开始新的智能体轮次。参见 [队列](/concepts/queue) 了解模式 + 防抖/上限行为。

分块流式传输在助手块完成后立即发送；默认为**关闭**（`agents.defaults.blockStreamingDefault: "off"`）。
通过 `agents.defaults.blockStreamingBreak` 调整边界（`text_end` 与 `message_end`；默认为 text_end）。
使用 `agents.defaults.blockStreamingChunk` 控制软块分块（默认 800–1200 字符；优先段落分隔，其次换行；最后是句子）。
使用 `agents.defaults.blockStreamingCoalesce` 合并流式块以减少单行刷屏（发送前基于空闲的合并）。非 Telegram 渠道需要显式设置 `*.blockStreaming: true` 以启用分块回复。
工具启动时发出详细工具摘要（无防抖）；Control UI 在可用时通过智能体事件流式传输工具输出。
更多详情：[流式传输 + 分块](/concepts/streaming)。

## 模型引用

配置中的模型引用（例如 `agents.defaults.model` 和 `agents.defaults.models`）通过在**第一个** `/` 处分割来解析。

- 配置模型时使用 `provider/model`。
- 如果模型 ID 本身包含 `/`（OpenRouter 风格），请包含提供商前缀（例如：`openrouter/moonshotai/kimi-k2`）。
- 如果省略提供商，CrawClaw 将输入视为别名或**默认提供商**的模型（仅在模型 ID 中没有 `/` 时有效）。

## 配置（最小）

至少需要设置：

- `agents.defaults.workspace`
- `channels.whatsapp.allowFrom`（强烈建议）

## 延伸阅读

- [项目整体架构总览](/concepts/project-architecture-overview)
- [项目缓存机制总览](/concepts/project-cache-strategy)
- [执行过程可见性系统](/concepts/execution-visibility-system)
- [记忆](/concepts/memory)

---

_下一篇：[群聊](/channels/group-messages)_ 🦀
