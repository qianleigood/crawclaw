---
summary: "Agent loop lifecycle, streams, and wait semantics"
read_when:
  - You need an exact walkthrough of the agent loop or lifecycle events
title: "Agent Loop"
---

# Agent Loop (CrawClaw)

An agentic loop is the full “real” run of an agent: intake → context assembly → model inference →
tool execution → streaming replies → persistence. It’s the authoritative path that turns a message
into actions and a final reply, while keeping session state consistent.

In CrawClaw, a loop is a single, serialized run per session that emits lifecycle and stream events
as the model thinks, calls tools, and streams output. This doc explains how that authentic loop is
wired end-to-end.

## Entry points

- Gateway RPC: `agent` and `agent.wait`.
- CLI: `agent` command.

## How it works (high-level)

1. `agent` RPC validates params, resolves session (sessionKey/sessionId), persists session metadata, returns `{ runId, acceptedAt }` immediately.
2. `agentCommand` runs the agent:
   - resolves model + thinking/verbose defaults
   - registers run context + runtime state for this run
   - loads skills snapshot
   - calls `runEmbeddedPiAgent` (pi-agent-core runtime)
   - emits **lifecycle end/error** if the embedded loop does not emit one
3. `runEmbeddedPiAgent`:
   - serializes runs via per-session + global queues
   - resolves model + auth profile and builds the pi session
   - subscribes to pi events and streams assistant/tool deltas
   - enforces timeout -> aborts run if exceeded
   - returns payloads + usage metadata
4. `subscribeEmbeddedPiSession` bridges pi-agent-core events to CrawClaw `agent` stream:
   - tool events => `stream: "tool"`
   - assistant deltas => `stream: "assistant"`
   - lifecycle events => `stream: "lifecycle"` (`phase: "start" | "end" | "error"`)
   - runtime progress => task-backed agent progress updates
5. `agent.wait` uses `waitForAgentJob`:
   - waits for **lifecycle end/error** for `runId`
   - returns `{ status: ok|error|timeout, startedAt, endedAt, error? }`

## Runtime state + task tracking

Every run now has a shared runtime identity:

- `run context`: binds `runId` to `sessionKey`, `sessionId`, `agentId`,
  optional `parentAgentId`, and optional task metadata
- `runtime state`: tracks status, current step, tool counts, last heartbeat,
  and terminal outcome
- `task record`: persists detached/background runs so sub-agents and ACP runs
  can be resumed, audited, and inspected outside the live stream

This is the common base for native sub-agents, ACP sessions, guard decisions,
completion evaluation, and loop policy.

## Sub-agent and ACP boundaries

Child runs do not all share the same state:

- **Native sub-agents** start a new CrawClaw session and task. They receive a
  task-specific child prompt and lineage metadata, not the full parent
  transcript.
- **Session memory** stays isolated because it is keyed by `sessionId`.
- **Durable memory** can be shared across parent and child runs when they
  resolve to the same `agentId` scope.
- **Experience recall** is queried from the same NotebookLM backend during prompt
  assembly; it is not partitioned by session id.
- **Workspace inheritance** is same-agent by default. Cross-agent spawns switch
  to the target agent's workspace instead of blindly inheriting the caller's.
- **ACP runs** are task-backed and inspection-visible from CrawClaw's point of
  view, but the harness's internal context and memory stay backend-owned.

## Inspection snapshot

CrawClaw now also exposes a runtime inspection seam for task-backed runs. A
single inspection snapshot can aggregate:

- runtime state (`runId`, status, current step, tool counts)
- task record + task refs
- persisted runtime metadata
- capability snapshot / guard context
- trajectory + completion result
- recent loop summary from the diagnostic cache

This is meant for debugging, replay analysis, and future operator tooling. It
does not replace the live event stream; it provides a consistent read model for
the state that the loop, guard, and completion systems already persist.

Operational surfaces built on this snapshot today:

- `crawclaw agent inspect`
- `crawclaw agents status`
- `crawclaw agents harness report`
- `crawclaw agents harness promote-check`
- gateway RPC `agent.inspect`

