---
read_when:
  - 你想了解 CrawClaw 中“上下文”的含义
  - 你在调试模型“知道”或“忘记”某事的原因
  - 你想减少上下文开销（/context、/status、/compact）
summary: 上下文：模型看到的内容、如何构建以及如何检查
title: 上下文
x-i18n:
  generated_at: "2026-06-05T14:13:11Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 5d2b9448306abd312fc6f60352da6e68b6855e3cddc17af55add8025f6b712c2
  source_path: concepts/context.md
  workflow: 15
---

# 上下文

“上下文”是** CrawClaw 发送给模型进行运行的所有内容**。它受模型的**上下文窗口**（token 限制）约束。

初学者心智模型：

- **系统提示词**（CrawClaw 构建）：规则、工具、skills 列表、时间/运行时，以及注入的工作空间文件。
- **对话历史**：你的消息 + 助手在此会话中的消息。
- **工具调用/结果 + 附件**：命令输出、文件读取、图片/音频等。

上下文与“记忆”**不是同一回事**：记忆可以存储在磁盘上并在稍后重新加载；上下文是模型当前窗口内的内容。

## 快速开始（检查上下文）

- `/status` → 快速查看“我的窗口有多满？”以及会话设置。
- `/context list` → 注入的内容 + 大小估算（每个文件 + 总计）。
- `/context detail` → 更详细的分解：每个文件、每个工具 schema 的大小、每个 skill 条目的大小，以及系统提示词大小。
- `/usage tokens` → 在普通回复末尾附加每条回复的使用量脚注。
- `/compact` → 将旧历史总结为压缩条目以释放窗口空间。

另请参阅：[斜杠命令](/tools/slash-commands)、[Token 使用与成本](/reference/token-use)、[压缩](/concepts/compaction)。

## 示例输出

值因模型、提供商、工具策略和工作空间内容而异。

### `/context list`

```
🧠 Context breakdown
Workspace: <workspaceDir>
Bootstrap max/file: 20,000 chars
System prompt (run): 38,412 chars (~9,603 tok) (Project Context 23,901 chars (~5,976 tok))

Injected workspace files:
- AGENTS.md: OK | raw 1,742 chars (~436 tok) | injected 1,742 chars (~436 tok)
- SOUL.md: OK | raw 912 chars (~228 tok) | injected 912 chars (~228 tok)
- TOOLS.md: TRUNCATED | raw 54,210 chars (~13,553 tok) | injected 20,962 chars (~5,241 tok)
- IDENTITY.md: OK | raw 211 chars (~53 tok) | injected 211 chars (~53 tok)
- USER.md: OK | raw 388 chars (~97 tok) | injected 388 chars (~97 tok)
- HEARTBEAT.md: MISSING | raw 0 | injected 0
- BOOTSTRAP.md: OK | raw 0 chars (~0 tok) | injected 0 chars (~0 tok)

Skills list (system prompt text): 2,184 chars (~546 tok) (12 skills)
Tools: read, edit, write, exec, process, browser, message, sessions_send, …
Tool list (system prompt text): 1,032 chars (~258 tok)
Tool schemas (JSON): 31,988 chars (~7,997 tok) (counts toward context; not shown as text)
Tools: (same as above)

Session tokens (cached): 14,250 total / ctx=32,000
```

### `/context detail`

```
🧠 Context breakdown (detailed)
…
Top skills (prompt entry size):
- frontend-design: 412 chars (~103 tok)
- oracle: 401 chars (~101 tok)
… (+10 more skills)

Top tools (schema size):
- browser: 9,812 chars (~2,453 tok)
- exec: 6,240 chars (~1,560 tok)
… (+N more tools)
```

## 计入上下文窗口的内容

模型接收的所有内容都计入，包括：

- 系统提示词（所有部分）。
- 对话历史。
- 工具调用 + 工具结果。
- 附件/记录（图片/音频/文件）。
- 压缩摘要和修剪产物。
- 提供商“包装器”或隐藏头信息（不可见，但仍计入）。

## 有效上下文预算

