---
title: "Memory Overview"
summary: "How CrawClaw uses Hindsight memory banks, session summaries, and Context Archive"
read_when:
  - You want to understand how memory works
  - You want to understand Hindsight backed durable and experience memory
  - You want to understand what is replayable versus retained
---

# Memory Overview

CrawClaw memory is Hindsight-native for retained knowledge and local for session
continuity:

- **Session transcript** records what happened in one runtime session.
- **Session summary** stores compacted session continuity under
  `memory/session-summary`.
- **Durable memory** stores stable user preferences, project facts, and
  collaboration context in the Hindsight `durable` layer.
- **Experience memory** stores reusable lessons and procedures in the Hindsight
  `experience` layer.
- **Resource memory** stores document, code, and reference material in the
  Hindsight `resource` layer.
- **Mental models** store lower-frequency reflective synthesis in the Hindsight
  `mental-models` layer.
- **Context Archive** records replay and debug evidence for what a run saw and
  did.

The model only remembers what these layers persist and later recall. There is no
hidden model state.

## Target product design

The product target is an explicit, observable memory loop:

- turn-end memory work must not block the main response path
- `memory.afterTurn` records model-visible message deltas and enqueues memory
  jobs in the runtime store
- `memory.outbox.process` is the worker entrypoint that writes queued retain
  jobs to Hindsight
- `memory.status`, `memory.outbox.list`, and `memory.activity.list` expose
  policy, queue state, and recent memory activity
- explicit `remember` writes a durable-memory retain job
- explicit `do-not-remember` prevents Hindsight writeback for that turn while
  keeping local session continuity records
- explicit `forget` is recorded as an observable job, but is marked
  unsupported until the Hindsight API exposes a delete operation; CrawClaw does
  not report a false remote deletion

This keeps the ideal design small: CrawClaw owns policy, idempotent local state,
and observability; Hindsight owns semantic storage, recall, ranking, and future
delete support.

## Hindsight layers

The built-in runtime derives Hindsight bank ids from the configured prefix,
granularity, and layer. The default bank granularity is `agent`, so the main
agent resolves banks such as:

- `crawclaw:main:durable`
- `crawclaw:main:experience`
- `crawclaw:main:resource`
- `crawclaw:main:mental-models`

Shared mode can route all scopes through a configured shared bank id. See
[Memory configuration reference](/reference/memory-config) for the full
configuration surface.

## Recall

Prompt-time recall is owned by the Rust memory runtime. When Hindsight is
enabled and `memory.hindsight.memoryMode` allows prompt recall, CrawClaw queries
the durable, experience, resource, and mental-model layers and injects the
bounded results into the runtime context.

`memory.hindsight.memoryMode` has these effects:

- `hybrid`: prompt recall is enabled; configured knowledge tools may also be
  exposed where the runtime allows them.
- `context`: prompt recall is enabled; user-facing knowledge tools stay off.
- `tools`: prompt recall is disabled; tools are the explicit access path when
  enabled.

Recall is bounded by the current model context budget. Smaller context windows
receive tighter memory snippets; larger context windows can receive more recall
without becoming unbounded.

## Writeback

Turn-end writeback is intentionally split by memory type:

- `memory.afterTurn` records the new model-visible user and assistant messages
  in the runtime store.
- Eligible completed turns enqueue a Hindsight `experience` retain job. The
  outbox worker later writes it to Hindsight. This path does not call the
  `experience` special agent.
- Explicit `remember` requests enqueue a Hindsight `durable` retain job.
- Explicit `do-not-remember` requests skip Hindsight writeback for the turn.
- Explicit `forget` requests are tracked as memory activity and outbox work;
  they are reported as unsupported until the Hindsight backend provides delete
  support.
- `durable-memory` is a constrained maintenance special agent for stable
  long-term facts. It receives a structured memory delta input and does not
  inherit parent transcript history.
- `dream` is a maintenance special agent for manual reflective maintenance. The
  automatic dream consolidation path uses the Rust Hindsight reflection pipeline.
- `session-summary` is the compaction and session-continuity special agent. It
  writes local session summary files, not Hindsight durable memory.

Memory maintenance tools are special-agent-only. The runtime also enforces the
target Hindsight layer for memory special agents:

- `durable-memory` can write only `durable`
- `experience` can write only `experience`
- `dream` can write only `mental-models`

This prevents a memory maintenance prompt from silently writing to the wrong
bank.

## Durable memory

Durable memory is for stable facts, durable preferences, future behavior
guidance, and long-lived project context. It is not a transcript copy and it is
not a place for reusable procedures.

The `durable-memory` special agent uses a narrow structured input package. The
input may include recent model-visible message deltas, scope metadata, cursor
state, existing manifest data, and explicit remember or forget signals. It must
not include the full parent transcript, the parent system prompt, or hidden
parent prompt context.

This boundary keeps durable extraction from being polluted by old parent context
or unrelated run history.

## Experience memory

Experience memory is for reusable operational knowledge:

- successful procedures
- failure patterns
- debugging lessons
- workflow patterns
- applicability boundaries

The normal automatic path writes eligible completed turns directly to Hindsight
experience. Manual or maintenance experience extraction can still use the
`experience` special agent, but it is not the default turn-end writer.

## Session summary

Session summaries are local continuity artifacts. They help compaction replace
older transcript history with a concise summary while preserving the recent tail.

Session summary maintenance is separate from durable and experience memory:

- it is keyed by session scope
- it writes under `memory/session-summary`
- it is consumed by compaction
- it is not automatically promoted into durable memory

## Dream consolidation

Dream consolidation is the lower-frequency reflection layer. The automatic path
uses Hindsight reflection over recent session summaries and stores synthesized
content in `mental-models`.

The `dream` special agent remains available as a manual maintenance surface with
a narrow memory-maintenance tool policy. It does not inherit parent transcript
context.

## Context Archive

Context Archive is the replay-oriented record layer for agent runs. It captures:

- model-visible context
- tool admission decisions
- tool results
- runtime events and outcomes

Context Archive is distinct from memory. It is evidence for replay and
inspection, not prompt-time recall storage.

## Further reading

- [Memory configuration reference](/reference/memory-config)
- [Builtin Memory Runtime](/concepts/memory-builtin)
- [Session vs Memory](/concepts/session-vs-memory)
- [Memory vs Skill](/concepts/memory-vs-skill)
- [Compaction](/concepts/compaction)