`agent inspect` now also reconstructs a compact lifecycle timeline from archived
`run.lifecycle.*` events, so provider/tool/subagent/compaction decisions can be
read back from one inspection surface instead of stitching together multiple
debug logs.

## Queueing + concurrency

- Runs are serialized per session key (session lane) and optionally through a global lane.
- This prevents tool/session races and keeps session history consistent.
- Messaging channels can choose queue modes (collect/steer/followup) that feed this lane system.
  See [Command Queue](/concepts/queue).

## Session + workspace preparation

- Workspace is resolved and created; sandboxed runs may redirect to a sandbox workspace root.
- Skills are loaded (or reused from a snapshot) and injected into env and prompt.
- Bootstrap/context files are resolved and injected into the system prompt report.
- A session write lock is acquired; `SessionManager` is opened and prepared before streaming.

## Prompt assembly + system prompt

- System prompt is built from CrawClaw’s base prompt, skills prompt, bootstrap context, and per-run overrides.
- Model-specific limits and compaction reserve tokens are enforced.
- See [System prompt](/concepts/system-prompt) for what the model sees.

## Hook points (where you can intercept)

CrawClaw has two hook systems:

- **Internal hooks** (Gateway hooks): event-driven scripts for commands and lifecycle events.
- **Plugin hooks**: extension points inside the agent/tool lifecycle and gateway pipeline.

### Internal hooks (Gateway hooks)

- **`agent:bootstrap`**: runs while building bootstrap files before the system prompt is finalized.
  Use this to add/remove bootstrap context files.
- **Command hooks**: `/new`, `/stop`, and other command events (see Hooks doc).

See [Hooks](/automation/hooks) for setup and examples.

### Plugin hooks (agent + gateway lifecycle)

These run inside the agent loop or gateway pipeline:

- **`before_model_resolve`**: runs pre-session (no `messages`) to deterministically override provider/model before model resolution.
- **`before_prompt_build`**: runs after session load (with `messages`) to return a structured `queryContextPatch` before prompt submission. Use `prependUserContextSections` for per-turn dynamic text, `replaceSystemPromptSections` for full system-prompt overrides, and `prependSystemContextSections` / `appendSystemContextSections` for stable guidance that should sit in system-context space.
- **`before_model_resolve` / `before_prompt_build`**: the active pre-run hook phases. Model/provider selection and prompt-context mutation now flow through these two hooks only.
- **`before_agent_reply`**: runs after inline actions and before the LLM call, letting a plugin claim the turn and return a synthetic reply or silence the turn entirely.
- **`agent_end`**: inspect the final message list and run metadata after completion.
- **`before_compaction` / `after_compaction`**: observe or annotate compaction cycles.
- **`before_tool_call` / `after_tool_call`**: intercept tool params/results.
- **`before_install`**: inspect built-in scan findings and optionally block skill or plugin installs.
- **`tool_result_persist`**: synchronously transform tool results before they are written to the session transcript.
- **`message_received` / `message_sending` / `message_sent`**: inbound + outbound message hooks.
- **`session_start` / `session_end`**: session lifecycle boundaries.
- **`gateway_start` / `gateway_stop`**: gateway lifecycle events.

Hook decision rules for outbound/tool guards:

- `before_tool_call`: `{ block: true }` is terminal and stops lower-priority handlers.
- `before_tool_call`: `{ block: false }` is a no-op and does not clear a prior block.
- `before_install`: `{ block: true }` is terminal and stops lower-priority handlers.
- `before_install`: `{ block: false }` is a no-op and does not clear a prior block.
- `message_sending`: `{ cancel: true }` is terminal and stops lower-priority handlers.
- `message_sending`: `{ cancel: false }` is a no-op and does not clear a prior cancel.

