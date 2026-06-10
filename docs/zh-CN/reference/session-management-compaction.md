---
read_when:
  - 你需要调试会话 ID、成绩单 JSONL 或 sessions.json 字段
  - 你在更改自动压缩行为或添加"压缩前"内务管理
  - 你想实现记忆刷新或静默系统轮次
summary: 深度解析：会话存储 + 成绩单、生命周期和（自动）压缩内部机制
title: 会话管理深度解析
x-i18n:
  generated_at: "2026-06-05T14:47:24Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: bb27135699df91a8767249c223a899a918f1f58e72ef8ae3125134d102681ebb
  source_path: reference/session-management-compaction.md
  workflow: 15
---

# 会话管理和压缩（深度解析）

本文档解释 CrawClaw 如何端到端管理会话：

- **会话路由**（入站消息如何映射到 `sessionKey`）
- **会话存储**（`sessions.json`）及其跟踪内容
- **成绩单持久化**（`*.jsonl`）及其结构
- **成绩单卫生处理**（运行前的提供商特定修复）
- **上下文限制**（上下文窗口 vs 跟踪的 token）
- **压缩**（手动 + 自动压缩）以及在哪里挂接压缩前工作
- **静默内务管理**（例如不应产生用户可见输出的记忆写入）

如果你首先需要更高层次的概述，请从以下开始：

- [/concepts/session](/concepts/session)
- [/concepts/compaction](/concepts/compaction)
- [/concepts/memory](/concepts/memory)
- [/concepts/session-pruning](/concepts/session-pruning)
- [/reference/transcript-hygiene](/reference/transcript-hygiene)

---

## 事实来源：Gateway 网关

CrawClaw 围绕拥有会话状态的单个 **Gateway 网关进程**设计。

- UI（浏览器客户端和其他客户端）应查询 Gateway 获取会话列表和 token 计数。
- 在远程模式下，会话文件在远程主机上；"检查你的本地 Mac 文件"不会反映 Gateway 正在使用的内容。

---

## 两个持久化层

CrawClaw 在两个层持久化会话：

1. **会话存储（`sessions.json`）**
   - 键/值映射：`sessionKey -> SessionEntry`
   - 小型、可变、可安全编辑（或删除条目）
   - 跟踪会话元数据（当前会话 ID、最后活动时间、开关、token 计数器等）

2. **成绩单（`<sessionId>.jsonl`）**
   - 具有树结构的仅追加成绩单（条目有 `id` + `parentId`）
   - 存储实际对话 + 工具调用 + 压缩摘要
   - 用于为未来轮次重建模型上下文

---

## 磁盘位置

每个智能体，在 Gateway 主机上：

- 存储：`~/.crawclaw/agents/<agentId>/sessions/sessions.json`
- 成绩单：`~/.crawclaw/agents/<agentId>/sessions/<sessionId>.jsonl`
  - 飞书话题会话：`.../<sessionId>-topic-<threadId>.jsonl`

CrawClaw 通过 Rust 运行时会话存储解析这些。

---

## 存储维护和磁盘控制

会话持久化有自动维护控制（`session.maintenance`）用于 `sessions.json` 和成绩单产物：

- `mode`：`warn`（默认）或 `enforce`
- `pruneAfter`：过时条目年龄截止（默认 `30d`）
- `maxEntries`：`sessions.json` 中的条目上限（默认 `500`）
- `rotateBytes`：当过大时轮换 `sessions.json`（默认 `10mb`）
- `resetArchiveRetention`：`*.reset.<timestamp>` 成绩单存档的保留期（默认：与 `pruneAfter` 相同；`false` 禁用清理）
- `maxDiskBytes`：可选的会话目录预算
- `highWaterBytes`：清理后的可选目标（默认 `maxDiskBytes` 的 `80%`）

磁盘预算清理的执行顺序（`mode: "enforce"`）：

1. 首先删除最旧的存档或孤立成绩单产物。
2. 如果仍然超过目标，驱逐最旧的会话条目及其成绩单文件。
3. 继续直到使用量达到或低于 `highWaterBytes`。

在 `mode: "warn"` 中，CrawClaw 报告潜在驱逐但不修改存储/文件。

要将清理从报告切换为实际修改，请在查看警告和阈值后将
`session.maintenance.mode` 设置为 `"enforce"`。调优保留策略时保持
`warn`，这样 CrawClaw 会报告潜在驱逐，但不会删除会话状态。

---

## 定时任务会话和运行日志

隔离的定时任务运行也会创建会话条目/成绩单，它们有专门的保留控制：

