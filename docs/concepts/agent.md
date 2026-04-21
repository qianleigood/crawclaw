---
summary: "Agent runtime, workspace contract, and session bootstrap"
read_when:
  - Changing agent runtime, workspace bootstrap, or session behavior
title: "Agent Runtime"
---

# Agent Runtime

CrawClaw runs a task-backed embedded agent runtime for each active run, while
supporting multiple configured top-level agents plus spawned sub-agent and ACP
child runs.

## Workspace (required)

Each configured agent resolves its own workspace directory. The default agent
uses `agents.defaults.workspace`; other top-level agents can override that with
their own workspace settings. A run uses its resolved agent workspace as the
primary working directory (`cwd`) for tools and context.

Recommended: use `crawclaw setup` to create `~/.crawclaw/crawclaw.json` if missing and initialize the workspace files.

Full workspace layout + backup guide: [Agent workspace](/concepts/agent-workspace)

If `agents.defaults.sandbox` is enabled, non-main sessions can override this with
per-session workspaces under `agents.defaults.sandbox.workspaceRoot` (see
[Gateway configuration](/gateway/configuration)).

## Bootstrap files (injected)

Inside an agent workspace, CrawClaw keeps several user-editable files, but the
default runtime bootstrap injection is intentionally narrow:

- `AGENTS.md` — injected for normal runs
- `HEARTBEAT.md` — injected for heartbeat runs when lightweight context is enabled

Other workspace files such as `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`,
and `BOOTSTRAP.md` may still exist for workspace management, but they are not
part of the default runtime injection path.

Blank files are skipped. Large files are trimmed and truncated with a marker so prompts stay lean (read the file for full content).

If the active bootstrap file is missing, CrawClaw injects a single “missing file” marker line (and `crawclaw setup` will create a safe default template).

`BOOTSTRAP.md` is only created for a **brand new workspace** (no other bootstrap files present). If you delete it after completing the ritual, it should not be recreated on later restarts.

To disable bootstrap file creation entirely (for pre-seeded workspaces), set:

```json5
{ agent: { skipBootstrap: true } }
```

## Built-in tools

Core tools (read/exec/edit/write and related system tools) are always available,
subject to tool policy. `apply_patch` is optional and gated by
`tools.exec.applyPatch`. `TOOLS.md` does **not** control which tools exist; it’s
guidance for how _you_ want them used.

## Skills

CrawClaw loads skills from three locations (workspace wins on name conflict):

- Bundled (shipped with the install)
- Managed/local: `~/.crawclaw/skills`
- Workspace: `<workspace>/skills`

Skills can be gated by config/env (see `skills` in [Gateway configuration](/gateway/configuration)).

## Runtime boundaries

The embedded agent runtime is built on the Pi agent core (models, tools, and
prompt pipeline). Session management, discovery, tool wiring, and channel
delivery are CrawClaw-owned layers on top of that core.

## Task-backed runtime

CrawClaw now treats agent runs as task-backed runtime units instead of anonymous
session side effects.

- Foreground runs, sub-agent runs, and ACP runs can all be represented as task
  records.
- Each run keeps runtime metadata such as `agentId`, `parentAgentId`, mode
  (`foreground` / `background`), session refs, and spawn source.
- Runtime progress is tracked through shared agent events, then reflected into
  task state.
- Resume logic can fall back to agent runtime metadata when a plain session
  lookup is not enough.
- Inspection and ops tooling read the same persisted runtime/task metadata
  through `crawclaw agent inspect`, `crawclaw agents status`, and the gateway
  `agent.inspect` RPC.

## Context Archive

Task-backed runs can also be captured into Context Archive.

- `agent inspect` can surface archive refs, query-context diagnostics, and a
  compact run timeline reconstructed from archived lifecycle events
- `agent export-context` can export matching archive runs as a replay/debug
  bundle
- Context Archive keeps the replay-oriented truth layer for model-visible
  context, tool decisions, and post-turn completion state

This is separate from normal session transcripts. Transcripts remain the
product-facing conversation log; Context Archive is the replay/export layer.

## Verification agent

CrawClaw also supports a specialized verification agent path for “try to break
it” validation before a task is considered truly done.

- The user-facing entrypoint is the chat command `/verify [task]`.
- Internally, `/verify` enters a dedicated verification flow, which spawns a
  task-backed sub-agent with `spawnSource: "verification"`.
- `/verify` is the only public verification entrypoint.
- Verification runs use a dedicated system prompt and a restricted validation
  toolset rather than inheriting the full parent tool surface.
- Verification runs are intentionally read-only: they can inspect, run checks,
  and produce a verdict, but they cannot patch files or recursively spawn more
  verification runs.
- A `VERDICT: PASS` result can be recorded as completion evidence and then
  aggregated back into the parent task trajectory.

## Sessions

Session transcripts are stored as JSONL at:

- `~/.crawclaw/agents/<agentId>/sessions/<SessionId>.jsonl`

The session ID is stable and chosen by CrawClaw.
Legacy session folders from other tools are not read.

Task-backed runs also persist runtime metadata and completion traces under:

- `~/.crawclaw/agents/<agentId>/tasks/<TaskId>.json`
- `~/.crawclaw/agents/<agentId>/tasks/<TaskId>.trajectory.json`
- `~/.crawclaw/agents/<agentId>/tasks/<TaskId>.capabilities.json`

The task JSON stores runtime metadata (session refs, mode, parent/child agent
links, spawn source). The trajectory JSON stores step traces, completion
evidence, and completion-guard output. The capability snapshot stores the
runtime-facing execution envelope (runtime, model, sandbox, workspace, and
requester refs) used by guard and inspection.

## Steering while streaming

When queue mode is `steer`, inbound messages are injected into the current run.
Queued steering is delivered **after the current assistant turn finishes
executing its tool calls**, before the next LLM call. Steering no longer skips
remaining tool calls from the current assistant message; it injects the queued
message at the next model boundary instead.

When queue mode is `followup` or `collect`, inbound messages are held until the
current turn ends, then a new agent turn starts with the queued payloads. See
[Queue](/concepts/queue) for mode + debounce/cap behavior.

Block streaming sends completed assistant blocks as soon as they finish; it is
**off by default** (`agents.defaults.blockStreamingDefault: "off"`).
Tune the boundary via `agents.defaults.blockStreamingBreak` (`text_end` vs `message_end`; defaults to text_end).
Control soft block chunking with `agents.defaults.blockStreamingChunk` (defaults to
800–1200 chars; prefers paragraph breaks, then newlines; sentences last).
Coalesce streamed chunks with `agents.defaults.blockStreamingCoalesce` to reduce
single-line spam (idle-based merging before send). Non-Telegram channels require
explicit `*.blockStreaming: true` to enable block replies.
Verbose tool summaries are emitted at tool start (no debounce); browser clients
streams tool output via agent events when available.
More details: [Streaming + chunking](/concepts/streaming).

## Model refs

Model refs in config (for example `agents.defaults.model` and `agents.defaults.models`) are parsed by splitting on the **first** `/`.

- Use `provider/model` when configuring models.
- If the model ID itself contains `/` (OpenRouter-style), include the provider prefix (example: `openrouter/moonshotai/kimi-k2`).
- If you omit the provider, CrawClaw treats the input as an alias or a model for the **default provider** (only works when there is no `/` in the model ID).

## Configuration (minimal)

At minimum, set:

- `agents.defaults.workspace`
- `channels.whatsapp.allowFrom` (strongly recommended)

---

_Next: [Group Chats](/channels/group-messages)_ 🦀
