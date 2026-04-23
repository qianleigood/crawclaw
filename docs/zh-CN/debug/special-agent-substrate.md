# Special-Agent Substrate

CrawClaw 现在已经有一层统一的 special-agent 运行底座，专门服务 run-loop lifecycle spine 上的后台维护型 agent。

## 范围

这层 substrate 只统一运行时横切面：

- spawn metadata
- `spawnSource`
- 显式 transcript policy
- 显式 tool policy / allowlist enforcement
- 显式 cache policy
- 默认 `maxTurns`
- 默认 `runTimeoutSeconds`
- transcript/session spawn context 接线
- `agent.wait`
- completion reply capture
- 共享 lifecycle subscriber 接线
- 共享 agent-event / history / usage hooks

它**不会**试图统一这些内容：

- prompt
- tool surface
- result schema
- persistence behavior
- lifecycle gate logic

这和 Claude Code 的做法一致：统一 forked-agent runtime，不把专用 agent 的职责压成一套。

## Shared Runtime

共享运行时代码在：

- `src/agents/special/runtime/types.ts`
- `src/agents/special/runtime/run-once.ts`

核心概念：

- `SpecialAgentDefinition`
  描述某个 special agent 的稳定运行契约，并显式声明
  `executionMode: "spawned_session" | "embedded_fork"`。
- `registry.ts`
  负责按 `spawnSource` 解析已注册的 special-agent definition 和 tool policy。
- `runSpecialAgentToCompletion(...)`
  统一按 execution mode dispatch 到对应 substrate，再处理 completion
  capture、transcript policy 约束，以及可选的 event/history/usage hooks。
- `embedded-run-once.ts`
  承载新的 embedded-fork substrate 路径。
- `createRunLoopLifecycleRegistration(...)`
  统一处理 special-agent subscriber 的 phase 注册。
- `createSharedLifecycleSubscriberAccessor(...)`
  统一处理 shared subscriber 的复用和 reset 行为。

## 已接入 Agent

现在已经接入这层 substrate 的有：

- session summary
  - `src/memory/session-summary/agent-runner.ts`
  - definition: `SESSION_SUMMARY_AGENT_DEFINITION`
- durable memory extraction
  - `src/memory/durable/agent-runner.ts`
  - definition: `MEMORY_EXTRACTION_AGENT_DEFINITION`
- dream
  - `src/memory/dreaming/agent-runner.ts`
  - definition: `DREAM_AGENT_DEFINITION`
- review-spec
  - `src/agents/review-agent.ts`
  - definition: `REVIEW_SPEC_AGENT_DEFINITION`
- review-quality
  - `src/agents/review-agent.ts`
  - definition: `REVIEW_QUALITY_AGENT_DEFINITION`

这些试点仍然保留各自原本的：

- prompt builder
- lifecycle subscriber
- scheduler / worker-manager 逻辑
- result parsing
- action-feed 标题和摘要

共享的只是运行底座。

## 为什么这样设计

目标是统一横切运行机制，而不是把专用 agent 的行为揉成一个大而平的统一 contract。

也就是：

- lifecycle spine 继续是唯一的 phase owner
- special agents 共享同一层 runtime substrate
- 每个 agent 仍然保留自己的使命、tools 和输出

也就是说，这层共享 runtime 现在已经服务于：

- session-summary maintenance
- durable memory extraction
- dream / auto-dream
- review

但 prompt、tool contract 和结果 schema 仍然保持专用化。

## 与 Claude 的对齐程度

到这一版为止，subtrate 设计层已经很接近 Claude Code：

- 共享 lifecycle spine
- 共享 special-agent runtime
- 对维护型 agent 显式声明 transcript isolation
- 每个 special agent 显式声明 tool policy，并按 Claude 风格在执行时 deny，而不是在 prompt 侧缩小工具清单
- 每个 special agent 显式声明 provider 级 cache policy
- runner 内建共享的 event/history/usage hooks

CrawClaw 现在也已经接入了 Claude cache 设计里可以直接移植的那部分：

- memory 类 special agent 会在 `SpecialAgentDefinition` 上声明 cache policy
- shared runner 现在会优先基于 canonical 的 parent cache-envelope identity 派生稳定的 prompt-cache key；只有在兼容场景下才回退到 parent session
- 这些 policy 会沿共享 spawn 链路继续传到 provider request 参数
- parent run 现在也会按 `runId` 持久化 cache-safe snapshot，special agent 已经可以从父 run 最终 prompt 组装结果开始继承 cache 信息，而不只是依赖 session key
- 这些 cache-safe snapshot 现在会把内容拆成两层：
  - 参与 cache identity 的 canonical `CacheEnvelope`
  - 只用于观测/调试的 run/session 上下文字段
- 这层 canonical `CacheEnvelope` 现在只覆盖：
  - `systemPromptText`
  - tool prompt payload 和 tool-inventory digest
  - thinking config
  - fork-context messages
- cache 复用和 drift 现在通过显式的 fork-cache plan 统一处理，不再把规则分散在 snapshot 持久化、embedded attempt、provider patch 几处
- provider 侧的请求 patch 现在只消费已经算好的 cache hints，不再自己定义 cache identity
- substrate 现在也已经支持显式的 `embedded_fork` execution mode，不再只能把 special agent 建模成 child session
- embedded memory special agent 现在会继承父 run 捕获到的 system-prompt envelope，而不是每次都从头重建一套无关的隔离 prompt
- embedded memory special run 现在还会把 inherited thinking/tool/fork-context 和当前 embedded 请求做 drift 校验；如果偏移太大，就自动停用 inherited prompt-cache key
- embedded memory special run 现在会把共享的 agent-event / history / usage 观测写进 Context Archive，不再依赖 child-session transcript
- 同一批 embedded memory run 现在也会把 usage，包括 `cacheRead` / `cacheWrite`，回灌到 Action Feed 的完成态 detail 里
- embedded memory special agent 现在也已经在 substrate 上显式声明 cache-write suppression，并把它映射到 provider 支持的“不要创建新 cache entry”控制，同时尽量保留 prompt-cache read
- review stage agents 显式保留在 `spawned_session`，共享 substrate contract，但不被当成 fire-and-forget maintenance fork

在当前 CrawClaw 的 runtime 层，这意味着 special-agent substrate 的主要设计缺口已经基本收口，而且 cache 语义的 owner 也更清楚了：

- `parent-fork-context.ts` 负责 canonical cache identity 和 parent fork context
- `cache-plan.ts` 负责 direct special-agent cache hints
- `extra-params.ts` 只负责把 cache hints 映射到 provider payload

和 Claude Code 还保留的一条主要差异是：CrawClaw 还没有完全复用同一条 in-process forked query-loop identity。现在继承的 envelope 已经足够形成稳定的 cache identity 和 drift 保护，但 request 重建仍然是适配层语义，而不是 Claude 那个原生 `CacheSafeParams` 对象模型的逐字复用。

未来 task-specific special agent 继续按 case-by-case 接入：

- 维护型、后台、fire-and-forget agent 优先走 `embedded_fork`
- 面向用户、需要独立 session 状态的 task agent 默认保持 `spawned_session`
