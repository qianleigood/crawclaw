---
summary: "把 CrawClaw 的 run-loop 生命周期收成单一 spine 的设计与落地方案"
read_when:
  - 你在对比 Claude Code 和 CrawClaw 的 hook/lifecycle 设计
  - 你想看统一 run-loop lifecycle spine 的落地方案
  - 你在决定 session summary、durable extraction、dream、compaction 该挂在哪个相位
title: "Run-loop Lifecycle Spine"
---

# Run-loop lifecycle spine

这份文档定义了 CrawClaw 的目标架构：把 run-loop 生命周期收成一条
**统一的 lifecycle spine**。

目标不是立刻删掉所有现有 hook 面，而是让它们变成**建立在同一条生命周期主干上的适配层**，
而不是继续并列充当不同的生命周期来源。

## 为什么要做

Claude Code 的生命周期语义更清晰：

- `postSampling`
- `stop`
- `stopFailure`
- `preCompact`
- `postCompact`
- `subagentStart`
- `subagentStop`

虽然实现不只在一个文件里，但从运行时语义上看，它更像一条统一主干。

CrawClaw 之前把类似能力分散在：

- run-loop helper
- 旧的 memory runtime callback
- compaction 专用 legacy adapter
- internal hooks
- plugin hooks
- Action Feed / Context Archive

这会让整体系统更难理解。

## 目标

CrawClaw 应该收成：

- 一个**统一的 run-loop lifecycle 事件模型**
- 一个**统一的发射主干**
- 多个**订阅者/适配器**

主干负责发 phase。

订阅者基于这些 phase 实现：

- session summary
- durable extraction
- auto-dream
- compaction side effects
- internal hooks
- plugin hooks
- Action Feed
- Context Archive

## Phase 模型

目标 lifecycle phase：

- `turn_started`
- `post_sampling`
- `settled_turn`
- `stop`
- `stop_failure`
- `pre_compact`
- `post_compact`
- `subagent_start`
- `subagent_stop`

这组目标 phase 现在已经全部落地，后续新增的 runtime lifecycle 工作都应优先挂到这套
phase 上，而不是再新增新的 ad-hoc callback 面。

## Event 结构

统一 event 需要小而稳定：

```ts
type RunLoopLifecycleEvent = {
  phase: RunLoopLifecyclePhase;
  runId?: string;
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  isTopLevel: boolean;
  sessionFile?: string;
  turnIndex?: number;
  messageCount?: number;
  tokenCount?: number;
  stopReason?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
};
```

规则：

- 不把整段 transcript 正文塞进 lifecycle event
- 大对象走 Context Archive ref
- lifecycle event 是协调信号，不是 replay blob

## 目标职责划分

### 主干所有者

run-loop 负责发生命周期事件。

具体来说：

- embedded runner 发 `post_sampling` 和 `settled_turn`
- compaction runtime 发 `pre_compact` 和 `post_compact`
- subagent orchestration 发 `subagent_start` 和 `subagent_stop`

### 订阅者

各子系统不再自己定义生命周期，而是订阅 phase：

- `session_summary` -> `post_sampling`
- `durable extraction` -> `stop`
- `autoDream` -> `stop`
- compaction side effects -> `pre_compact` / `post_compact`
- Action Feed -> 相关 phase
- Context Archive -> 相关 phase

### 适配器

现有 hook 面变成适配器：

- internal hooks
- plugin hooks
- compaction 专用 legacy bridge

它们不再定义自己的 phase 语义。

## 落地顺序

### PR1：先建 spine

- 新增 lifecycle phase types
- 新增轻量 lifecycle bus
- 从 run-loop 发第一批 phase
- 先不迁移现有消费者

### PR2：迁移 session summary

- 不再让 `onPostSamplingTurn` 自己承担生命周期定义
- 改成 spine subscriber

### PR3：迁移 durable extraction 和 dream

- 两者都挂到 `stop`
- 从 `afterTurn` 移除重复的 settled-turn 业务语义

### PR4：迁移 compaction hooks

- `pre_compact` / `post_compact` 升成一等 phase
- 把 lifecycle 兼容层统一收成专门的 `runtime/lifecycle/compat/`
  模块目录

### PR5：迁移观测和 legacy hooks

- Action Feed 订阅 lifecycle phase
- Context Archive 订阅 lifecycle phase
- internal/plugin hooks 从 lifecycle 事件向外翻译
- lifecycle event 统一携带 trace envelope（`traceId/spanId/decision/metrics/refs`）
- `agent inspect` 可以从归档的 lifecycle event 直接渲染 run timeline
- operator log 通过绑定 logger context 继承 run/session/phase/decision/trace 字段

### PR6：删除 legacy callback ownership

- 从 `MemoryRuntime` 删掉生命周期 ownership
- `afterTurn` 只保留 ingest/persistence
- 删掉重复 wiring