- `cron.sessionRetention`（默认 `24h`）从会话存储中修剪旧的隔离定时任务运行会话（`false` 禁用）。
- `cron.runLog.maxBytes` + `cron.runLog.keepLines` 修剪 `~/.crawclaw/cron/runs/<jobId>.jsonl` 文件（默认值：`2_000_000` 字节和 `2000` 行）。

---

## 会话键（`sessionKey`）

`sessionKey` 标识你所在的*对话桶*（路由 + 隔离）。

常见模式：

- 主/直接聊天（每个智能体）：`agent:<agentId>:<mainKey>`（默认 `main`）
- 群组：`agent:<agentId>:<channel>:group:<id>`
- 房间/渠道（community chat/飞书）：`agent:<agentId>:<channel>:channel:<id>` 或 `...:room:<id>`
- 定时任务：`cron:<job.id>`
- Webhook：`hook:<uuid>`（除非被覆盖）

规范规则记录在 [/concepts/session](/concepts/session)。

---

## 会话 ID（`sessionId`）

每个 `sessionKey` 指向当前 `sessionId`（继续对话的成绩单文件）。

经验规则：

- **重置**（`/new`）为该 `sessionKey` 创建新的 `sessionId`。
- **每日重置**（默认 Gateway 主机当地时间 4:00 AM）在重置边界后的下一条消息时创建新的 `sessionId`。
- **空闲过期**（`session.reset.idleMinutes` 或遗留 `session.idleMinutes`）在空闲窗口后收到消息时创建新的 `sessionId`。当每日和空闲都配置时，以先到期的为准。
- **线程父分叉保护**（`session.parentForkMaxTokens`，默认 `100000`）当父会话已经太大时跳过父成绩单分叉；新线程全新开始。设置为 `0` 以禁用。

实现细节：重置和分叉决策由 Rust 智能体运行时拥有，并通过 Rust Gateway 会话方法暴露。

---

## 会话存储模式（`sessions.json`）

存储的值类型是 Rust 运行时 `SessionEntry` 契约。

关键字段（不完整）：

- `sessionId`：当前成绩单 ID（除非设置了 `sessionFile`，否则文件名由此派生）
- `updatedAt`：最后活动时间戳
- `sessionFile`：可选的显式成绩单路径覆盖
- `chatType`：`direct | group | room`（帮助 UI 和发送策略）
- `provider`、`subject`、`room`、`space`、`displayName`：群组/渠道标签的元数据
- 开关：
  - `thinkingLevel`、`verboseLevel`、`reasoningLevel`、`elevatedLevel`
  - `sendPolicy`（按会话覆盖）
- 模型选择：
  - `providerOverride`、`modelOverride`、`authProfileOverride`
- Token 计数器（尽力而为/取决于提供商）：
  - `inputTokens`、`outputTokens`、`totalTokens`、`contextTokens`
- `compactionCount`：此会话键自动压缩完成的次数
- `memoryFlushAt`：上次压缩前记忆刷新的时间戳
- `memoryFlushCompactionCount`：上次刷新运行时压缩计数

存储可安全编辑，但 Gateway 是权威：它可能在会话运行时重写或重新水合条目。

---

## 成绩单结构（`*.jsonl`）

成绩单由 CrawClaw 的 Rust AgentRuntime 会话存储管理。

文件是 JSONL：

- 第一行：会话头（`type: "session"`，包含 `id`、`cwd`、`timestamp`、可选 `parentSession`）
- 然后：带 `id` + `parentId`（树）的会话条目

值得注意的条目类型：

- `message`：用户/助手/toolResult 消息
- `custom_message`：进入模型上下文的扩展注入消息（可对 UI 隐藏）
- `custom`：不进入模型上下文的扩展状态
- `compaction`：带 `firstKeptEntryId` 和 `tokensBefore` 的持久化压缩摘要
- `branch_summary`：导航树分支时的持久化摘要

CrawClaw 有意在正常读取期间不"修复"成绩单；Rust 运行时拥有成绩单读取、写入和任何受保护的修复步骤。

---

## 上下文窗口 vs 跟踪的 token

两个不同的概念很重要：

1. **模型上下文窗口**：每个模型的硬上限（模型可见的 token）
2. **会话存储计数器**：写入 `sessions.json` 的滚动统计（用于 /status 和仪表板）

如果你在调整限制：

- 上下文窗口来自模型目录（可通过配置覆盖）。
- 存储中的 `contextTokens` 是运行时估计/报告值；不要将其视为严格保证。

更多信息，请参见 [/token-use](/reference/token-use)。

---

## 压缩：是什么