CrawClaw 不将宣传的上下文窗口视为完全可用于提示文本。对于每次运行，它在构建提供商上下文之前解析当前的提供商和模型。模型窗口按以下顺序解析：

1. `models.providers.<provider>.models[].contextWindow` 和 `maxTokens`。
2. 捆绑的提供商模型限制元数据。
3. 保守的后备窗口。

`agents.defaults.contextTokens` 是解析后模型窗口的可选上限。当省略该上限时，200k 或 1M 窗口模型不会缩减到后备的 128k 窗口。

该窗口被拆分为稳定的输入预算：

- 输出预留：模型响应的空间。
- 提供商开销：提供商包装器和隐藏框架的保守空间。
- 工具 schema 预留：活动工具定义的估计大小。
- 可用输入：系统提示词部分、结构化上下文和当前用户提示的剩余预算。

运行时在 `contextSummary.budget` 中公开该决策，包括 `provider`、`model`、`modelContextWindow`、`resolvedContextWindow`、`maxPromptTokens`、`outputReserveTokens`、`providerOverheadTokens`、`toolSchemaTokens`、能力标志和 `budgetSource`。相同的 `outputReserveTokens` 值在请求输出限制时作为请求输出限制发送到本机提供商传输（当该传输支持等效字段时）。

模型能力也会影响编译后的上下文。如果所选模型不支持工具调用，CrawClaw 会保留工具 schema 并将该工具报告为该轮次的延迟。如果不支持推理努力控制，请求的推理级别不会发送到提供商。如果仅支持文本输入，则在构建提供商请求之前将图片块替换为省略标记。

`contextSummary.projection` 还公开了应用了哪些投影阶段：

- `capabilityProjectionApplied`：工具、推理或图片输入被保留，因为所选模型不支持它们。
- `toolResultProjectionApplied`：大型工具结果为下一个提供商请求而缩短，也可能已被持久化以供恢复。
- `historyCompactionApplied`：存储的压缩摘要替换了旧的记录消息。
- `overflowProjectionApplied`：未压缩的提示超出了有效的提示预算，因此 CrawClaw 添加了溢出摘要，并为当前运行保留了安全尾部。

预算策略不会在每条消息上重新调整。正常轮次仅针对当前模型、配置和工具 schema 运行确定性编译步骤。当其中一个输入发生变化，或当上下文溢出事件导致当前运行的一次性较低输入上限时，策略会重新计算。

在构建提供商请求之前，结构化上下文会被修剪。系统硬规则和当前用户提示受到保护。第一次修剪仅针对结构化部分，如记忆/经验、引导上下文和钩子/用户上下文。部分可以声明预算元数据（`priority`、`eviction` 和 `maxTokens`），以便在丢弃或截断较高优先级部分之前先丢弃或截断较低优先级部分。对话历史仍由现有修剪和压缩机制处理。

记忆召回接收模型缩放的预算。较小的窗口获得更紧凑的记忆预算，而 128k、256k 和 1M 窗口模型可以获得更多有用的记忆和经验召回。这仍有硬上限，因此大窗口模型不会导致 CrawClaw 发送无限上下文。

提供商轮次也会在大型工具结果进入下一个模型请求之前进行投影。每个结果的阈值根据有效提示预算进行缩放，并保持硬最小值和最大值，因此小窗口模型可以避免过大的工具结果，而大窗口模型可以保留更多有用的输出。提供商看到一个预览加上明确的省略原因。非常大的工具结果也会持久化在运行时会话存储下，提供商预览包含保存的路径，因此后续轮次可以恢复完整输出而无需将其保留在提示上下文中。会话记录在磁盘上保留原始工具输出。运行 `contextSummary` 包括投影的历史 token 估计、延迟工具计数、加载的 skill 计数、记忆片段计数、压缩状态、投影工具结果计数、持久化的工具结果计数、省略的字符计数，以及人类可读的投影原因。运行时事件流将相同的投影作为 `agent.contextProjected` 发出，因此 Gateway 和桌面客户端可以显示精确的预算和投影阶段，而无需检查提供商有效载荷。

当未压缩的记录将超出提示预算时，CrawClaw 会保留安全尾部并添加一个确定性的“因上下文预算省略了更早对话”摘要部分。这与会话压缩分开；它保护单个提供商轮次而不重写存储的记录。

