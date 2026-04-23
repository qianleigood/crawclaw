---
read_when:
  - 你想通过智能体执行后台/并行工作
  - 你正在更改 sessions_spawn 或子智能体工具策略
summary: 子智能体：生成隔离的智能体运行，并将结果通告回请求者聊天
title: 子智能体
x-i18n:
  generated_at: "2026-02-03T10:12:07Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 3c83eeed69a65dbbb6b21a386f3ac363d3ef8f077f0e03b834c3f0a9911dca7c
  source_path: tools/subagents.md
  workflow: 15
---

# 子智能体

子智能体是从现有智能体运行中生成的后台智能体运行。它们在自己的会话中运行（`agent:<agentId>:subagent:<uuid>`），完成后将结果**通告**回请求者的聊天渠道。

task-backed 子智能体运行现在还会持久化：

- 会话 transcript
- task runtime metadata
- 包含 completion evidence 和 completion guard 结果的 task trajectory

## 上下文与记忆边界

子智能体是隔离运行，但不是所有状态都完全断开：

- 它会启动一个新的 CrawClaw session，**不会**继承父会话的完整 transcript。
- 它拿到的是子任务 prompt 和 lineage 元数据（`requesterSessionKey`、来源渠道、父子关系等）。
- Session memory 按子会话自己的 `sessionId` 隔离。
- Durable memory 只要父子运行命中同一个 `agentId + channel + userId` scope，就仍然共享。
- NotebookLM knowledge recall 会在子运行自己的 prompt assembly 阶段查询同一个 backend，不按 session id 隔离。
- 同一 agent 下的 spawn 默认继承调用者 workspace；跨 agent spawn 会切到目标 agent 自己的 workspace。

子运行结束后，可通过 `crawclaw agent inspect`、`crawclaw agent export-context`
和 `crawclaw agents status` 查看 runtime/task/trajectory/archive 状态。

## 斜杠命令

使用 `/subagents` 检查或控制**当前会话**的子智能体运行：

- `/subagents list`
- `/subagents kill <id|#|all>`
- `/subagents log <id|#> [limit] [tools]`
- `/subagents info <id|#>`
- `/subagents send <id|#> <message>`
- `/subagents steer <id|#> <message>`
- `/subagents spawn <agentId> <task> [--model <model>] [--thinking <level>]`

`/subagents info` 显示运行元数据（状态、时间戳、会话 id、转录路径、清理）。
对 task-backed run，还可以继续追到对应 task metadata 和 trajectory 路径。

### 启动行为

`/subagents spawn` 以用户命令方式启动后台子智能体，任务完成后会向请求者聊天频道回发一条最终完成消息。

- 该命令非阻塞，先返回 `runId`。
- 完成后，子智能体会将汇总/结果消息发布到请求者聊天渠道。
- `--model` 与 `--thinking` 可仅对本次运行做覆盖设置。
- 可在完成后通过 `info`/`log` 查看详细信息和输出。
- completion evidence 和 completion guard 结果会写入 task trajectory，因此
  后台运行完成后可以直接审计，不必重放完整聊天记录。
- Context Archive 还可以进一步保存模型可见上下文、tool 决策和 post-turn
  状态，因此 replay/debug 不必把 transcript 当成唯一真相源。

主要目标：

- 并行化"研究 / 长任务 / 慢工具"工作，而不阻塞主运行。
- 默认保持子智能体隔离（会话分离 + 可选沙箱隔离）。
- 保持工具接口难以滥用：子智能体默认**不**获得会话工具。
- 默认避免嵌套扇出；只有显式把 `maxSpawnDepth` 提升到 `2` 时，才允许一层 orchestrator → worker 嵌套。

成本说明：每个子智能体都有**自己的**上下文和 token 使用量。对于繁重或重复的任务，为子智能体设置更便宜的模型，而让主智能体使用更高质量的模型。你可以通过 `agents.defaults.subagents.model` 或每智能体覆盖来配置。

