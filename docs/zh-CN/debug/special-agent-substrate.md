---
title: "特殊智能体底座"
summary: "CrawClaw 后台维护型特殊智能体的共享运行时底座"
read_when:
  - 修改 special-agent 生成或 transcript policy
  - 审计后台维护型 agent 的运行时行为
---

# Special-Agent Substrate

CrawClaw 现在有一层共享的 special-agent 底座，用于运行在 run-loop
lifecycle spine 之上的后台维护型 agent。

## Scope

这层 substrate 只统一运行时横切面：

- spawn metadata
- `spawnSource`
- 显式 transcript policy
- 显式 tool policy / allowlist enforcement
- 显式 cache policy
- 默认 `maxTurns`
- 默认 `runTimeoutSeconds`
- transcript/session spawn context wiring
- `agent.wait`
- completion reply capture
- 共享 lifecycle subscriber wiring
- 共享 agent-event / history / usage hooks

它不会试图统一：

- prompts
- tool surfaces
- result schemas
- persistence behavior
- lifecycle gate logic

这遵循 Claude Code 的模式：共享 forked-agent runtime，在其上保留专用 agent。

## Shared Runtime

共享运行时位于：

- `crates/crawclaw-runtime/src/lib.rs`

核心概念：

- `SpecialAgentDefinition`
  声明某个 special agent 的稳定运行时契约，包括
  `executionMode: "spawned_session" | "embedded_fork"`。
- Rust special-agent registry
  按 `spawnSource` 解析已注册的 special-agent definitions 和 tool policies。
- Rust special-agent runtime
  分发到选定的 special-agent definition，然后处理 completion capture、
  transcript-policy enforcement，以及可选的 event/history/usage hooks。
- Rust embedded-fork runner
  在 native agent runtime 内承载 embedded-fork substrate 路径。
- `createRunLoopLifecycleRegistration(...)`
  处理 special-agent subscribers 的共享 lifecycle phase registration。
- `createSharedLifecycleSubscriberAccessor(...)`
  处理 shared singleton-style subscriber 的复用和 reset 行为。

## Landed Agents

当前使用这层 substrate 的有：

- session summary
  - Rust memory runtime session-summary job
  - definition id: `session-summary`
- durable memory agent
  - Rust memory runtime durable extraction job
  - definition id: `durable-memory`
- dream
  - Rust memory runtime dream job
  - definition id: `dream`
- review-spec
  - Rust native special-agent registry
  - definition id: `review-spec`
- review-quality
  - Rust native special-agent registry
  - definition id: `review-quality`

这些 pilot 仍保留各自的：

- prompt builders
- lifecycle subscribers
- scheduler / worker-manager logic
- result parsing
- action-feed titles and summaries

共享的只有 runtime substrate。

## Why This Shape

目标是统一横切机制，而不是把专用 agent 行为压平成一个大 contract。

也就是说：

- lifecycle spine 仍是 phase timing 的唯一 owner
- special agents 共享同一个 runtime substrate
- 每个 agent 仍拥有自己的 mission、tools 和 outputs

这让共享 runtime 覆盖：

- session-summary maintenance
- durable memory agent
- dream / auto-dream
- review

Prompts、tool contracts 和 result schemas 仍保持专用化。

## Claude Alignment

在 substrate 设计层面，这已经接近 Claude Code：

- shared lifecycle spine
- shared special-agent runtime
- maintenance agents 的显式 transcript isolation
- 每个 special agent 都有显式 tool policy，在 runtime deny，而不是只在
  prompt-time 缩小 tool inventory
- 每个 special agent 都有显式 provider-level cache policy
- runner 中有共享 event/history/usage hooks

CrawClaw 现在只保留当前 memory special agents 会用到的 cache pieces：

- memory-oriented special agents 在 `SpecialAgentDefinition` 中声明 cache policy
- shared runner 把这些 policy 转换成 provider request params，例如短 retention
  和 cache-write suppression
- parent runs 会从最终 parent prompt assembly 构造 lifecycle
  `parentForkContext`，这样 runtime forks 可以接收一个捕获的 handoff object，
  其中包含 model-visible messages 以及 cache/debug metadata
- runtime forks 声明 definition-level `parentContextPolicy`
  (`none`, `fork_messages_only`, or `full_envelope`)，由 runtime 决定是否允许
  附加捕获到的 parent prompt envelope