## CrawClaw 如何构建系统提示词

系统提示词**归 CrawClaw 所有**，每次运行都会重新构建。它包括：

- 工具列表 + 简短描述。
- Skills 列表（仅元数据；见下文）。
- 工作空间位置。
- 时间（UTC + 配置的用户转换时间）。
- 运行时元数据（主机/操作系统/模型/思考）。
- 在 **Project Context** 下注入的工作空间引导文件。

完整分解：[系统提示词](/concepts/system-prompt)。

## 注入的工作空间文件（Project Context）

默认情况下，CrawClaw 仅注入：

- `AGENTS.md` 用于正常运行
- `HEARTBEAT.md` 用于使用轻量级上下文的事件驱动的 main-session 唤醒运行

大型文件使用 `agents.defaults.bootstrapMaxChars`（默认 `20000` 字符）按文件截断。CrawClaw 还使用 `agents.defaults.bootstrapTotalMaxChars`（默认 `150000` 字符）跨文件强制执行总引导注入上限。`/context` 显示**原始 vs 注入**大小以及是否发生了截断。

当发生截断时，运行时可以在 Project Context 下注入一个提示内警告块。使用 `agents.defaults.bootstrapPromptTruncationWarning`（`off`、`once`、`always`；默认 `once`）进行配置。

## Skills：注入与按需加载

系统提示词包括一个紧凑的 **skills 列表**（名称 + 描述 + 位置）。此列表有实际开销。

默认情况下，Skill 指令**不包含**。模型应该在**需要时** `read` skill 的 `SKILL.md`。

## 工具：有两种成本

工具以两种方式影响上下文：

1. **系统提示词中的工具列表文本**（你看到的“工具”部分）。
2. **工具 schemas**（JSON）。这些会发送给模型以便调用工具。它们计入上下文，即使你看不到它们作为纯文本。

`/context detail` 分解了最大的工具 schema，以便你看到什么占主导地位。

## 命令、指令和“内联快捷方式”

斜杠命令由 Gateway 处理。有几种不同的行为：

- **独立命令**：仅包含 `/...` 的消息作为命令运行。
- **指令**：`/think`、`/verbose`、`/reasoning`、`/elevated`、`/model`、`/queue` 在模型看到消息之前被剥离。
  - 仅指令消息保留会话设置。
  - 普通消息中的内联指令作为每条消息的提示。
- **内联快捷方式**（仅限白名单发送者）：普通消息中的某些 `/...` 标记可以立即运行（例如“hey /status”），并在模型看到剩余文本之前被剥离。

详情：[斜杠命令](/tools/slash-commands)。

## 会话、压缩和修剪（持久化的内容）

跨消息持久化的内容取决于机制：

- **正常历史**在会话记录中持久化，直到被策略压缩/修剪。
- **压缩**将摘要持久化到记录中，并保持最近消息完整。
- **修剪**从运行的**内存中**提示中删除旧的工具结果，但不会重写记录。

文档：[会话](/concepts/session)、[压缩](/concepts/compaction)、[会话修剪](/concepts/session-pruning)。

CrawClaw 现在使用内置的记忆运行时进行上下文组装和压缩。已移除旧版插件提供的上下文引擎；自定义记忆行为应通过 Rust 记忆运行时实现。

## `/context` 实际报告的内容

`/context` 在可用时优先使用最新的**运行构建的**系统提示词报告：

- `System prompt (run)` = 从最后一个嵌入式（工具支持）运行捕获并持久化在会话存储中。
- `System prompt (estimate)` = 在没有运行报告时动态计算。

无论哪种方式，它都报告大小和主要贡献者；它**不会**转储完整的系统提示词或工具 schema。

## 相关

- [Context Engine 移除](/concepts/context-engine) — 已移除的旧版界面的迁移说明
- [压缩](/concepts/compaction) — 总结长对话
- [系统提示词](/concepts/system-prompt) — 系统提示词如何构建
- [智能体循环](/concepts/agent-loop) — 完整的智能体执行周期
