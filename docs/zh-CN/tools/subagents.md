---
read_when:
  - 你想通过 agent 执行后台/并行工作
  - 你正在修改 sessions_spawn 或子智能体工具策略
  - 你正在实现或排查线程绑定的子智能体会话
summary: Sub-agents：从现有 agent 运行中分离出的独立 agent 运行，完成后将结果汇报给请求方聊天
title: 子智能体
x-i18n:
  generated_at: "2026-06-10T08:20:00Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 93a26002076d52ff13ebb0d1980d4c08a9e01e05426338757f86b1a28381b94f
  source_path: tools/subagents.md
  workflow: 15
---

# 子智能体

子智能体是从现有 agent 运行中分离出的后台 agent 运行。它们在自己的会话中运行（`agent:<agentId>:subagent:<uuid>`），完成后**会向**请求方聊天渠道**汇报**其结果。每一次子智能体运行都会作为[后台任务](/automation/tasks)被追踪。

基于任务的子智能体运行现在会持久化：

- 会话记录
- 任务运行时元数据
- 包含完成证据和完成防护输出的任务轨迹

## 上下文和记忆边界

子智能体是隔离的，但并非在所有维度上都隔离：

- 它们会启动一个新的 CrawClaw 会话，**不会**继承完整的父会话记录。
- 它们接收特定子任务的提示词以及谱系元数据
  （`requesterSessionKey`、请求方投递来源、父/子引用）。
- 会话记忆是隔离的，因为它按子会话的 `sessionId` 键控。
- 当父智能体和子智能体解析到相同的 `agentId` 范围时，持久记忆仍可共享。
- Hindsight 经验召回在子提示词组装期间从配置的相同后端查询；不会按会话 ID 进行分区。
- 同 agent 派生默认继承调用方工作区。跨 agent 派生则切换到目标 agent 工作区。

派生完成后进行运行时检查时，请使用 `/subagents info`、`/subagents log`、CrawClaw Desktop 的任务/会话视图，或 `subagents`、`sessions.list`、`sessions.history` 等 Gateway/session surface。

## 斜杠命令

使用 `/subagents` 来检查或控制**当前会话**的子智能体运行：

- `/subagents list`
- `/subagents kill <id|#|all>`
- `/subagents log <id|#> [limit] [tools]`
- `/subagents info <id|#>`
- `/subagents send <id|#> <message>`
- `/subagents steer <id|#> <message>`
- `/subagents spawn <agentId> <task> [--model <model>] [--thinking <level>]`

线程绑定控制：

这些命令适用于支持持久线程绑定的渠道。参见下面的**支持线程的渠道**。

- `/focus <subagent-label|session-key|session-id|session-label>`
- `/unfocus`
- `/agents`
- `/session idle <duration|off>`
- `/session max-age <duration|off>`

`/subagents info` 显示运行元数据（状态、时间戳、会话 ID、记录路径、清理）。
对于基于任务的运行，关联的任务元数据也会记录轨迹路径，供完成评估和回放使用。

### 派生行为

`/subagents spawn` 作为用户命令启动后台子智能体，而非内部转发，当运行结束时它会向请求方聊天发送一条最终完成更新。

- 派生命令是非阻塞的，会立即返回一个运行 ID。
- 完成后，子智能体会向请求方聊天渠道发送一条总结/结果消息。
- 手动派生时，投递具有弹性：
  - CrawClaw 首先尝试使用稳定幂等键进行直接 `agent` 投递。
  - 如果直接投递失败，则回退到队列路由。
  - 如果队列路由仍不可用，则使用短指数退避重试 announcement，直到最终放弃。
- 完成交接给请求方会话的是运行时生成的内部上下文（不是用户撰写的文本），包括：
  - `Result`（`assistant` 回复文本，或最新的 `toolResult`，如果 assistant 回复为空）
  - `Status`（`completed successfully` / `failed` / `timed out` / `unknown`）
  - 紧凑的运行时/token 统计
  - 投递指令，告诉请求方 agent 用正常的 assistant 语气重写（不要直接转发原始内部元数据）
- `--model` 和 `--thinking` 会覆盖该特定运行的默认值。
- 使用 `info`/`log` 在完成后检查详情和输出。
- 完成证据和完成防护结果存储在任务轨迹中，因此可以审计成功的分离工作，而无需重放完整的聊天记录。
- 上下文存档也可以保留模型可见的上下文、工具决策和轮次后状态，用于重放/调试，而不以记录作为唯一真实来源。
- `/subagents spawn` 是一次性模式（`mode: "run"`）。对于持久线程绑定会话，请使用 `sessions_spawn` 并设置 `thread: true` 和 `mode: "session"`。
- 对于 ACP harness 会话（Codex、Claude Code、Gemini CLI），请使用 `sessions_spawn` 并设置 `runtime: "acp"`，参见 [ACP 智能体](/tools/acp-agents)。