压缩将旧对话摘要为成绩单中的持久化 `compaction` 条目，并保持最近消息完整。

压缩后，未来轮次看到：

- 压缩摘要
- `firstKeptEntryId` 之后的消息

压缩是**持久化的**（与会话修剪不同）。参见 [/concepts/session-pruning](/concepts/session-pruning)。

---

## 自动压缩何时发生（Rust 运行时）

Rust AgentRuntime 自动压缩路径在两种情况下触发：

1. **溢出恢复**：模型返回上下文溢出错误 → 压缩 → 重试。
2. **阈值维护**：成功轮次后，当：

`contextTokens > contextWindow - reserveTokens`

其中：

- `contextWindow` 是模型的上下文窗口
- `reserveTokens` 是为提示 + 下一个模型输出保留的头部空间

这些是 CrawClaw Rust AgentRuntime 拥有的运行时语义。

---

## 压缩设置（`reserveTokens`、`keepRecentTokens`）

压缩设置位于 CrawClaw 智能体默认值中：

```json5
{
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
  },
}
```

CrawClaw 还为智能体运行强制执行安全下限：

- 如果 `compaction.reserveTokens < reserveTokensFloor`，CrawClaw 会提升它。
- 默认下限是 `20000` token。
- 设置 `agents.defaults.compaction.reserveTokensFloor: 0` 以禁用下限。
- 如果已经更高，CrawClaw 不做改动。

原因：为多轮"内务管理"（如记忆写入）留出足够头部空间，在压缩变得不可避免之前。

实现细节：Rust AgentRuntime 在上下文组装和压缩期间应用有效的压缩设置。

---

## 用户可见表面

你可以通过以下方式观察压缩和会话状态：

- `/status`（在任何聊天会话中）
- CrawClaw Desktop 或本地 Gateway API（CLI）
- CrawClaw Desktop 或本地 Gateway API / `sessions --json`
- 详细模式：`🧹 Auto-compaction complete` + 压缩计数

---

## 静默内务管理（`NO_REPLY`）

CrawClaw 支持后台任务的"静默"轮次，用户不应看到中间输出。

约定：

- 助手以 `NO_REPLY` 开始输出，表示"不要向用户投递回复"。
- CrawClaw 在投递层剥离/抑制此内容。

从 `2026.1.10` 起，当部分块以 `NO_REPLY` 开头时，CrawClaw 也会抑制**草稿/打字流式传输**，因此静默操作不会在轮次中途泄漏部分输出。

---

## 压缩前"记忆刷新"（已实现）

目标：在自动压缩发生之前，运行静默的智能体轮次将持久状态写入磁盘（例如智能体工作区中的 `memory/YYYY-MM-DD.md`），以便压缩不会擦除关键上下文。

CrawClaw 使用**预阈值刷新**方法：

1. 监控会话上下文使用情况。
2. 当它越过"软阈值"（低于运行时压缩阈值）时，向智能体运行静默的"立即写入记忆"指令。
3. 使用 `NO_REPLY` 以便用户看不到任何内容。

配置（`agents.defaults.compaction.memoryFlush`）：

- `enabled`（默认：`true`）
- `softThresholdTokens`（默认：`4000`）
- `prompt`（刷新轮次的用户消息）
- `systemPrompt`（追加到刷新轮次的额外系统提示）

注意事项：

- 默认提示/系统提示包含 `NO_REPLY` 提示以抑制投递。
- 刷新在每个压缩周期运行一次（在 `sessions.json` 中跟踪）。
- 刷新为 Rust 智能体会话运行。
- 当会话工作区为只读时跳过刷新（`workspaceAccess: "ro"` 或 `"none"`）。
- 有关工作区文件布局和写入模式，请参见[记忆](/concepts/memory)。

旧的 TypeScript `session_before_compact` 插件钩子不再是生产路径的一部分；刷新逻辑由 Rust 运行时拥有。

---

## 故障排除检查清单

- 会话键错误？从 [/concepts/session](/concepts/session) 开始，确认 `/status` 中的 `sessionKey`。
- 存储与成绩单不匹配？确认 Gateway 主机和来自 CrawClaw Desktop 或本地 Gateway API 的存储路径。
- 压缩泛滥？检查：
  - 模型上下文窗口（太小）
  - 压缩设置（`reserveTokens` 对模型窗口太高可能导致更早压缩）
  - 工具结果膨胀：启用/调整会话修剪
- 静默轮次泄漏？确认回复以 `NO_REPLY` 开头（精确 token）并且你使用的是包含流式传输抑制修复的构建版本。
