---
read_when:
  - You want the current durable-memory auto-write architecture
  - You want to know which Claude Code ideas CrawClaw intentionally adopted
  - You want guardrails against reintroducing the old durable extraction path
summary: Current durable memory agent architecture and anti-regression guardrails
title: Durable Memory Refactor Status
---

# Durable Memory Refactor Status

This page is the source-grounded status record for CrawClaw durable-memory
auto-write. CrawClaw intentionally aligns with Claude Code's durable-memory
mechanics, while keeping CrawClaw's scoped memory tools and Action Feed runtime
surface.

## Reference Behavior

Claude Code is the reference for five durable-memory rules:

- run extraction after the top-level turn has ended
- process only model-visible `user` and `assistant` messages since the last
  extraction cursor
- skip background extraction when the main conversation already wrote memory
- treat `feedback` as both corrective and reinforcing guidance
- run memory maintenance in a forked agent that can see the parent conversation
  context while the maintenance prompt keeps the work narrow

The alignment point is the mechanism, not the raw tool implementation. Claude's
fork writes files with ordinary file tools restricted by `canUseTool`; CrawClaw's
fork writes through scoped durable memory tools so the same boundary is enforced
by the host.

Claude also has a heavier consolidation path. In CrawClaw that role is handled
by `dream`, not by the per-turn durable memory agent.

## Current CrawClaw Shape

Durable auto-write is now a turn-end background maintenance flow:

- the run loop emits a `stop` lifecycle phase after a final top-level turn
- `durable_memory` subscribes to that phase
- subagent sessions are ignored by the durable extraction worker
- the worker reads model-visible messages from the runtime store using the
  durable extraction cursor
- explicit durable writes/deletes suppress background extraction for that turn
- `write_experience_note` does not suppress durable extraction, because experience
  notes and durable collaboration memory are separate layers
- cursor advancement happens only after the turn is handled or intentionally
  skipped

The durable memory agent runs as an embedded special agent:

- lifecycle metadata may provide a captured parent fork context
- `durable_memory` declares `parentContextPolicy: "fork_messages_only"`, so the
  embedded run receives only the forked model-visible messages and does not
  attach the parent prompt envelope
- the durable extraction task prompt still makes the cursor-based recent window
  authoritative for candidate memories
- older forked context may resolve references in recent messages, but it is not
  a source for re-extracting old history
- scoped durable-memory tools constrain writes to the resolved durable scope

The automatic durable write path is now `durable_memory`. Do not reintroduce
the old in-process structured extraction worker as a hidden prompt-time writer.

## Recall And Consolidation

Durable recall is prompt-time read behavior, separate from writing:

- `MEMORY.md` is the first durable index surface for a scope
- note header metadata is the next selector layer
- the body index cache gives weak-header notes a cheap way to enter candidate
  ranking
- only a bounded candidate slice reads body excerpts for rerank
- selected-note diagnostics record `index`, `header`, `body_index`, and
  `body_rerank` provenance
- prompt assembly can shift a small budget share toward or away from durable
  memory based on query classification and durable score strength

`dream` remains the slower consolidation layer. It is enabled by default, but
run startup is still gated by minimum-session, minimum-hour, scan-throttle, and
per-scope `.consolidate-lock` file checks. It can repair, dedupe, and improve
durable notes, but it does not replace per-turn extraction.

Promotion is governance, not recall. Promotion candidates are marked as
`surface: governance_only` so they cannot become a hidden prompt-time recall
path.

## Do Not Reintroduce

Avoid these older behaviors:

- scheduling durable extraction directly from generic `afterTurn` ingestion
- defining the extraction window as the last N messages from the new in-memory
  turn slice
- treating `write_experience_note` as a reason to suppress durable extraction
- letting subagent sessions auto-write durable memory by default
- giving the durable memory agent unrestricted project or shell access
- stuffing full `MEMORY.md` contents into the system prompt as the durable recall
  strategy
- making promotion candidates a third prompt-time recall layer

## Relevant Files

- `src/memory/durable/lifecycle-subscriber.ts`
- `src/memory/durable/worker-manager.ts`
- `src/memory/durable/agent-runner.ts`
- `src/memory/durable/read.ts`
- `src/memory/durable/body-index.ts`
- `src/memory/dreaming/auto-dream.ts`
- `src/memory/orchestration/context-assembler.ts`
- `src/memory/engine/context-memory-runtime-recall.ts`
