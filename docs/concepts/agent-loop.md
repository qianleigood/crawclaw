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

- Gateway RPC: `agent.runTurn`, `agent.command.run`, `autoReply.run`, `agent`, and `agent.wait`.
- Desktop UI actions call the same Gateway RPC path.

## How it works (high-level)

1. Gateway RPC validates params, resolves session (`sessionKey`/`sessionId`), persists session metadata, and records `{ runId, acceptedAt }`.
2. The Rust `AgentRuntime` runs the turn:
   - resolves model + thinking/verbose defaults
   - registers run context + runtime state for this run
   - assembles context, tools, transcript, and memory inputs
   - emits stream, tool, usage, and transcript events
   - records memory ingest hooks after the turn
3. Rust runtime serialization:
   - serializes runs via per-session + global queues
   - resolves provider transport and model defaults from the Rust provider registry
   - streams assistant/tool deltas through gateway events
   - enforces timeout -> aborts run if exceeded
   - returns payloads + usage metadata
4. Gateway stream projection maps Rust runtime events to CrawClaw `agent` stream:
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
- **Experience recall** is queried from the same Hindsight backend during prompt
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

- CrawClaw Desktop runtime diagnostics
- gateway RPC `agent.inspect`

`agent.inspect` now also reconstructs a compact lifecycle timeline from archived
`run.lifecycle.*` events, so provider/tool/subagent/compaction decisions can be
read back from one inspection surface instead of stitching together multiple
debug logs.

## Queueing + concurrency

- Runs are serialized per session key (session lane) and optionally through a global lane.
- This prevents tool/session races and keeps session history consistent.
- Messaging channels can choose queue modes (collect/steer/followup) that feed this lane system.
  See [Command Queue](/concepts/queue).

## Session + workspace preparation

- Skills are loaded (or reused from a snapshot) and injected into env and prompt.
- Bootstrap/context files are resolved and injected into the system prompt report.
- A session write lock is acquired; `SessionManager` is opened and prepared before streaming.

## Prompt assembly + system prompt

- System prompt is built from CrawClaw’s base prompt, skills prompt, bootstrap context, and per-run overrides.
- Model-specific limits and compaction reserve tokens are enforced.
- See [System prompt](/concepts/system-prompt) for what the model sees.

## Hook points (where you can intercept)

CrawClaw's current public hook surface is the Gateway SDK lifecycle hook API.
Claude Code-compatible SDK clients register callback matchers during
`initialize`, and the Gateway calls them around session start, prompt submit,
tool use, permission checks, compaction, sub-agent runs, notifications, and
session end.

These hooks can add context to supported lifecycle points and can block or adjust
tool and permission flows. They are not a local TypeScript hook module loader,
and the removed typed Plugin SDK lifecycle hooks are no longer a third-party
plugin registration surface.

See [Hooks](/automation/hooks) for supported events and callback behavior.

### Runtime lifecycle

The agent loop still has runtime-owned lifecycle stages for model selection,
prompt assembly, tool execution, transcript persistence, compaction, and
outbound delivery. Internal Rust extension points may adapt these stages inside
the product runtime, but they are not a public plugin or local script API.

## Streaming + partial replies

- Assistant deltas are streamed from the Rust agent runtime and emitted as `assistant` events.
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

- `lifecycle`: emitted by `subscribeRustAgentSession` (and as a fallback by `agent.command.run`)
- `assistant`: streamed deltas from the Rust agent runtime
- `tool`: streamed tool events from the Rust agent runtime

Internally, runtime progress events also feed task state and task trajectories,
but those are persisted as runtime metadata rather than exposed as a separate
public stream today.

## Chat channel handling

- Assistant deltas are buffered into chat `delta` messages.
- A chat `final` is emitted on **lifecycle end/error**.

## Timeouts

- `agent.wait` default: 30s (just the wait). `timeoutMs` param overrides.
- Agent runtime: `agents.defaults.timeoutSeconds` default 172800s (48 hours); enforced by the Rust runtime abort timer.

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
- [Hooks](/automation/hooks) — SDK lifecycle hooks and webhooks
- [Compaction](/concepts/compaction) — how long conversations are summarized
- [Exec Approvals](/tools/exec-approvals) — approval gates for shell commands
- [Thinking](/tools/thinking) — thinking/reasoning level configuration
