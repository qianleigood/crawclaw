---
read_when:
  - You are changing durable-memory special-agent behavior
  - You need the input contract, trigger rules, and capability boundary for durable memory maintenance
  - You are comparing CrawClaw memory maintenance with Claude Code memory behavior
summary: "Current durable-memory special-agent design and future automatic extraction boundary"
title: "Durable Memory Agent Design"
---

# Durable Memory Agent Design

CrawClaw keeps normal Hindsight experience writeback in the memory outbox, and
treats `durable-memory` as a constrained memory-maintenance special agent.

The design borrows the useful Claude Code idea of an isolated memory-maintenance
worker, but does not copy Claude Code's file-native memory implementation.
CrawClaw stores memory in Hindsight layers and enforces those layers through the
runtime tool wrapper.

## Current State

As of the current runtime:

- `memory.afterTurn` records runtime-store rows and enqueues eligible completed
  turns for Hindsight `experience` retain.
- `durable-memory` is registered as an `embedded_fork` special agent.
- `durable-memory` declares `parentContextPolicy: "none"`.
- `durable-memory` receives a structured `contextPackage`, not the parent
  transcript or prompt envelope.
- `durable-memory` can use only the `durable` Hindsight layer.
- `experience` can use only the `experience` Hindsight layer.
- `dream` can use only the `mental-models` Hindsight layer.
- `session-summary` remains the compaction/session-continuity special agent.

There is not currently a landed automatic per-turn durable extraction scheduler.
Do not describe durable auto-write as fully moved to a background
`durable-memory` agent unless the scheduler, cursor, skip rules, and
observability paths are implemented and tested.

## Why The Input Must Be Narrow

Durable memory is long-lived. If the agent inherits the parent transcript, it
can accidentally turn private task context, exploratory reasoning, or transient
tool output into durable memory.

The durable-memory agent therefore uses a structured input package:

- recent model-visible messages selected by the caller
- scope/session identifiers
- existing durable manifest or recall context when available
- explicit write/delete signals

It must not receive:

- the whole transcript
- hidden parent prompt context
- the whole project context
- unrelated session history

## Runtime Contract

The canonical special-agent definition is in
`crates/crawclaw-runtime/src/special_agents.rs`.

`durable-memory` declares:

- `executionMode: "embedded_fork"`
- `parentContextPolicy: "none"`
- `inputContract: "memory_delta"`
- `persistenceHandler: "hindsight_memory"`
- allowed memory layer: `durable`
- tool allowlist: `knowledge_recall`, `knowledge_ingest`, `sessions_history`

The gateway wraps `contextPackage` in a task body that tells the agent to use
only the structured memory-maintenance input and not infer memory from hidden
parent context.

## Context Package Shape

The concrete JSON may evolve, but the package should stay narrow and explicit:

```json
{
  "sessionId": "session-1",
  "sessionKey": "agent:main:session-1",
  "scope": {
    "scopeKey": "main",
    "agentId": "main",
    "channel": "cli",
    "userId": "user"
  },
  "cursorAfter": {
    "messageId": "msg-123",
    "turn": 42
  },
  "recentModelVisibleMessages": [
    {
      "id": "msg-124",
      "role": "user",
      "text": "Remember that this project uses plugin terminology.",
      "turnIndex": 43
    }
  ],
  "existingManifest": [
    {
      "title": "Project terminology",
      "durableType": "project",
      "description": "Use plugin terminology in docs and UI.",
      "dedupeKey": "project-terminology"
    }
  ],
  "explicitSignals": {
    "explicitRememberAsked": true,
    "explicitForgetAsked": false,
    "hadDurableWriteThisTurn": false,
    "hadDurableDeleteThisTurn": false,
    "hadExperienceWriteThisTurn": false
  }
}
```

## Capability Boundary

Allowed behavior:

- recall existing durable notes
- ingest a new durable note
- update the durable layer through the Hindsight tool path
- return a concise maintenance report

Disallowed behavior:

- source-code browsing
- shell execution
- web or browser access
- arbitrary session spawning
- writing non-durable Hindsight layers
- treating parent transcript content as input

The runtime enforces the Hindsight layer. The prompt explains the job, but the
tool wrapper is the policy boundary.

## Extraction Semantics

When automatic durable extraction is implemented, it should follow these rules:

1. Trigger only after a stable top-level turn ends.
2. Process only model-visible messages since the durable extraction cursor.
3. Use a safety cap for input size, but do not define the window only by "last
   N messages".
4. Skip automatic extraction when the turn already performed an explicit
   durable write or delete.
5. Do not skip just because the turn wrote `experience`.
6. Advance the cursor after a successful write or a policy skip.
7. Do not advance the cursor after failure.

These rules are a future automatic scheduler contract. The current runtime has
the special-agent boundary and narrow-input path, not the complete automatic
durable scheduler.

## Feedback Semantics

Durable `feedback` should mean stable future-behavior guidance, not operational
lessons.

Good durable feedback examples:

- "Do not default to a marketing-style page for this product."
- "Keep project architecture answers grounded in current code."
- "Use plugin terminology in docs and UI."

Experience memory should hold reusable operational lessons, command sequences,
debugging workflows, and implementation patterns.

## Relationship To Other Memory Agents

- `experience` writes reusable operational lessons into Hindsight
  `experience`.
- `dream` consolidates durable/session signals into Hindsight `mental-models`.
- `session-summary` summarizes session continuity for compaction.
- `durable-memory` writes stable user/project preference and collaboration
  context into Hindsight `durable`.

Keeping these surfaces separate avoids parent-context pollution and keeps each
memory layer auditable.

## Minimum Tests

Changes to this area should include tests that prove:

- `durable-memory` definitions declare `memory_delta` input and no parent
  context.
- `durable-memory` receives `contextPackage` without parent transcript leakage.
- memory tools resolve the durable layer for `durable-memory`.
- `experience` and `dream` cannot write the durable layer.
- `memoryMode` gates prompt recall and knowledge-tool availability according to
  the Hindsight config.

These tests matter more than prompt snapshot changes because they verify the
actual runtime boundary.