主要目标：

- 并行化"研究/长时间任务/慢速工具"工作，而不阻塞主运行。
- 保持工具表面难以误用：子智能体默认**不**获取会话工具。
- 支持可配置的嵌套深度，以实现编排器模式。

成本注意：每个子智能体都有**自己的**上下文和 token 使用量。对于繁重或重复的任务，为子智能体设置更便宜的模型，让主智能体使用更高质量的模型。你可以通过 `agents.defaults.subagents.model` 或按 agent 覆盖来配置。

## 内置任务智能体

Claude Code 兼容的 `Agent` 和 `Task` 调用可以通过 `subagent_type` 选择内置任务智能体：

- `general-purpose`：使用默认工作区工具策略的通用委托工作
- `Explore`：只读代码和上下文研究
- `Plan`：只读实现规划
- `verification`：只读验证；提示词需要最终一行 `VERDICT: PASS`、`VERDICT: FAIL` 或 `VERDICT: BLOCKED`

这些任务智能体是普通的子智能体。它们与用于审查、记忆、梦境和会话摘要的内部 Rust 特殊智能体不同。`Explore`、`Plan` 和 `verification` 以只读权限模式运行，并使用只读/搜索工具白名单，因此变异工具如 `write`、`edit`、`apply_patch`、`NotebookEdit`、`Agent` 和 `ExitPlanMode` 不会暴露给它们。

`model: "inherit"` 保持配置的提供商模型。`mode` 和 `permissionMode` 映射到原生权限策略：`readOnly` 和 `plan` 选择只读工具，`dontAsk` 和 `bypassPermissions` 选择完全访问，`default`、`acceptEdits`、`auto` 或 `workspace` 选择工作区模式。

## 工具

使用 `sessions_spawn`：

- 启动子智能体运行（`deliver: false`，全局通道：`subagent`）
- 然后运行一个 announcement 步骤，并将 announcement 回复发布到请求方聊天渠道
- 默认模型：继承调用方，除非你设置了 `agents.defaults.subagents.model`（或按 agent 的 `agents.list[].subagents.model`）；显式 `sessions_spawn.model` 仍优先。
- 默认思考：继承调用方，除非你设置了 `agents.defaults.subagents.thinking`（或按 agent 的 `agents.list[].subagents.thinking`）；显式 `sessions_spawn.thinking` 仍优先。
- 默认运行超时：如果省略 `sessions_spawn.runTimeoutSeconds`，CrawClaw 会在设置时使用 `agents.defaults.subagents.runTimeoutSeconds`；否则回退到 `0`（无超时）。

工具参数：

- `task`（必需）
- `label?`（可选）
- `agentId?`（可选；允许时在另一个 agent ID 下派生）
- `model?`（可选；覆盖子智能体模型；无效值会被跳过，子智能体会以默认模型运行，并在工具结果中显示警告）
- `thinking?`（可选；覆盖子智能体运行的思考级别）
- `runTimeoutSeconds?`（默认为设置时的 `agents.defaults.subagents.runTimeoutSeconds`，否则为 `0`；设置后，子智能体运行会在 N 秒后中止）
- `thread?`（默认为 `false`；为 `true` 时，为该子智能体会话请求渠道线程绑定）
- `mode?`（`run|session`）
  - 默认为 `run`
  - 如果 `thread: true` 且省略 `mode`，默认变为 `session`
  - `mode: "session"` 需要 `thread: true`
- `cleanup?`（`delete|keep`，默认为 `keep`）
- `sessions_spawn` **不接受**渠道投递参数（`target`、`channel`、`to`、`threadId`、`replyTo`、`transport`）。如需投递，请从派生的运行中使用 `message`/`sessions_send`。

## 线程绑定会话

当渠道启用线程绑定时，子智能体可以绑定到线程，这样该线程中的后续用户消息会继续路由到同一个子智能体会话。

### 支持线程的渠道

- QQBot（目前唯一支持的渠道）：支持持久线程绑定子智能体会话（`sessions_spawn` + `thread: true`）、手动线程控制（`/focus`、`/unfocus`、`/agents`、`/session idle`、`/session max-age`），以及适配器键 `channels.qqbot.threadBindings.enabled`、`channels.qqbot.threadBindings.idleHours`、`channels.qqbot.threadBindings.maxAgeHours` 和 `channels.qqbot.threadBindings.spawnSubagentSessions`。

快速流程：

1. 使用 `thread: true`（可选 `mode: "session"`）通过 `sessions_spawn` 派生。
2. CrawClaw 在活跃渠道中创建或绑定一个线程到该会话目标。
3. 该线程中的回复和后续消息路由到绑定的会话。
4. 使用 `/session idle` 检查/更新 inactivity 自动失焦，使用 `/session max-age` 控制硬性上限。
5. 使用 `/unfocus` 手动解除绑定。