- parent fork context 会分离：
  - 面向 model-visible shared prefix 的 canonical `CacheEnvelope`
  - 不影响 cache identity 的 run/session debug context fields
- canonical `CacheEnvelope` 只覆盖：
  - `systemPromptText`
  - tool prompt payload + tool-inventory digest
  - thinking config
  - fork-context messages
- provider-specific request patching 只消费 direct cache hints；不再从 parent
  envelope 推导 parent prompt-cache key
- substrate 现在支持显式 `embedded_fork` execution mode，因此 special agents
  不再只能建模成 child sessions
- session-summary special runs 使用 lifecycle `parentForkContext` 作为自动父级
  handoff
- 该 parent fork context 携带完整的当前 model-visible fork-context messages，
  与 Claude Code 的 session-memory update shape 对齐，而不依赖 recent-message
  excerpt fallback
- session-summary 声明 `parentContextPolicy: "full_envelope"` 用于 handoff
  object，但不复用 parent system prompt、main-agent prompt extras 或 main
  memory-runtime recall path
- 缺少 fork context 的 lifecycle updates 会被跳过；显式 CLI/gateway refresh 会从
  persisted model-visible rows 构造有界 manual parent fork context
- 当 parent fork context 可用时，summary-specific instructions 保持在 task
  prompt 中，而不是追加或合并进 parent system prompt
- durable extraction 不附加 parent run 捕获的 prompt envelope；
  `parentContextPolicy: "fork_messages_only"` 只给它 recent-message extraction
  window 需要的 fork-context messages
- embedded runs 不会从完整 parent prompt envelope 中推断 fork-context
  messages；special-agent transport 会根据声明的 `parentContextPolicy` 选择
  handoff
- dream 是独立的 embedded maintenance special agent。它不接收 parent fork
  context，因为 definition 声明 `parentContextPolicy: "none"`，不生成 child
  session，并且只消费 host 提供的 durable manifest、structured signals 和
  transcript refs
- dream 和 experience 使用 embedded maintenance runner，并声明
  `parentContextPolicy: "none"`，因此这些 run 停留在窄 maintenance prompt
  surface，而不继承 parent context
- durable extraction 和 dream special runs 仍保留 cache-write suppression 和
  short retention
- session-summary 保留 short retention，但不复用 parent prompt-cache key
- session-summary-backed compaction 会把渲染后的 compact view 存入 compaction
  state，并在 preserved tail 前作为 compact summary message 加入 prompt assembly
- stale `summaryInProgress` leases 会在 compaction 时清理，而不是被 dead summary
  run 阻塞
- runtime memory special runs 会把共享 agent-event / history / usage observations
  记录进 Context Archive，而不依赖 child-session transcript state
- 同一批 runtime memory runs 会把 usage，包括 `cacheRead` / `cacheWrite`，回传到
  Action Feed completion details
- runtime memory special agents 在 substrate 上显式声明 cache-write
  suppression，并映射到 provider 支持的“不要创建新 cache entries”控制，同时尽量
  保留 prompt-cache reads
- review stage agents 明确保留在 `spawned_session`；它们使用共享 substrate
  contract，但不会被当成 fire-and-forget maintenance forks

在当前 CrawClaw runtime 层，这基本收口了第一轮 embedded-fork rollout 后还存在
的 substrate 级设计缺口，同时也简化了 ownership：

- Rust memory runtime 拥有 canonical cache identity 和 parent fork context
  construction
- Rust special-agent definitions 拥有 direct special-agent cache hints
- provider request payload translation 由 Rust runtime/provider layer 拥有

与 Claude Code 的主要差异是：CrawClaw 仍不会把 parent query loop 作为 live
in-process clone 重放。显式 parent fork context 是 session-summary history 的
受支持 handoff；request building 仍是 adapter-shaped，cache controls 仍作为
direct special-agent hints。

未来 task-specific special agents 应继续逐案接入：

- maintenance-style、fire-and-forget background agents 应优先使用
  `embedded_fork`；独立性应来自显式 `parentContextPolicy` 选择和 isolated
  context behavior，而不是在调用点隐式省略 parent fork context
- user-invoked 或 session-bearing task agents 应保持 `spawned_session`，除非
  它们明确比 child-session state 更需要 parent fork context