See [Plugin hooks](/plugins/architecture#provider-runtime-hooks) for the hook API and registration details.

## Streaming + partial replies

- Assistant deltas are streamed from pi-agent-core and emitted as `assistant` events.
- Block streaming can emit partial replies either on `text_end` or `message_end`.
- Reasoning streaming can be emitted as a separate stream or as block replies.
- See [Streaming](/concepts/streaming) for chunking and block reply behavior.

## Tool execution + messaging tools

- Tool start/update/end events are emitted on the `tool` stream.
- Tool results are sanitized for size and image payloads before logging/emitting.
- Messaging tool sends are tracked to suppress duplicate assistant confirmations.

## Completion + trajectory

Task-backed runs now maintain a trajectory file that records:

- tool steps
- assistant output snapshots
- completion evidence such as `answer_provided`, `file_changed`,
  `test_passed`, `assertion_met`, and `user_confirmed`

When a task-backed run reaches a terminal state, CrawClaw evaluates a
completion guard and stores the result with the trajectory. This does not
replace the live agent loop; it adds a structured completion record for
inspection and replay.

Loop progress is tracked the same way: each tool call contributes a normalized
progress envelope, and the live runtime, replay harness, and policy layer all
consume that same envelope history. The diagnostic session cache only mirrors a
recent window for inspection; it is no longer the source of truth for loop
state.

Harness tooling can now build summary reports and baseline/candidate diffs from
captured scenarios, so loop and completion changes can be compared against the
same normalized runtime data before they ship. A lightweight promotion gate can
then classify a candidate as `promote`, `shadow`, or `reject` based on those
diffs, giving policy and skill experiments an offline acceptance path before
they affect live runs.

## Reply shaping + suppression

- Final payloads are assembled from:
  - assistant text (and optional reasoning)
  - inline tool summaries (when verbose + allowed)
  - assistant error text when the model errors
- `NO_REPLY` is treated as a silent token and filtered from outgoing payloads.
- Messaging tool duplicates are removed from the final payload list.
- If no renderable payloads remain and a tool errored, a fallback tool error reply is emitted
  (unless a messaging tool already sent a user-visible reply).

## Compaction + retries

- Auto-compaction emits `compaction` stream events and can trigger a retry.
- On retry, in-memory buffers and tool summaries are reset to avoid duplicate output.
- See [Compaction](/concepts/compaction) for the compaction pipeline.

## Event streams (today)

- `lifecycle`: emitted by `subscribeEmbeddedPiSession` (and as a fallback by `agentCommand`)
- `assistant`: streamed deltas from pi-agent-core
- `tool`: streamed tool events from pi-agent-core

Internally, runtime progress events also feed task state and task trajectories,
but those are persisted as runtime metadata rather than exposed as a separate
public stream today.

## Chat channel handling

- Assistant deltas are buffered into chat `delta` messages.
- A chat `final` is emitted on **lifecycle end/error**.

## Timeouts

- `agent.wait` default: 30s (just the wait). `timeoutMs` param overrides.
- Agent runtime: `agents.defaults.timeoutSeconds` default 172800s (48 hours); enforced in `runEmbeddedPiAgent` abort timer.

## Where things can end early

- Agent timeout (abort)
- AbortSignal (cancel)
- Gateway disconnect or RPC timeout
- `agent.wait` timeout (wait-only, does not stop agent)

## Loop policy

Loop detection still runs before tool calls, but the action layer is now more
structured:

- `warn`: keep going, record the signal
- `nudge`: keep going, but signal no-progress / ping-pong behavior
- `soft_block_exact_repeat`: block exact repeated no-progress calls
- `require_plan_refresh`: block and force the caller to revise its next step

The detector still uses thresholds and pattern matching, but the policy layer no
longer treats every critical result as the same generic block.

## Related

- [Tools](/tools) — available agent tools
- [Hooks](/automation/hooks) — event-driven scripts triggered by agent lifecycle events
- [Compaction](/concepts/compaction) — how long conversations are summarized
- [Exec Approvals](/tools/exec-approvals) — approval gates for shell commands
- [Thinking](/tools/thinking) — thinking/reasoning level configuration