手动控制：

- `/focus <target>` 将当前线程（或创建一个）绑定到子智能体/会话目标。
- `/unfocus` 移除当前绑定线程的绑定。
- `/agents` 列出活跃运行和绑定状态（`thread:<id>` 或 `unbound`）。
- `/session idle` 和 `/session max-age` 仅对焦绑定线程有效。

配置开关：

- 全局默认值：`session.threadBindings.enabled`、`session.threadBindings.idleHours`、`session.threadBindings.maxAgeHours`
- 渠道覆盖和派生自动绑定键是适配器特定的。参见上面的**支持线程的渠道**。

参见[配置参考](/gateway/configuration-reference)和[斜杠命令](/tools/slash-commands)了解当前适配器详情。

白名单：

- `agents.list[].subagents.allowAgents`：可通过 `agentId` 定位的 agent ID 列表（`["*"]` 允许任意）。默认值：仅请求方 agent。
- `agents.defaults.subagents.requireAgentId` / `agents.list[].subagents.requireAgentId`：为 true 时，阻止省略 `agentId` 的 `sessions_spawn` 调用（强制显式配置选择）。默认值：false。

目标发现：

- 当 `agentId` 为必需、无效或不允许时，`sessions_spawn` 返回当前允许的目标 agent ID。

自动归档：

- 子智能体会话在 `agents.defaults.subagents.archiveAfterMinutes`（默认：60）后自动归档。
- 此自动归档路径仅用于清理已完成的子智能体会话。它使用 `sessions.delete` 并将记录重命名为 `*.deleted.<timestamp>`（同一文件夹）。
- 不要将 `sessions.delete` 当作用户聊天归档命令；它会删除会话存储条目，不会运行最终的记忆、梦境或经验维护流程。
- `cleanup: "delete"` 在 announcement 后立即归档（仍通过重命名保留记录）。
- 自动归档是尽力而为的；如果网关重启，待处理计时器会丢失。
- `runTimeoutSeconds` **不会**自动归档；它只会停止运行。会话保持不变，直到自动归档。
- 自动归档同样适用于深度 1 和深度 2 会话。

## 嵌套子智能体

默认情况下，子智能体不能派生自己的子智能体（`maxSpawnDepth: 1`）。你可以通过设置 `maxSpawnDepth: 2` 来启用一级嵌套，这允许**编排器模式**：主智能体 → 编排器子智能体 → 工作子子智能体。

### 如何启用

```json5
{
  agents: {
    defaults: {
      subagents: {
        maxSpawnDepth: 2, // 允许子智能体派生子级（默认：1）
        maxChildrenPerAgent: 5, // 每个 agent 会话最大活跃子级数（默认：5）
        maxConcurrent: 8, // 全局并发通道上限（默认：8）
        runTimeoutSeconds: 900, // 省略时 sessions_spawn 的默认超时（0 = 无超时）
      },
    },
  },
}
```

### 深度级别

| 深度 | 会话键形状                                   | 角色                              | 可以派生？                |
| ---- | -------------------------------------------- | --------------------------------- | ------------------------- |
| 0    | `agent:<id>:main`                            | 主智能体                          | 始终可以                  |
| 1    | `agent:<id>:subagent:<uuid>`                 | 子智能体（启用深度 2 时为编排器） | 仅当 `maxSpawnDepth >= 2` |
| 2    | `agent:<id>:subagent:<uuid>:subagent:<uuid>` | 子子智能体（叶子工作器）          | 永远不行                  |

### Announcement 链

结果沿链向上回传：

1. 深度 2 工作器完成 → 向其父级（深度 1 编排器）发送 announcement
2. 深度 1 编排器接收 announcement，综合结果，完成 → 向主智能体发送 announcement
3. 主智能体接收 announcement 并向用户投递

每一层只能看到其直接子级的 announcement。

### 按深度的工具策略

- 角色和控制范围在派生时写入会话元数据。这可以防止扁平化或恢复的会话键意外重新获得编排器权限。
- **深度 1（编排器，当 `maxSpawnDepth >= 2` 时）**：获取 `sessions_spawn`、`subagents`、`sessions_list`、`sessions_history`，以便管理其子级。其他会话/系统工具保持拒绝状态。
- **深度 1（叶子，当 `maxSpawnDepth == 1` 时）**：无会话工具（当前默认行为）。
- **深度 2（叶子工作器）**：无会话工具 — `sessions_spawn` 在深度 2 始终被拒绝。无法派生更多子级。

### 每个 agent 的派生限制

每个 agent 会话（在任何深度）同时最多可以有 `maxChildrenPerAgent`（默认：5）个活跃子级。这可以防止单个编排器失控扇出。