## PR1 验收标准

PR1 完成的标志：

- lifecycle types 和 bus 已存在
- run-loop 已发 `post_sampling` 和 `settled_turn`
- compaction 已发 `pre_compact` 和 `post_compact`
- 有针对性的测试覆盖 emission 顺序和基本 payload
- 不引入行为回退

## 非目标

这次 rollout **不意味着**：

- 立刻删除 `internal-hooks.ts`
- 立刻删除 plugin hooks
- 先重写 Action Feed 或 Context Archive
- 把代码库里所有 hook-like event 一次性都塞进 spine

这条 spine 只负责 **run-loop lifecycle semantics**。

## 当前状态

`PR1` 到 `PR6` 已经落地：

- run-loop 已发 `turn_started`、`post_sampling`、`settled_turn` 和 `stop`
- compaction 已发 `pre_compact` 和 `post_compact`
- subagent orchestration 已发 `subagent_start` 和 `subagent_stop`
- `session_summary` 已改成 spine subscriber，不再通过
  `MemoryRuntime` callback 自己定义生命周期时机
- `durable extraction` 和 `auto-dream` 也已经订阅同一条 `stop` phase，
  不再直接由 `afterTurn` 调度
- `runtime/lifecycle/compat/subscriber.ts` 现在已经是统一的 spine
  兼容订阅器，`compat/internal-hooks.ts`、`compat/plugin-hooks.ts`、
  `compat/post-compaction.ts` 分别承接 legacy 翻译和 side effects
- Action Feed 与 Context Archive 现在也通过同一条 lifecycle spine
  消费 run-loop phase
- lifecycle archive record 现在会保留统一的 trace envelope
  （`traceId`、`spanId`、`parentSpanId`、`decision`、`metrics`、`refs`）

- `agent inspect` 现在会从归档的 `run.lifecycle.*` 事件重建 run timeline，
  不再只展示最后一份 context snapshot
- 面向 operator 的 subsystem log 现在会在 run 入口绑定 run/session/agent
  上下文，并在控制台输出最小 trace 字段
- compaction retry / recovery path 里的剩余 direct owners 已改成
  lifecycle emission，不再直接拥有 plugin/internal compaction hook 语义
- `MemoryRuntime` 上残留的 legacy lifecycle callback ownership
  (`onPostSamplingTurn`、`onSettledTurn`) 已删除，run-loop lifecycle timing
  现在只由 spine 拥有
- 目标 phase 集合现在已经全部覆盖到同一条 shared lifecycle spine 上

当前剩余的后续工作不再是 phase 覆盖补齐，而是继续扩展更多消费者和 operator surface。

当前 run-loop 的兼容层是刻意保留的，但已经统一收口到
`runtime/lifecycle/compat/` 目录后面。`subscriber.ts` 负责订阅，其他模块负责
把 canonical spine 翻译给 legacy internal/plugin hook surface 和
post-compaction side effects，而不再定义并行的生命周期语义。

## Runtime stack 回归测试集

这套架构当前的标准回归入口是：

```bash
pnpm test:runtime:stack
```

这条测试集比 `pnpm test` 更窄，但对当前 runtime spine 的信号更强，专门用来守住这些主链：

- memory/context runtime 的 prompt assembly
- 基于 lifecycle spine 的 memory scheduling
- session summary / durable extraction / dream 三个记忆 agent runner
- embedded runner 和 memory runtime 的接线
- provider lifecycle 事件发射
- embedded special agent 的继承上下文、cache、observability
- `agent inspect` 的 runtime/archive 富化
- Control UI inspect 相关入口与主视图（`agents` / `chat` / `sessions`）

当前覆盖包括：

- `src/memory/engine/context-memory-runtime.*.test.ts`
- `src/memory/session-summary/agent-runner.test.ts`
- `src/memory/durable/agent-runner.test.ts`
- `src/memory/dreaming/agent-runner.test.ts`
- `src/agents/pi-embedded-runner/run/attempt.*.test.ts`
- `src/agents/special/runtime/*.test.ts`
- `src/commands/agent.inspect.test.ts`
- `ui/src/ui/controllers/agents.test.ts`
- `ui/src/ui/views/agents.test.ts`
- `ui/src/ui/views/chat.test.ts`
- `ui/src/ui/views/sessions.test.ts`

按当前这轮结果，这条测试集已经通过：

- unit lane：8 个文件 / 83 个测试
- base lane：14 个文件 / 64 个测试

这条集合最适合回答这几个问题：

- 记忆架构现在是不是还接得对？
- 记忆 agent 现在是不是还能通过当前 substrate 正常运行？
- inspect 现在是不是还能把 runtime/memory 状态暴露给 CLI 和 Control UI？

它仍然不能替代完整 e2e 或长时间 soak 测试，但对于当前的 run-loop、memory、special agent 和
inspect 架构，它就是最核心的定向回归带。
