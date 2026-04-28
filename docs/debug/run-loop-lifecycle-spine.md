---
summary: "Design and rollout plan for unifying CrawClaw's run-loop lifecycle into a single spine"
read_when:
  - You are comparing Claude Code's hook spine with CrawClaw's runtime lifecycle
  - You want the rollout plan for a unified run-loop lifecycle bus
  - You are deciding where session summary, durable extraction, dream, and compaction should attach
title: "Run-loop Lifecycle Spine"
---

# Run-loop lifecycle spine

This page defines the target architecture for a **single run-loop lifecycle
spine** in CrawClaw.

The goal is not to remove every existing hook surface immediately. The goal is
to make them **adapters over one canonical lifecycle**, instead of letting
multiple subsystems act as competing lifecycle owners.

## Why this is needed

Claude Code has a clearer lifecycle model:

- `postSampling`
- `stop`
- `stopFailure`
- `preCompact`
- `postCompact`
- `subagentStart`
- `subagentStop`

Those phases are not all implemented in one file, but they behave like a single
runtime spine.

CrawClaw historically spread comparable semantics across:

- run-loop helpers
- former memory runtime callbacks
- compaction-specific legacy adapters
- internal hooks
- plugin hooks
- Action Feed / Context Archive side channels

That makes the system harder to reason about.

## Design goal

CrawClaw should converge on:

- one **run-loop lifecycle event model**
- one **emission spine**
- many **subscribers/adapters**

The spine emits lifecycle phases.

Subscribers consume those phases to implement:

- session summary
- durable extraction
- auto-dream
- compaction side effects
- internal hooks
- plugin hooks
- Action Feed
- Context Archive

## Phase model

The target lifecycle phases are:

- `turn_started`
- `post_sampling`
- `settled_turn`
- `stop`
- `stop_failure`
- `pre_compact`
- `post_compact`
- `subagent_start`
- `subagent_stop`

All target phases are now emitted. The important rule going forward is that new
runtime lifecycle work should use this phase model instead of adding new ad-hoc
callback planes.

## Event shape

The canonical event should stay small and stable:

```ts
type RunLoopLifecycleEvent = {
  phase: RunLoopLifecyclePhase;
  observation: ObservationContext;
  runId?: string;
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  parentAgentId?: string;
  isTopLevel: boolean;
  sessionFile?: string;
  turnIndex?: number;
  messageCount?: number;
  tokenCount?: number;
  stopReason?: string | null;
  error?: string | null;
  decision: {
    code: string;
    summary?: string;
    details?: Record<string, unknown>;
  } | null;
  metrics: Record<string, number>;
  refs: Record<string, string | number | boolean | null>;
  metadata?: Record<string, unknown>;
};
```

Rules:

- do not embed full transcript payloads in lifecycle events
- large payloads belong in Context Archive refs
- lifecycle events are coordination signals, not replay blobs
- `ObservationContext` is the only tracing and correlation contract
- local ids such as `requestId`, `messageId`, and `toolCallId` stay in `refs` or
  event-specific business fields

## Target ownership model

### Spine owner

The run-loop owns lifecycle emission.

In practice that means:

- the embedded runner emits `post_sampling` and `settled_turn`
- the compaction runtime emits `pre_compact` and `post_compact`
- subagent orchestration emits `subagent_start` and `subagent_stop`

### Subscribers

Subsystems stop defining lifecycle semantics for themselves.

Instead they subscribe:

- `session_summary` -> `post_sampling`
- `durable extraction` -> `stop`
- `autoDream` -> `stop`
- compaction side effects -> `pre_compact` and `post_compact`
- Action Feed -> all relevant phases
- Context Archive -> all relevant phases

### Adapters

Existing hook surfaces become adapters:

- internal hooks
- plugin hooks
- compaction-specific legacy bridges

They should not define new phase semantics.

## Rollout plan

### PR1: add the spine

- add lifecycle phase types
- add a small lifecycle bus
- emit the first phases from the run-loop
- do not migrate existing consumers yet

### PR2: migrate session summary

- replace direct `onPostSamplingTurn` lifecycle ownership with spine
- keep current behavior, but consume via subscriber

### PR3: migrate durable extraction and dream

- attach both to `stop`
- remove duplicated settled-turn business logic from `afterTurn`

### PR4: migrate compaction hooks

- make `pre_compact` and `post_compact` first-class spine phases
- reduce lifecycle compatibility handling to a dedicated `runtime/lifecycle/compat/`
  module tree

### PR5: migrate observability and legacy hook surfaces

- Action Feed subscribes to lifecycle phases
- Context Archive subscribes to lifecycle phases
- internal hooks and plugin hooks translate lifecycle events outward
- lifecycle events carry a shared observation context plus `decision`, `metrics`,
  and `refs`
- `agent inspect` renders a run timeline from archived lifecycle events
- operator logs inherit run/session/phase/decision/trace fields from observation
  scope

### ObservationContext

The lifecycle spine owns CrawClaw's runtime lifecycle semantics.
`ObservationContext` owns tracing identity and propagation:

```ts
type ObservationContext = {
  trace: {
    traceId: string;
    spanId: string;
    parentSpanId: string | null;
    traceparent?: string;
    tracestate?: string;
  };
  runtime: {
    runId?: string;
    sessionId?: string;
    sessionKey?: string;
    agentId?: string;
    parentAgentId?: string;
    taskId?: string;
    workflowRunId?: string;
    workflowStepId?: string;
  };
  phase?: string;
  decisionCode?: string;
  source: string;
  refs?: Record<string, string | number | boolean | null>;
};
```