## 工具

使用 `sessions_spawn`：

- 启动子智能体运行（`deliver: false`，全局队列：`subagent`）
- 然后运行通告步骤，并将通告回复发布到请求者的聊天渠道
- 默认模型：继承调用者，除非你设置了 `agents.defaults.subagents.model`（或每智能体的 `agents.list[].subagents.model`）；显式的 `sessions_spawn.model` 仍然优先。
- 默认思考：继承调用者，除非你设置了 `agents.defaults.subagents.thinking`（或每智能体的 `agents.list[].subagents.thinking`）；显式的 `sessions_spawn.thinking` 仍然优先。
- `/subagents spawn` 是一次性 `mode: "run"`；持久 thread-bound 子会话请用
  `sessions_spawn` 配合 `thread: true` 和 `mode: "session"`。
- 如果你想跑 Codex / Claude Code / Gemini CLI 之类的 harness，请改用
  `sessions_spawn({ runtime: "acp" })`，参见 [ACP Agents](/tools/acp-agents)。

工具参数：

- `task`（必需）
- `label?`（可选）
- `agentId?`（可选；如果允许，在另一个智能体 id 下生成）
- `model?`（可选；覆盖子智能体模型；无效值会被跳过，子智能体将使用默认模型运行并在工具结果中显示警告）
- `thinking?`（可选；覆盖子智能体运行的思考级别）
- `runTimeoutSeconds?`（省略时优先取 `agents.defaults.subagents.runTimeoutSeconds`，否则回退到 `0`，即无超时）
- `thread?`（默认 `false`；为该子智能体请求 thread binding）
- `mode?`（`run|session`；当 `thread: true` 且未显式设置时，会默认变成 `session`）
- `cleanup?`（`delete|keep`，默认 `keep`）
- `sandbox?`（`inherit|require`，默认 `inherit`；`require` 会在目标运行时不是 sandboxed 时拒绝 spawn）

额外约束：

- `mode: "session"` 必须和 `thread: true` 一起使用。
- `sessions_spawn` 不接受 channel-delivery 参数（`target`、`channel`、`to`、`threadId`、`replyTo`、`transport`）；要投递消息，请在子运行内部使用 `message` 或 `sessions_send`。

## 线程绑定会话

当渠道支持 thread bindings 时，子智能体可以和一个线程长期绑定，使后续同线程消息持续路由到同一个子会话。

快速流程：

1. 用 `sessions_spawn` 搭配 `thread: true`
2. CrawClaw 创建或绑定一个线程到目标子会话
3. 后续这个线程里的消息继续路由到同一会话
4. 用 `/session idle` 或 `/session max-age` 调整自动解绑策略
5. 用 `/unfocus` 手动解除绑定

当前内置支持：

- Discord（线程绑定 + `/focus` / `/unfocus` / `/agents` / `/session idle` / `/session max-age`）

## 允许列表与保护

- `agents.list[].subagents.allowAgents`：允许通过 `agentId` 定向到哪些 agent（`["*"]` 表示允许任意）
- 如果请求者会话本身处于 sandbox 中，`sessions_spawn` 会拒绝那些会跑到 unsandboxed 目标上的请求
- `agents.defaults.subagents.requireAgentId` / `agents.list[].subagents.requireAgentId` 为 `true` 时，未显式提供 `agentId` 的 `sessions_spawn` 会被拒绝

可用目标可通过 `agents_list` 查看。

自动归档：

- 子智能体会话在 `agents.defaults.subagents.archiveAfterMinutes` 后自动归档（默认：60）。
- 这条自动归档路径只用于已完成子智能体会话的清理。它使用 `sessions.delete`，并将转录重命名为 `*.deleted.<timestamp>`（同一文件夹）。
- 不要把 `sessions.delete` 当成用户聊天归档命令；它会移除 session store 条目，也不会额外执行最终的 memory、dream 或经验维护。
- `cleanup: "delete"` 在通告后立即归档（仍通过重命名保留转录）。
- 自动归档是尽力而为的；如果 Gateway 网关重启，待处理的定时器会丢失。
- `runTimeoutSeconds` **不会**自动归档；它只停止运行。会话会保留直到自动归档。
- 自动归档同样适用于 depth-1 和 depth-2 的子会话。

