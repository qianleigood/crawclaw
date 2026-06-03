---
title: "Special-Agent Substrate"
summary: "Shared runtime substrate for CrawClaw special agents"
read_when:
  - You are changing special-agent spawning or transcript policy
  - You are auditing special-agent runtime behavior
---

# Special-Agent Substrate

CrawClaw uses a shared Rust special-agent substrate for built-in agents that
need stricter runtime policy than ordinary user-selected task agents.

The substrate is intentionally small. It owns the execution contract, transcript
handoff rules, tool allowlists, and memory-layer policy. Each special agent still
owns its prompt, result semantics, and persistence behavior.

## Runtime Boundary

The canonical registry lives in `crates/crawclaw-runtime/src/special_agents.rs`.

Each `SpecialAgentDefinition` declares:

- `id` and `spawnSource`
- `executionMode`: `spawned_session` or `embedded_fork`
- transcript policy
- parent-context policy
- tool allowlist
- optional memory-maintenance guard
- timeout and max-turn limits
- input and output contracts
- persistence handler
- memory-layer policy

The runtime uses those declarations to build a profile-specific native tool
registry. Memory-maintenance agents do not just rely on prompt wording; their
Hindsight tools are constrained to the layer declared by their special-agent
definition.

## Current Agents

| Agent             | Mode              | Parent context       | Input contract       | Memory layer         |
| ----------------- | ----------------- | -------------------- | -------------------- | -------------------- |
| `session-summary` | `embedded_fork`   | `full_envelope`      | `session_summary`    | none                 |
| `durable-memory`  | `embedded_fork`   | `none`               | `memory_delta`       | `durable` only       |
| `experience`      | `embedded_fork`   | `none`               | `manual_maintenance` | `experience` only    |
| `dream`           | `embedded_fork`   | `none`               | `manual_maintenance` | `mental-models` only |
| `review-spec`     | `spawned_session` | `fork_messages_only` | none                 | none                 |
| `review-quality`  | `spawned_session` | `fork_messages_only` | none                 | none                 |

User-visible task agents, such as `general-purpose`, `Explore`, `Plan`, and
`verification`, live in the Rust task-agent definition layer. They are not
special agents and do not receive memory-maintenance-only tools.

## Parent Context Rules

Parent context is an explicit definition-level decision:

- `none` means the run must not inherit the parent transcript or prompt envelope.
- `fork_messages_only` allows only the selected fork-message handoff.
- `full_envelope` allows a full parent handoff where the agent is designed to
  summarize session continuity.

This matters most for memory agents. `durable-memory`, `experience`, and
`dream` run with `parentContextPolicy: "none"` so they cannot accidentally turn
parent context into durable or cross-session memory. `durable-memory` receives a
structured `contextPackage` instead of a parent transcript.

The gateway also gives memory-maintenance special agents a fresh run-scoped
session key in the form `special:{kind}:{runId}`. That keeps their transcripts
separate from the parent session even when a caller supplied `parentSessionKey`
for correlation.

## Tool And Layer Policy

Special-agent tool policy has two parts:

- the definition-level allowlist decides which native tools are visible
- the memory-layer policy decides which Hindsight layer those tools may touch

For example:

- `durable-memory` can use `knowledge_recall` and `knowledge_ingest`, but only
  against the `durable` layer.
- `experience` can write only `experience` notes.
- `dream` can work only with `mental-models`.
- review agents do not receive Hindsight maintenance tools.

This is the key difference from a prompt-only restriction. Even if a model asks
for another layer, the special-agent tool wrapper resolves or rejects the layer
according to the active special-agent profile.

## Memory Runtime Relationship

Hindsight is the memory substrate:

- `durable` stores stable user/project preference and collaboration context.
- `experience` stores reusable operational lessons.
- `resource` stores external or reference material.
- `mental-models` stores distilled patterns produced by dream-style
  consolidation.

Normal `memory.afterTurn` writes runtime-store rows and enqueues eligible
completed turns for Hindsight `experience` retain through the memory outbox. It
is not the automatic durable-memory extraction path.

`session-summary` is the compaction/session-continuity agent. It is the only
current memory special agent that is allowed a full parent handoff, because its
job is explicitly to summarize session state.

## Claude Code Alignment

CrawClaw and Claude Code now share the same broad shape:

- special agents have explicit runtime definitions
- maintenance agents are isolated from ordinary user task agents
- parent context is a policy decision instead of an implicit inheritance
- tool access is scoped per agent
- memory maintenance is separated from main-agent response generation

The important differences are intentional:

- CrawClaw uses Hindsight layers instead of file-native memory directories.
- CrawClaw constrains memory tools by declared layer policy.
- CrawClaw passes structured packages to memory agents when narrow input is
  required, instead of replaying the parent query loop as a cloned process.
- CrawClaw keeps session summaries, experience retention, durable memory, and
  dream consolidation as separate maintenance surfaces.

## Design Rules

When adding a special agent:

- Use a normal task-agent definition unless the agent needs special runtime
  policy.
- Declare the narrowest parent-context policy that can work.
- For memory-maintenance agents, declare an explicit input contract and memory
  layer policy.
- Keep provider/model/cache behavior out of the special-agent contract unless
  the runtime actually enforces it.
- Add tests for the policy boundary, not just prompt text.