### 级联停止

停止深度 1 编排器会自动停止其所有深度 2 子级：

- 主聊天中的 `/stop` 停止所有深度 1 agent，并级联到其深度 2 子级。
- `/subagents kill <id>` 停止特定子智能体，并级联到其子级。
- `/subagents kill all` 停止请求方的所有子智能体，并级联。

## 认证

子智能体认证按 **agent ID** 解析，而非会话类型：

- 子智能体会话键为 `agent:<agentId>:subagent:<uuid>`。
- 认证存储从该 agent 的 `agentDir` 加载。
- 主智能体的认证配置作为**后备**合并；agent 配置在冲突时覆盖主配置。

注意：合并是累加的，因此主配置始终作为后备可用。尚不支持完全隔离的每个 agent 认证。

## Announcement

子智能体通过 announcement 步骤报告回来：

- announcement 步骤在子智能体会话中运行（而非请求方会话）。
- 如果子智能体恰好回复 `ANNOUNCE_SKIP`，则不发布任何内容。
- 否则投递取决于请求方深度：
  - 顶级请求方会话使用后续 `agent` 调用进行外部投递（`deliver=true`）
  - 嵌套请求方子智能体会话接收内部后续注入（`deliver=false`），以便编排器可以在会话内综合子结果
  - 如果嵌套请求方子智能体会话已消失，CrawClaw 会回退到该会话的请求方（如果有）
- 构建嵌套完成发现时，子完成聚合的作用域限定在当前请求方运行，防止过时的先前运行子输出泄漏到当前 announcement 中。
- Announcement 回复在渠道适配器支持时保留线程/主题路由。
- Announcement 上下文规范化为稳定的内部事件块：
  - source（`subagent` 或 `cron`）
  - 子会话键/ID
  - announcement 类型 + 任务标签
  - 从运行时结果派生的状态行（`success`、`error`、`timeout` 或 `unknown`）
  - announcement 步骤的结果内容（如果缺失则为 `(no output)`）
  - 描述何时回复何时保持沉默的后续指令
- `Status` 不从模型输出推断；它来自运行时结果信号。

Announcement 有效载荷末尾包含统计行（即使被包装）：

- 运行时（例如 `runtime 5m12s`）
- Token 使用量（输入/输出/总计）
- 配置了模型定价时的估计成本（`models.providers.*.models[].cost`）
- `sessionKey`、`sessionId` 和记录路径（以便主智能体可以通过 `sessions_history` 获取历史或在磁盘上检查文件）
- 内部元数据仅用于编排；面向用户的回复应该用正常的 assistant 语气重写。

对于基于任务的运行，announcement 投递也会更新任务运行时状态和持久化的轨迹/完成记录。

## 工具策略（子智能体工具）

默认情况下，子智能体**不会**获取这些会话/控制工具：

- `sessions_list`
- `sessions_history`
- `sessions_send`
- `sessions_spawn`

当 `maxSpawnDepth >= 2` 时，深度 1 编排器子智能体可以额外获取 `sessions_spawn`、`subagents`、`sessions_list` 和 `sessions_history`，以便管理其子级。

通过配置覆盖：

```json5
{
  agents: {
    defaults: {
      subagents: {
        maxConcurrent: 1,
      },
    },
  },
  tools: {
    subagents: {
      tools: {
        // deny 优先
        deny: ["gateway", "cron"],
        // 如果设置了 allow，则变为仅允许模式（deny 仍优先）
        // allow: ["read", "exec", "process"]
      },
    },
  },
}
```

## 并发

子智能体使用专用的进程内队列通道：

- 通道名称：`subagent`
- 并发数：`agents.defaults.subagents.maxConcurrent`（默认 `8`）

## 停止

- 在请求方聊天中发送 `/stop` 会中止请求方会话并停止从其派生的任何活跃子智能体运行，级联到嵌套子级。
- `/subagents kill <id>` 停止特定子智能体，并级联到其子级。

## 限制

- 子智能体 announcement 是**尽力而为**的。如果网关重启，待处理的"回报"工作会丢失。
- 子智能体仍共享同一网关进程资源；将 `maxConcurrent` 视为安全阀。
- `sessions_spawn` 始终是非阻塞的：它立即返回 `{ status: "accepted", runId, childSessionKey }`。
- 子智能体上下文仅注入 `AGENTS.md` + `TOOLS.md`（不包含 `SOUL.md`、`IDENTITY.md`、`USER.md`、`HEARTBEAT.md` 或 `BOOTSTRAP.md`）。
- 最大嵌套深度为 5（`maxSpawnDepth` 范围：1–5）。大多数用例建议深度 2。
- `maxChildrenPerAgent` 限制每个会话的活跃子级数（默认：5，范围：1–20）。
