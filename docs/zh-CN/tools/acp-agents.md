---
summary: "使用 ACP runtime sessions 运行 Codex、Claude Code、Cursor、Gemini CLI、CrawClaw ACP 和其他 harness agents"
x-i18n:
  generated_at: "2026-06-10T12:33:42Z"
  model: codex
  provider: openai
  source_hash: ce6a75c084be7ac015caadda60912f2ee171f903d4f7fbbf118480497593db05
  source_path: tools/acp-agents.md
  workflow: 15
title: "ACP 智能体"
---

# ACP 智能体

[Agent Client Protocol (ACP)](https://agentclientprotocol.com/) sessions 让 CrawClaw 可以通过 ACP backend plugin 运行外部 coding harnesses，例如 Claude Code、Codex、Cursor、Copilot、CrawClaw ACP、OpenCode、Gemini CLI 和其他受支持的 ACPX harnesses。

如果你用自然语言让 CrawClaw “在 Codex 里运行这个”或“在线程里启动 Claude Code”，CrawClaw 应该把请求路由到 ACP runtime，而不是 native sub-agent runtime。每个 ACP session spawn 都会被跟踪为一个 [background task](/automation/tasks)。

Task-backed ACP runs 现在会持久化：

- ACP wrapper session transcript
- task runtime metadata
- 带 completion evidence 和 completion-guard output 的 task trajectory

## Context and memory boundaries

从 CrawClaw 的视角看，ACP runs 是 task-backed，但它们的 internal runtime 仍由 ACP backend 拥有。

- CrawClaw 为 ACP run 持久化 wrapper session、task metadata、trajectory，以及 guard / loop / completion state。
- Follow-up messages 可以继续绑定到同一个 ACP session key 和 backend workspace。
- Harness 的 internal transcript、memory model 和 tool state 属于 backend concern，不属于 CrawClaw built-in memory runtime。
- CrawClaw Desktop、Gateway API inspection 和 background-task views 展示的是 CrawClaw-side wrapper/task/archive state，而不是 harness 私有的 internal buffers。

如果你希望 Codex 或 Claude Code 作为 external MCP client 直接连接到现有 CrawClaw channel conversations，请使用 [Gateway protocol](/gateway/protocol)，而不是 ACP。

## Fast operator flow

当你需要实用的 `/acp` runbook 时使用这个流程：

1. Spawn 一个 session：
   - `/acp spawn codex --bind here`
   - `/acp spawn codex --mode persistent --thread auto`
2. 在绑定的 conversation 或 thread 中工作，也可以显式指定该 session key。
3. 检查 runtime state：
   - `/acp status`
4. 按需调整 runtime options：
   - `/acp model <provider/model>`
   - `/acp permissions <profile>`
   - `/acp timeout <seconds>`
5. 在不替换 context 的情况下推动 active session：
   - `/acp steer tighten logging and continue`
6. 停止工作：
   - `/acp cancel`（停止当前 turn），或
   - `/acp close`（关闭 session 并移除 bindings）

## Quick start for humans

自然语言请求示例：

- "Bind this QQBot channel to Codex."
- "Start a persistent Codex session in a thread here and keep it focused."
- "Run this as a one-shot Claude Code ACP session and summarize the result."
- "Bind this Weixin chat to Codex and keep follow-ups in the same workspace."
- "Use Gemini CLI for this task in a thread, then keep follow-ups in that same thread."

CrawClaw 应执行的动作：

1. 选择 `runtime: "acp"`。
2. 解析请求的 harness target（`agentId`，例如 `codex`）。
3. 如果请求 current-conversation binding 且 active channel 支持它，则把 ACP session 绑定到该 conversation。
4. 否则，如果请求 thread binding 且当前 channel 支持它，则把 ACP session 绑定到 thread。
5. 将后续绑定消息继续路由到同一个 ACP session，直到 unfocused、closed 或 expired。

## ACP versus sub-agents

当你需要 external harness runtime 时使用 ACP。当你需要 CrawClaw-native delegated runs 时使用 sub-agents。

| Area          | ACP session                           | Sub-agent run                     |
| ------------- | ------------------------------------- | --------------------------------- |
| Runtime       | ACP backend plugin（例如 acpx）       | CrawClaw native sub-agent runtime |
| Session key   | `agent:<agentId>:acp:<uuid>`          | `agent:<agentId>:subagent:<uuid>` |
| Main commands | `/acp ...`                            | `/subagents ...`                  |
| Spawn tool    | `sessions_spawn` with `runtime:"acp"` | `sessions_spawn`（默认 runtime）  |

ACP oneshot sessions 仍表示为真实 CrawClaw sessions。它们的 wrapper transcript 会在完成时物化，因此 task metadata、session history 和 replay 都能指向具体的 JSONL transcript。

另见 [Sub-agents](/tools/subagents)。

## Bound sessions

### Current-conversation binds

当你希望当前 conversation 变成 durable ACP workspace、但不创建 child thread 时，使用 `/acp spawn <harness> --bind here`。

Behavior：

- CrawClaw 继续拥有 channel transport、auth、safety 和 delivery。
- 当前 conversation 被 pin 到 spawned ACP session key。
- 该 conversation 中的 follow-up messages 会路由到同一个 ACP session。
- `/new` 会原地 reset bound ACP session。
- `/acp close` 会关闭 session 并移除 current-conversation binding。

实践中的含义：

- `--bind here` 保持同一个 chat surface。在 QQBot 上，当前 channel 仍然是当前 channel。
- 如果你正在 spawn 新工作，`--bind here` 仍可以创建新的 ACP session。该 bind 会把这个 session attach 到当前 conversation。
- `--bind here` 本身不会创建 child QQBot thread 或 Feishu topic。
- ACP runtime 仍可拥有自己的 working directory（`cwd`）或 backend-managed workspace on disk。该 runtime workspace 与 chat surface 分离，并不暗示新的 messaging thread。
- 即便在 `mode: "run"` / oneshot workflows 中，ACP wrapper session 仍会获得 persisted transcript 和 task trajectory，便于 run 完成后审计 completion。

Mental model：

- chat surface：人们继续说话的地方（`QQBot channel`、`Feishu topic`、`Weixin chat`）
- ACP session：CrawClaw 路由到的 durable Codex/Claude/Gemini runtime state
- child thread/topic：仅由 `--thread ...` 创建的可选额外 messaging surface
- runtime workspace：harness 运行所在的 filesystem location（`cwd`、repo checkout、backend workspace）

Examples：

- `/acp spawn codex --bind here`: 保持这个 chat，spawn 或 attach 一个 Codex ACP session，并把未来这里的消息路由给它
- `/acp spawn codex --thread auto`: CrawClaw 可以创建 child thread/topic，并在那里绑定 ACP session
- `/acp spawn codex --bind here --cwd /workspace/repo`: 与上面相同的 chat binding，但 Codex 在 `/workspace/repo` 中运行

Current-conversation binding support：

- 宣告支持 current-conversation binding 的 chat/message channels 可以通过 shared conversation-binding path 使用 `--bind here`。
- 具有自定义 thread/topic 语义的 channels 仍可在同一个 shared interface 后提供 channel-specific canonicalization。
- `--bind here` 始终表示“原地绑定当前 conversation”。
- Generic current-conversation binds 使用 shared CrawClaw binding store，并能跨正常 gateway restarts 保留。

Notes：

- `/acp spawn` 上的 `--bind here` 和 `--thread ...` 互斥。
- 在 QQBot 上，`--bind here` 原地绑定当前 channel 或 thread。只有当 CrawClaw 需要为 `--thread auto|here` 创建 child thread 时，才需要 `spawnAcpSessions`。
- 如果 active channel 不暴露 current-conversation ACP bindings，CrawClaw 会返回清楚的 unsupported message。
- `resume` 和 "new session" 问题是 ACP-session 问题，不是 channel 问题。你可以在不改变当前 chat surface 的情况下复用或替换 runtime state。

### Thread-bound sessions

当某个 channel adapter 启用了 thread bindings 后，ACP sessions 可以绑定到 threads：

- CrawClaw 将 thread 绑定到 target ACP session。
- 该 thread 中的 follow-up messages 路由到 bound ACP session。
- ACP output 回送到同一个 thread。
- Unfocus、close、archive、idle-timeout 或 max-age expiry 会移除 binding。

Thread binding support 是 adapter-specific。如果 active channel adapter 不支持 thread bindings，CrawClaw 会返回清楚的 unsupported/unavailable message。

Thread-bound ACP 所需 feature flags：

- `acp.enabled=true`
- `acp.dispatch.enabled` 默认开启（设置为 `false` 可暂停 ACP dispatch）
- 启用 Channel-adapter ACP thread-spawn flag（adapter-specific）
  - QQBot: `channels.qqbot.threadBindings.spawnAcpSessions=true`
  - Feishu: `channels.feishu.threadBindings.spawnAcpSessions=true`

### Thread supporting channels

- 任何暴露 session/thread binding capability 的 channel adapter。
- 当前 built-in support：
  - QQBot threads/channels
  - Feishu topics（groups/supergroups 中的 forum topics 和 DM topics）
- Plugin channels 可以通过同一个 binding interface 添加支持。

## Channel specific settings

对于 non-ephemeral workflows，在 top-level `bindings[]` entries 中配置 persistent ACP bindings。

### Binding model

- `bindings[].type="acp"` 标记 persistent ACP conversation binding。
- `bindings[].match` 标识 target conversation：
  - QQBot channel 或 thread: `match.channel="qqbot"` + `match.peer.id="<channelOrThreadId>"`
  - Feishu forum topic: `match.channel="feishu"` + `match.peer.id="<chatId>:topic:<topicId>"`
  - Weixin DM/group chat: `match.channel="weixin"` + `match.peer.id="<handle|chat_id:*|chat_guid:*|chat_identifier:*>"`
    对 stable group bindings，优先使用 `chat_id:*` 或 `chat_identifier:*`。
  - Weixin DM/group chat: `match.channel="weixin"` + `match.peer.id="<handle|chat_id:*|chat_guid:*|chat_identifier:*>"`
    对 stable group bindings，优先使用 `chat_id:*`。
- `bindings[].agentId` 是 owning CrawClaw agent id。
- Optional ACP overrides 位于 `bindings[].acp`：
  - `mode`（`persistent` 或 `oneshot`）
  - `label`
  - `cwd`
  - `backend`

### Runtime defaults per agent

使用 `agents.list[].runtime` 为每个 agent 定义一次 ACP defaults：

- `agents.list[].runtime.type="acp"`
- `agents.list[].runtime.acp.agent`（harness id，例如 `codex` 或 `claude`）
- `agents.list[].runtime.acp.backend`
- `agents.list[].runtime.acp.mode`
- `agents.list[].runtime.acp.cwd`

ACP bound sessions 的 override precedence：

1. `bindings[].acp.*`
2. `agents.list[].runtime.acp.*`
3. global ACP defaults（例如 `acp.backend`）

Example：

```json5
{
  agents: {
    list: [
      {
        id: "codex",
        runtime: {
          type: "acp",
          acp: {
            agent: "codex",
            backend: "acpx",
            mode: "persistent",
            cwd: "/workspace/crawclaw",
          },
        },
      },
      {
        id: "claude",
        runtime: {
          type: "acp",
          acp: { agent: "claude", backend: "acpx", mode: "persistent" },
        },
      },
    ],
  },
  bindings: [
    {
      type: "acp",
      agentId: "codex",
      match: {
        channel: "qqbot",
        accountId: "default",
        peer: { kind: "channel", id: "222222222222222222" },
      },
      acp: { label: "codex-main" },
    },
    {
      type: "acp",
      agentId: "claude",
      match: {
        channel: "feishu",
        accountId: "default",
        peer: { kind: "group", id: "-1001234567890:topic:42" },
      },
      acp: { cwd: "/workspace/repo-b" },
    },
    {
      type: "route",
      agentId: "main",
      match: { channel: "qqbot", accountId: "default" },
    },
    {
      type: "route",
      agentId: "main",
      match: { channel: "feishu", accountId: "default" },
    },
  ],
  channels: {
    qqbot: {
      guilds: {
        "111111111111111111": {
          channels: {
            "222222222222222222": { requireMention: false },
          },
        },
      },
    },
    feishu: {
      groups: {
        "-1001234567890": {
          topics: { "42": { requireMention: false } },
        },
      },
    },
  },
}
```

Behavior：

- CrawClaw 会在使用前确保 configured ACP session 存在。
- 该 channel 或 topic 中的 messages 会路由到 configured ACP session。
- 在 bound conversations 中，`/new` 会原地 reset ACP session key。
- Temporary runtime bindings（例如 thread-focus flows 创建的绑定）在存在时仍然适用。

## Start ACP sessions (interfaces)

### From `sessions_spawn`

从 agent turn 或 tool call 启动 ACP session 时，使用 `runtime: "acp"`。

```json
{
  "task": "Open the repo and summarize failing tests",
  "runtime": "acp",
  "agentId": "codex",
  "thread": true,
  "mode": "session"
}
```

Notes：

- `runtime` 默认是 `subagent`，因此 ACP sessions 必须显式设置 `runtime: "acp"`。
- 如果省略 `agentId`，CrawClaw 会在配置了 `acp.defaultAgent` 时使用它。
- `mode: "session"` 需要 `thread: true` 才能保持 persistent bound conversation。

Interface details：

- `task`（required）：发送给 ACP session 的 initial prompt。
- `runtime`（ACP required）：必须是 `"acp"`。
- `agentId`（optional）：ACP target harness id。如果已设置，则 fallback 到 `acp.defaultAgent`。
- `thread`（optional，默认 `false`）：在支持时请求 thread binding flow。
- `mode`（optional）：`run`（one-shot）或 `session`（persistent）。
  - 默认是 `run`
  - 如果 `thread: true` 且省略 mode，CrawClaw 可以按 runtime path 默认采用 persistent behavior
  - `mode: "session"` 需要 `thread: true`
- `cwd`（optional）：请求的 runtime working directory（由 backend/runtime policy 校验）。
- `label`（optional）：用于 session/banner text 的 operator-facing label。
- `resumeSessionId`（optional）：resume 一个现有 ACP session，而不是创建新的。Agent 通过 `session/load` replay conversation history。需要 `runtime: "acp"`。
- `streamTo`（optional）：`"parent"` 会将 initial ACP run progress summaries 作为 system events stream 回 requester session。
  - 可用时，accepted responses 会包含 `streamLogPath`，指向 session-scoped JSONL log（`<sessionId>.acp-stream.jsonl`），你可以 tail 它查看完整 relay history。

### Resume an existing session

使用 `resumeSessionId` 继续以前的 ACP session，而不是 fresh start。Agent 通过 `session/load` replay conversation history，因此会带着之前的完整 context 继续。

```json
{
  "task": "Continue where we left off — fix the remaining test failures",
  "runtime": "acp",
  "agentId": "codex",
  "resumeSessionId": "<previous-session-id>"
}
```

Common use cases：

- 把 Codex session 从 laptop hand off 到 phone，让 agent 从离开的地方继续
- 继续你在 CLI 中交互式启动的 coding session，现在通过 agent headlessly 运行
- 接续因 gateway restart 或 idle timeout 中断的工作

Notes：

- `resumeSessionId` 需要 `runtime: "acp"`，如果与 sub-agent runtime 一起使用会返回错误。
- `resumeSessionId` 会恢复 upstream ACP conversation history；`thread` 和 `mode` 仍正常作用于你正在创建的新 CrawClaw session，因此 `mode: "session"` 仍需要 `thread: true`。
- Target agent 必须支持 `session/load`（Codex 和 Claude Code 支持）。
- 如果找不到 session ID，spawn 会以 clear error 失败，不会 silently fallback 到新 session。

### Operator smoke test

Gateway deploy 后，如果你想快速 live check ACP spawn 是否真的 end-to-end 工作，而不只是 unit tests 通过，请使用此流程。

Recommended gate：

1. 在 target host 上验证 deployed gateway version/commit。
2. 确认 deployed source 在 Rust Gateway session handlers 中包含 ACP lineage acceptance（`subagent:*` 或 `acp:*` sessions）。
3. 打开临时 ACPX bridge session 到 live agent（例如 `jpclawhq` 上的 `razor(main)`）。
4. 让该 agent 调用 `sessions_spawn`，参数为：
   - `runtime: "acp"`
   - `agentId: "codex"`
   - `mode: "run"`
   - task: `Reply with exactly LIVE-ACP-SPAWN-OK`
5. 验证 agent 报告：
   - `accepted=yes`
   - 真实 `childSessionKey`
   - 没有 validator error
6. 清理临时 ACPX bridge session。

给 live agent 的 example prompt：

```text
Use the sessions_spawn tool now with runtime: "acp", agentId: "codex", and mode: "run".
Set the task to: "Reply with exactly LIVE-ACP-SPAWN-OK".
Then report only: accepted=<yes/no>; childSessionKey=<value or none>; error=<exact text or none>.
```

Notes：

- 除非你有意测试 thread-bound persistent ACP sessions，否则保持这个 smoke test 使用 `mode: "run"`。
- Basic gate 不要求 `streamTo: "parent"`。该路径依赖 requester/session capabilities，是独立的 integration check。
- 将 thread-bound `mode: "session"` 测试作为来自真实 QQBot thread 或 Feishu topic 的第二轮、更完整 integration pass。

Current limitations：

### From `/acp` command

需要从 chat 显式 operator control 时，使用 `/acp spawn`。

```text
/acp spawn codex --mode persistent --thread auto
/acp spawn codex --mode oneshot --thread off
/acp spawn codex --bind here
/acp spawn codex --thread here
```

Key flags：

- `--mode persistent|oneshot`
- `--bind here|off`
- `--thread auto|here|off`
- `--cwd <absolute-path>`
- `--label <name>`

参见 [Slash Commands](/tools/slash-commands)。

## Session target resolution

大多数 `/acp` actions 接受 optional session target（`session-key`、`session-id` 或 `session-label`）。

Resolution order：

1. Explicit target argument（或 `/acp steer` 的 `--session`）
   - 先尝试 key
   - 然后尝试 UUID-shaped session id
   - 然后尝试 label
2. Current thread binding（如果这个 conversation/thread 绑定到 ACP session）
3. Current requester session fallback

Current-conversation bindings 和 thread bindings 都参与第 2 步。

如果没有 target resolves，CrawClaw 返回 clear error（`Unable to resolve session target: ...`）。

## Spawn bind modes

`/acp spawn` 支持 `--bind here|off`。

| Mode   | Behavior                                           |
| ------ | -------------------------------------------------- |
| `here` | 原地绑定当前 active conversation；如果没有则失败。 |
| `off`  | 不创建 current-conversation binding。              |

Notes：

- 对“让这个 channel 或 chat 由 Codex backing”来说，`--bind here` 是最简单的 operator path。
- `--bind here` 不创建 child thread。
- `--bind here` 仅在暴露 current-conversation binding support 的 channels 上可用。
- 同一个 `/acp spawn` 调用中不能组合 `--bind` 和 `--thread`。

## Spawn thread modes

`/acp spawn` 支持 `--thread auto|here|off`。

| Mode   | Behavior                                                                       |
| ------ | ------------------------------------------------------------------------------ |
| `auto` | 在 active thread 中：绑定该 thread。thread 外：支持时创建并绑定 child thread。 |
| `here` | 要求当前 active thread；如果不在线程中则失败。                                 |
| `off`  | 不绑定。Session starts unbound。                                               |

Notes：

- 在 non-thread binding surfaces 上，默认行为实际上是 `off`。
- Thread-bound spawn 需要 channel policy support：
  - QQBot: `channels.qqbot.threadBindings.spawnAcpSessions=true`
  - Feishu: `channels.feishu.threadBindings.spawnAcpSessions=true`
- 当你想 pin 当前 conversation 而不创建 child thread 时，使用 `--bind here`。

## ACP controls

Available command family：

- `/acp spawn`
- `/acp cancel`
- `/acp steer`
- `/acp close`
- `/acp status`
- `/acp set-mode`
- `/acp set`
- `/acp cwd`
- `/acp permissions`
- `/acp timeout`
- `/acp model`
- `/acp reset-options`
- `/acp sessions`
- `/acp doctor`
- `/acp install`

`/acp status` 会展示 effective runtime options，并在可用时同时展示 runtime-level 和 backend-level session identifiers。

部分 controls 依赖 backend capabilities。如果某个 backend 不支持某个 control，CrawClaw 会返回清楚的 unsupported-control error。

## ACP command cookbook

| Command              | What it does                                               | Example                                                       |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `/acp spawn`         | 创建 ACP session；可选 current bind 或 thread bind。       | `/acp spawn codex --bind here --cwd /repo`                    |
| `/acp cancel`        | 取消 target session 的 in-flight turn。                    | `/acp cancel agent:codex:acp:<uuid>`                          |
| `/acp steer`         | 向 running session 发送 steer instruction。                | `/acp steer --session support inbox prioritize failing tests` |
| `/acp close`         | 关闭 session 并 unbind thread targets。                    | `/acp close`                                                  |
| `/acp status`        | 展示 backend、mode、state、runtime options、capabilities。 | `/acp status`                                                 |
| `/acp set-mode`      | 设置 target session 的 runtime mode。                      | `/acp set-mode plan`                                          |
| `/acp set`           | 写入 generic runtime config option。                       | `/acp set model openai/gpt-5.2`                               |
| `/acp cwd`           | 设置 runtime working directory override。                  | `/acp cwd /Users/user/Projects/repo`                          |
| `/acp permissions`   | 设置 approval policy profile。                             | `/acp permissions strict`                                     |
| `/acp timeout`       | 设置 runtime timeout（seconds）。                          | `/acp timeout 120`                                            |
| `/acp model`         | 设置 runtime model override。                              | `/acp model anthropic/claude-opus-4-6`                        |
| `/acp reset-options` | 移除 session runtime option overrides。                    | `/acp reset-options`                                          |
| `/acp sessions`      | 从 store 列出 recent ACP sessions。                        | `/acp sessions`                                               |
| `/acp doctor`        | Backend health、capabilities、actionable fixes。           | `/acp doctor`                                                 |
| `/acp install`       | 打印 deterministic install 和 enable steps。               | `/acp install`                                                |

`/acp sessions` 会读取当前 bound 或 requester session 的 store。接受 `session-key`、`session-id` 或 `session-label` tokens 的 commands 会通过 gateway session discovery 解析 targets，包括 custom per-agent `session.store` roots。

## Runtime options mapping

`/acp` 有 convenience commands 和 generic setter。

Equivalent operations：

- `/acp model <id>` 映射到 runtime config key `model`。
- `/acp permissions <profile>` 映射到 runtime config key `approval_policy`。
- `/acp timeout <seconds>` 映射到 runtime config key `timeout`。
- `/acp cwd <path>` 直接更新 runtime cwd override。
- `/acp set <key> <value>` 是 generic path。
  - Special case：`key=cwd` 使用 cwd override path。
- `/acp reset-options` 清除 target session 的所有 runtime overrides。

## acpx harness support (current)

当前 acpx built-in harness aliases：

- `claude`
- `codex`
- `copilot`
- `cursor`（Cursor CLI: `cursor-agent acp`）
- `droid`
- `gemini`
- `iflow`
- `kilocode`
- `kimi`
- `kiro`
- `crawclaw`
- `opencode`
- `pi`
- `qwen`

CrawClaw 使用 acpx backend 时，除非你的 acpx config 定义了 custom agent aliases，否则优先使用这些值作为 `agentId`。
如果你的 local Cursor install 仍将 ACP 暴露为 `agent acp`，请在 acpx config 中 override `cursor` agent command，而不是修改 built-in default。

Direct acpx CLI usage 也可以通过 `--agent <command>` 指向任意 adapters，但这个 raw escape hatch 是 acpx CLI feature，不是正常的 CrawClaw `agentId` path。

## Required config

Core ACP baseline：

```json5
{
  acp: {
    enabled: true,
    // Optional. Default is true; set false to pause ACP dispatch while keeping /acp controls.
    dispatch: { enabled: true },
    backend: "acpx",
    defaultAgent: "codex",
    allowedAgents: [
      "claude",
      "codex",
      "copilot",
      "cursor",
      "droid",
      "gemini",
      "iflow",
      "kilocode",
      "kimi",
      "kiro",
      "crawclaw",
      "opencode",
      "pi",
      "qwen",
    ],
    maxConcurrentSessions: 8,
    stream: {
      coalesceIdleMs: 300,
      maxChunkChars: 1200,
    },
    runtime: {
      ttlMinutes: 120,
    },
  },
}
```

Thread binding config 是 channel-adapter specific。QQBot 示例：

```json5
{
  session: {
    threadBindings: {
      enabled: true,
      idleHours: 24,
      maxAgeHours: 0,
    },
  },
  channels: {
    qqbot: {
      threadBindings: {
        enabled: true,
        spawnAcpSessions: true,
      },
    },
  },
}
```

如果 thread-bound ACP spawn 不工作，先验证 adapter feature flag：

- QQBot: `channels.qqbot.threadBindings.spawnAcpSessions=true`

Current-conversation binds 不需要 child-thread creation。它们需要 active conversation context 和一个暴露 ACP conversation bindings 的 channel adapter。

参见 [Configuration Reference](/gateway/configuration-reference)。

## Plugin setup for acpx backend

Install and enable plugin：

使用 CrawClaw Desktop 做交互式设置，或调用 local Gateway API 自动化。

Local workspace install during development：

使用 CrawClaw Desktop 做交互式设置，或调用 local Gateway API 自动化。

然后验证 backend health：

```text
/acp doctor
```

### acpx command and version configuration

默认情况下，bundled acpx backend plugin（`acpx`）使用 plugin-local pinned binary：

1. Command 默认指向 ACPX plugin package 内 plugin-local `node_modules/.bin/acpx`。
2. Expected version 默认使用 extension pin。
3. Startup 立即将 ACP backend 注册为 not-ready。
4. Background ensure job 验证 `acpx --version`。
5. 如果 plugin-local binary 缺失或不匹配，它会运行：
   `npm install --omit=dev --no-save acpx@<pinned>` 并重新验证。

你可以在 plugin config 中 override command/version：

```json
{
  "plugins": {
    "entries": {
      "acpx": {
        "enabled": true,
        "config": {
          "command": "../acpx/dist/cli.js",
          "expectedVersion": "any"
        }
      }
    }
  }
}
```

Notes：

- `command` 接受 absolute path、relative path 或 command name（`acpx`）。
- Relative paths 从 CrawClaw workspace directory 解析。
- `expectedVersion: "any"` 会禁用 strict version matching。
- 当 `command` 指向 custom binary/path 时，plugin-local auto-install 会被禁用。
- CrawClaw startup 在 backend health check 运行时保持 non-blocking。

参见 [Plugins](/tools/plugin)。

### Automatic dependency install

当 CrawClaw Desktop bundles ACP support 时，acpx runtime dependencies（platform-specific binaries）会通过 postinstall hook 自动安装。如果自动安装失败，gateway 仍会正常启动，并通过 CrawClaw Desktop 或 local Gateway API 报告缺失 dependency。

### Plugin tools MCP bridge

默认情况下，ACPX sessions **不会** 向 ACP harness 暴露 CrawClaw plugin-registered tools。

如果你希望 Codex 或 Claude Code 等 ACP agents 调用已安装的 CrawClaw plugin tools，例如 memory recall/store，请启用 dedicated bridge：

使用 CrawClaw Desktop 做交互式设置，或调用 local Gateway API 自动化。

Plugin-owned tool execution 已从 TypeScript runtime 移除。对 CrawClaw-owned operations 使用 Rust Gateway API。

Security and trust notes：

- 这会扩大 ACP harness tool surface。
- ACP agents 只能访问 gateway 中已经 active 的 plugin tools。
- 将其视为与允许这些 plugins 在 CrawClaw 自身中执行相同的 trust boundary。
- 启用前请 review installed plugins。

Custom `mcpServers` 仍按以前方式工作。Built-in plugin-tools bridge 是额外 opt-in convenience，不是 generic MCP server config 的替代品。

## Permission configuration

ACP sessions 以 non-interactive 方式运行，没有 TTY 可用于 approve 或 deny file-write 与 shell-exec permission prompts。acpx plugin 提供两个 config keys 控制 permissions 如何处理：

这些 ACPX harness permissions 独立于 CrawClaw exec approvals，也独立于 CLI-backend vendor bypass flags，例如 Claude CLI `--permission-mode bypassPermissions`。ACPX `approve-all` 是 ACP sessions 的 harness-level break-glass switch。

### `permissionMode`

控制 harness agent 可以在不 prompting 的情况下执行哪些 operations。

| Value           | Behavior                                            |
| --------------- | --------------------------------------------------- |
| `approve-all`   | 自动 approve 所有 file writes 和 shell commands。   |
| `approve-reads` | 只自动 approve reads；writes 和 exec 需要 prompts。 |
| `deny-all`      | Deny all permission prompts。                       |

### `nonInteractivePermissions`

控制如果本应显示 permission prompt 但没有 interactive TTY 可用时的行为；这对 ACP sessions 始终成立。

| Value  | Behavior                                              |
| ------ | ----------------------------------------------------- |
| `fail` | 以 `AcpRuntimeError` abort session。**（默认）**      |
| `deny` | 静默 deny permission 并继续（graceful degradation）。 |

### Configuration

通过 plugin config 设置：

使用 CrawClaw Desktop 做交互式设置，或调用 local Gateway API 自动化。

修改这些值后重启 gateway。

> **Important:** CrawClaw 当前默认 `permissionMode=approve-reads` 和 `nonInteractivePermissions=fail`。在 non-interactive ACP sessions 中，任何触发 permission prompt 的 write 或 exec 都可能因 `AcpRuntimeError: Permission prompt unavailable in non-interactive mode` 失败。
>
> 如果你需要限制 permissions，请将 `nonInteractivePermissions` 设置为 `deny`，这样 sessions 会 graceful degradation，而不是 crash。

## Troubleshooting

| Symptom                                                                     | Likely cause                                                              | Fix                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACP runtime backend is not configured`                                     | Backend plugin missing 或 disabled。                                      | 安装并启用 backend plugin，然后运行 `/acp doctor`。                                                                                               |
| `ACP is disabled by policy (acp.enabled=false)`                             | ACP globally disabled。                                                   | 设置 `acp.enabled=true`。                                                                                                                         |
| `ACP dispatch is disabled by policy (acp.dispatch.enabled=false)`           | 从 normal thread messages dispatch 被禁用。                               | 设置 `acp.dispatch.enabled=true`。                                                                                                                |
| `ACP agent "<id>" is not allowed by policy`                                 | Agent 不在 allowlist 中。                                                 | 使用 allowed `agentId` 或更新 `acp.allowedAgents`。                                                                                               |
| `Unable to resolve session target: ...`                                     | Bad key/id/label token。                                                  | 运行 `/acp sessions`，复制 exact key/label 后重试。                                                                                               |
| `--bind here requires running /acp spawn inside an active ... conversation` | `--bind here` 在没有 active bindable conversation 的地方使用。            | 移动到 target chat/channel 后重试，或使用 unbound spawn。                                                                                         |
| `Conversation bindings are unavailable for <channel>.`                      | Adapter 缺少 current-conversation ACP binding capability。                | 在支持处使用 `/acp spawn ... --thread ...`，配置 top-level `bindings[]`，或移动到 supported channel。                                             |
| `--thread here requires running /acp spawn inside an active ... thread`     | `--thread here` 在 thread context 外使用。                                | 移动到 target thread，或使用 `--thread auto`/`off`。                                                                                              |
| `Only <user-id> can rebind this channel/conversation/thread.`               | 另一个 user 拥有 active binding target。                                  | 以 owner 身份重新 bind，或使用不同 conversation/thread。                                                                                          |
| `Thread bindings are unavailable for <channel>.`                            | Adapter 缺少 thread binding capability。                                  | 使用 `--thread off` 或移动到 supported adapter/channel。                                                                                          |
| Missing ACP metadata for bound session                                      | Stale/deleted ACP session metadata。                                      | 使用 `/acp spawn` 重新创建，然后 rebind/focus thread。                                                                                            |
| `AcpRuntimeError: Permission prompt unavailable in non-interactive mode`    | `permissionMode` 在 non-interactive ACP session 中阻止 writes/exec。      | 将 `plugins.entries.acpx.config.permissionMode` 设置为 `approve-all` 并重启 gateway。参见 [Permission configuration](#permission-configuration)。 |
| ACP session fails early with little output                                  | Permission prompts 被 `permissionMode`/`nonInteractivePermissions` 阻止。 | 查看 gateway logs 中的 `AcpRuntimeError`。完整权限使用 `permissionMode=approve-all`；graceful degradation 使用 `nonInteractivePermissions=deny`。 |
| ACP session stalls indefinitely after completing work                       | Harness process 已完成，但 ACP session 未报告 completion。                | 用 `ps aux \| grep acpx` 监控；手动 kill stale processes。                                                                                        |
