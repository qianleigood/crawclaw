---
title: "Rust Agent Runtime Architecture"
summary: "Architecture of CrawClaw's Rust-owned agent runtime and session lifecycle"
read_when:
  - Understanding agent runtime ownership in CrawClaw
  - Modifying agent session lifecycle, tooling, cron, auto-reply, command, special-agent, or memory flows
---

# Rust Agent Runtime Architecture

CrawClaw agent execution is owned by the Rust runtime. The old TypeScript
agent runner is not a production execution path.

This page describes the current runtime boundary for agent turns, session
state, provider transport, special agents, cron jobs, auto-reply, commands, and
memory lifecycle work.

## Ownership

The Rust runtime owns:

- Agent turn execution through `AgentRuntime`.
- Provider metadata, model defaults, auth choices, transport capabilities, and
  runtime provider calls.
- Session binding, transcript writes, run ids, event projection, usage metadata,
  and abort or timeout handling.
- Cron `agentTurn` jobs, auto-reply turns, command turns, special-agent runs,
  and memory jobs.
- Durable memory extraction, experience extraction, dream jobs, session
  summaries, assembly, compaction, and after-turn ingest.

TypeScript remains only for the desktop renderer. It must not re-enter an
agent execution bridge, channel adapter, provider runtime, or fallback runner.

## Gateway Entry Points

The public runtime entry points are Gateway RPC methods backed by Rust:

- `agent.runTurn`
- `agent.command.run`
- `autoReply.run`
- cron `agentTurn` payload execution
- memory RPCs such as `memory.bootstrap`, `memory.ingestBatch`,
  `memory.assemble`, `memory.compact`, `memory.dream.*`,
  `memory.session_summary.*`, and `memory.experience.*`
- special-agent runtime methods exposed by the Rust gateway

These methods normalize request metadata and call the same Rust runtime core so
session, transcript, tools, model selection, cancellation, and memory handling
stay consistent across entry points.

## Runtime Flow

1. Gateway receives a typed request and validates the session, trigger, channel,
   message, model, provider, reasoning, and run metadata.
2. Rust resolves provider and model configuration from the Rust provider
   registry.
3. Rust assembles the effective session context, transcript, memory inputs,
   system prompt, and tool inventory.
4. Rust executes the model turn, streams events, records usage, and handles tool
   payloads.
5. Rust writes transcript entries and emits delivery-ready reply payloads.
6. Rust triggers after-turn memory ingest when the request is a persistent
   session turn.

Ephemeral command modes, such as `/btw`, can opt out of transcript writes and
after-turn ingest while still using the Rust command runtime.

## Sessions And Queues

Runs are serialized by session key. The runtime uses the session key as the
lane identity so one user session cannot have overlapping active turns.

Higher-level entry points can also use a global concurrency cap. Cron,
auto-reply, command, and special-agent runs all bind into the same runtime
identity model so run metadata, cancellation, and status reporting do not fork
by trigger type.

## Tools

The tool inventory is resolved before each Rust turn. TypeScript does not host
channel adapters, tool payload projection, or the agent loop.

Tool payloads returned by Rust are projected into Gateway and channel-specific
delivery formats. Channel plugins should call their documented SDK or Gateway
client surfaces instead of importing agent internals.

## Memory

Memory work is Rust-native:

- after-turn ingest
- durable extraction
- experience extraction
- dream jobs
- session summaries
- memory assembly
- memory compaction

Memory jobs use Rust special-agent or Rust agent runtime definitions.
Production memory paths must not call legacy TypeScript memory jobs.

## Special Agents

Special agents are defined and executed by the Rust runtime. Definitions include
tool allowlists, parent context policy, timeout, maximum turns, result detail,
and action-feed behavior.

The `runtime_fork` semantic is an internal Rust runtime fork. It does not call
a TypeScript special-agent runner.

## Cron And Auto Reply

Cron scheduling, store access, due-run handling, manual runs, run logs, webhook
delivery, and `agentTurn` execution are Rust-owned.

Auto-reply trigger handling routes to the Rust runtime through `autoReply.run`.
Reply routing, dedupe, typing/status events, follow-up behavior, transcript
projection, sendable parts, and memory triggers are handled on the Rust runtime
side or by thin Gateway/channel projection code.

## Compatibility Boundary

Removed TypeScript execution surfaces include:

- legacy TypeScript agent runners
- typed plugin hook runners
- legacy provider runtime registration
- TypeScript special-agent runners
- TypeScript cron isolated-agent runners
- TypeScript auto-reply agent runners
- legacy TypeScript memory jobs

If a caller needs an agent turn, it must use a Rust-backed Gateway/runtime
method. There is no TypeScript fallback bridge.

## Tests

Use Rust runtime gates for execution behavior:

```bash
cargo test -p crawclaw-runtime agent_runtime
cargo test -p crawclaw-runtime cron
cargo test -p crawclaw-runtime memory
cargo test -p crawclaw-runtime special_agents
cargo test -p crawclaw-gateway agent_run_turn
```

Use TypeScript gates only for the desktop renderer and stale-reference cleanup:

```bash
pnpm tsgo
pnpm check
pnpm build
```