## 嵌套子智能体

默认情况下，子智能体不能继续创建自己的子智能体（`maxSpawnDepth: 1`）。把它提升到 `2` 后，才允许一层 orchestrator -> worker 结构。

深度语义：

- `0`：主 agent（总是可 spawn）
- `1`：普通 subagent；只有在 `maxSpawnDepth >= 2` 时才允许继续 spawn
- `2`：叶子 worker；永远不能继续 spawn

工具策略：

- depth 1 的 orchestrator 可以拿到有限的 session 管理工具（例如 `sessions_spawn`、`subagents`、`sessions_list`、`sessions_history`）
- depth 1 的 leaf 和 depth 2 的 worker 都不能再拿到会继续扩张 fan-out 的 session 工具

## 认证

子智能体认证按**智能体 id** 解析，而不是按会话类型：

- 子智能体会话键是 `agent:<agentId>:subagent:<uuid>`。
- 认证存储从该智能体的 `agentDir` 加载。
- 主智能体的认证配置文件作为**回退**合并；智能体配置文件在冲突时覆盖主配置文件。

注意：合并是累加的，所以主配置文件始终可用作回退。目前尚不支持每智能体完全隔离的认证。

## 通告

子智能体通过通告步骤报告：

- 通告步骤在子智能体会话中运行（不是请求者会话）。
- 如果子智能体精确回复 `ANNOUNCE_SKIP`，则不发布任何内容。
- 否则，通告回复通过后续的 `agent` 调用（`deliver=true`）发布到请求者的聊天渠道。
- 通告回复在可用时保留线程/话题路由（Slack 线程、Telegram 话题、Matrix 线程）。
- 通告消息被规范化为稳定模板：
  - `Status:` 从运行结果派生（`success`、`error`、`timeout` 或 `unknown`）。
  - `Result:` 通告步骤的摘要内容（如果缺失则为 `(not available)`）。
  - `Notes:` 错误详情和其他有用的上下文。
- `Status` 不是从模型输出推断的；它来自运行时结果信号。

通告负载在末尾包含统计行（即使被包装）：

- 运行时间（例如 `runtime 5m12s`）
- Token 使用量（输入/输出/总计）
- 配置模型定价时的估计成本（`models.providers.*.models[].cost`）
- `sessionKey`、`sessionId` 和转录路径（以便主智能体可以通过 `sessions_history` 获取历史记录或检查磁盘上的文件）

对于 task-backed run，announce 完成后还会同步更新 task runtime state 和
持久化的 trajectory / completion 记录。

## 工具策略（子智能体工具）

默认情况下，子智能体**不会**获得这些会话/控制类工具：

- `sessions_list`
- `sessions_history`
- `sessions_send`
- `sessions_spawn`

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
        // 如果设置了 allow，则变为仅允许模式（deny 仍然优先）
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

- 在请求者聊天中发送 `/stop` 会中止请求者会话并停止从中生成的任何活动子智能体运行。

## 限制

- 子智能体通告是**尽力而为**的。如果 Gateway 网关重启，待处理的"通告回复"工作会丢失。
- 子智能体仍然共享相同的 Gateway 网关进程资源；将 `maxConcurrent` 视为安全阀。
- `sessions_spawn` 始终是非阻塞的：它立即返回 `{ status: "accepted", runId, childSessionKey }`。
- 子智能体上下文仅注入 `AGENTS.md` + `TOOLS.md`（无 `SOUL.md`、`IDENTITY.md`、`USER.md`、`HEARTBEAT.md` 或 `BOOTSTRAP.md`）。
