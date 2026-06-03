---
read_when:
  - You want the current durable-memory architecture
  - You want to know which Claude Code memory ideas CrawClaw intentionally adopted
  - You want guardrails against parent-context pollution in memory agents
summary: "Current durable memory architecture and anti-regression guardrails"
title: "Durable Memory Refactor Status"
---

# Durable Memory Refactor Status

This page is the source-grounded status record for CrawClaw durable-memory
maintenance.

CrawClaw intentionally adopts Claude Code's separation between main response
generation and memory maintenance, but keeps CrawClaw's Hindsight memory
substrate instead of copying Claude Code's file-native memory writer.

## Reference Behavior

Claude Code is the reference for these durable-memory ideas:

- memory maintenance should not be part of the main reply text path
- extraction should operate on model-visible conversation evidence
- stable feedback can be corrective or reinforcing
- memory maintenance should be a constrained agent/tool surface
- long-lived memory should not come from arbitrary hidden context

The alignment point is the architecture, not the raw storage layer. Claude Code
writes memory files through restricted file tools. CrawClaw writes Hindsight
records through native memory tools whose layer access is enforced by the
runtime.

## Current CrawClaw Shape

The current runtime has these memory paths:

- `memory.afterTurn` records runtime-store rows.
- Eligible completed turns are queued in the memory outbox and later retained
  into Hindsight `experience` by the outbox worker.
- `durable-memory` is a special agent with a narrow `memory_delta` input
  contract.
- `durable-memory` does not inherit parent transcript or parent prompt context.
- `durable-memory` writes only the Hindsight `durable` layer.
- `dream` consolidates only into `mental-models`.
- `session-summary` handles compaction/session continuity.

There is not currently a landed automatic per-turn durable extraction scheduler.
That means the current durable-memory status is:

- special-agent definition: landed
- narrow `contextPackage` handoff: landed
- memory-layer enforcement: landed
- automatic stop-phase durable extraction cursor: future work
- Action Feed / Context Archive observability for automatic durable extraction:
  future work

## Parent Context Guardrail

The most important anti-regression rule is:

**do not let `durable-memory` inherit parent context.**

`durable-memory` declares `parentContextPolicy: "none"`. If a caller supplies
`parentSessionKey`, the gateway uses it only when the selected special-agent
definition allows parent context. For memory-maintenance agents, the gateway
uses a fresh `special:{kind}:{runId}` session key and passes a structured
`contextPackage` in the task body.

This prevents accidental durable-memory writes from:

- earlier parent transcript content
- hidden prompt extras
- tool output that was not selected for memory extraction
- unrelated session history

## Recall And Consolidation

Durable recall is prompt-time read behavior, separate from durable writing.

`memory.hindsight.memoryMode` controls whether Hindsight recall is injected into
the prompt, exposed only through tools, or both. Prompt recall is disabled in
`tools` mode. Knowledge tools are disabled in `context` mode.

`dream` remains the slower consolidation layer. It is a separate special agent
that works in the `mental-models` layer and does not replace durable-memory
extraction.

## Future Durable Extraction Contract

If automatic durable extraction is added, it should:

- run after a stable top-level turn ends
- process only selected model-visible messages since an extraction cursor
- skip when the turn already performed explicit durable write/delete
- not skip just because the turn wrote `experience`
- pass a structured `contextPackage` to `durable-memory`
- advance the cursor only after success or an intentional policy skip
- record enough evidence for inspection and replay

Do not reintroduce an in-process prompt-time durable writer hidden behind
`afterTurn`.

## Relevant Files

- `crates/crawclaw-runtime/src/memory/mod.rs`
- `crates/crawclaw-runtime/src/memory/config.rs`
- `crates/crawclaw-runtime/src/special_agents.rs`
- `crates/crawclaw-runtime/src/core_tools/core_tools_special_agents.rs`
- `crates/crawclaw-gateway/src/gateway_chat.rs`