The default root trace id rule is:

```ts
trace.traceId = `run-loop:${runId ?? sessionKey ?? sessionId}`;
```

Run root spans use `root:${trace.traceId}`. Provider requests, tool calls,
subagents, workflow steps, and memory agents derive child observations from the
parent observation. Lifecycle decisions expose `decision.code` and the derived
`decisionCode` attribute used by diagnostics and logs.

The diagnostic bridge emits every lifecycle phase as a `run.lifecycle`
diagnostic event with the same observation. Cache trace entries carry the same
observation identity, subsystem logs read the current observation scope, and
the `diagnostics-otel` plugin exports observation ids as span/log attributes.
OTel metrics intentionally exclude high-cardinality ids such as `traceId`,
`spanId`, `runId`, `sessionId`, and `sessionKey`.

This is intentionally not a second lifecycle spine. W3C `traceparent` and
`tracestate` are boundary propagation fields inside `ObservationContext`, not a
replacement for the run-loop lifecycle owner.

### PR6: remove legacy callback ownership

- remove lifecycle ownership from `MemoryRuntime`
- keep `afterTurn` only for ingestion/persistence work
- delete duplicated lifecycle wiring

## PR1 acceptance criteria

PR1 is complete when:

- lifecycle types and bus exist
- run-loop emits `post_sampling` and `settled_turn`
- compaction emits `pre_compact` and `post_compact`
- targeted tests cover emission order and basic payload shape
- no existing behavior regresses

## Non-goals

This rollout does **not** mean:

- removing `internal-hooks.ts` immediately
- removing plugin hooks immediately
- rewriting Action Feed or Context Archive first
- forcing every hook-like event in the codebase into the spine

The spine only owns **run-loop lifecycle semantics**.

## Current status

PR1 through PR6 are landed:

- the run-loop emits `post_sampling`, `settled_turn`, and `stop`
- the run-loop now also emits `turn_started`
- compaction emits `pre_compact` and `post_compact`
- subagent orchestration now emits `subagent_start` and `subagent_stop`
- `session_summary` consumes the spine as a subscriber instead of owning
  lifecycle timing through `MemoryRuntime` callbacks
- `durable extraction` and `auto-dream` now subscribe to the same `stop` phase
  instead of being scheduled directly from `afterTurn`
- `runtime/lifecycle/compat/subscriber.ts` is now the unified spine
  compatibility subscriber, while `compat/internal-hooks.ts`,
  `compat/plugin-hooks.ts`, and `compat/post-compaction.ts` isolate the legacy
  translations and side effects
- Action Feed and Context Archive now consume the same lifecycle spine for
  run-loop phase visibility
- lifecycle archive records now preserve `ObservationContext` plus lifecycle
  `decision`, `metrics`, and `refs`
- lifecycle events now bridge into diagnostic events as `run.lifecycle`, and
  diagnostic/cache trace/OTel/log surfaces read the same observation context
- `agent inspect` now reconstructs a run timeline from archived
  `run.lifecycle.*` events instead of only showing the latest context snapshot
- operator-facing subsystem logs now bind run/session/agent context at the
  run entrypoints and append the minimal trace fields on console output
- remaining compaction retry and recovery paths now emit lifecycle phases
  instead of directly owning plugin/internal compaction hooks
- the original target phase set is now fully covered by the shared lifecycle
  spine
- `MemoryRuntime` no longer exposes legacy lifecycle ownership callbacks like
  `onPostSamplingTurn` and `onSettledTurn`; the lifecycle spine is now the only
  owner of run-loop lifecycle timing

The remaining follow-up is phase coverage expansion, not more duplicate
lifecycle ownership cleanup.

The remaining run-loop compatibility layer is intentional. It now sits behind
`runtime/lifecycle/compat/`, where `subscriber.ts` owns subscription and the
other modules translate canonical spine phases into legacy internal/plugin
surfaces and post-compaction side effects without reintroducing parallel
lifecycle ownership.

## Runtime stack regression suite

The canonical regression entry for this architecture is:

```bash
pnpm test:runtime:stack
```

This suite is intentionally narrower than `pnpm test`, but higher signal for the
current runtime spine. It exercises the main cross-cutting paths that should not
quietly regress:

- memory/context runtime prompt assembly
- lifecycle-driven memory scheduling
- session summary / durable extraction / dream agent runners
- embedded runner memory-runtime handoff
- provider lifecycle emission
- embedded special-agent inheritance, cache, and observability
- `agent inspect` runtime/archive enrichment
- Browser client inspect entrypoints and views (`agents` / `chat` / `sessions`)

Current coverage includes:

- `src/memory/engine/context-memory-runtime.*.test.ts`
- `src/memory/session-summary/agent-runner.test.ts`
- `src/memory/durable/agent-runner.test.ts`
- `src/memory/dreaming/agent-runner.test.ts`
- `src/agents/pi-embedded-runner/run/attempt.*.test.ts`
- `src/agents/special/runtime/*.test.ts`
- `src/commands/agent.inspect.test.ts`

At the time of writing, this suite passes as:

- unit lane: 8 files / 83 tests
- base lane: 14 files / 64 tests

This suite is the quickest way to answer:

- is the memory architecture still wired correctly?
- are the memory agents still runnable through the current substrate?
- does inspect still expose the runtime/memory state to CLI and Browser client?

It is still not a substitute for full e2e or long-running soak coverage. It is
the primary targeted regression belt for the current run-loop, memory, special
agent, and inspect architecture.
