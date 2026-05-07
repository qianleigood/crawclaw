---
title: "Memory Overview"
summary: "How CrawClaw uses session memory, durable memory, experience memory, and Context Archive"
read_when:
  - You want to understand how memory works
  - You want to know what memory files to write
  - You want to understand what is replayable versus debug-only
---

# Memory Overview

CrawClaw remembers things through a layered memory system:

- **Session memory** for short-lived task continuity inside one session
- **Durable memory** for long-term user and collaboration facts, scoped by
  `agentId`
- **Experience memory** backed by NotebookLM prompt-time recall, NotebookLM
  writeback, a local pending outbox for failed writes, and a background
  Experience Agent
- **Context Archive** for replay/export/debug records of what a run actually saw
  and did

The model only "remembers" what is persisted into those layers -- there is no
hidden state.

The `coding` tool profile includes `write_experience_note` for explicit
experience writes and the scoped durable-memory file tools
(`memory_manifest_read`, `memory_note_read`, `memory_note_write`,
`memory_note_edit`, and `memory_note_delete`) for explicit durable-memory
maintenance. Local onboarding defaults new configs to that profile when unset;
it does not add a `main` agent `tools.alsoAllow` override for memory tools.
The main agent decides when to use those durable tools from the memory routing
prompt, matching Claude Code's prompt-driven memory writes. Dedicated
maintenance agents receive the same durable tools through their special-agent
allowlist and remain runtime-restricted to that narrow surface.
Session-summary file edits stay restricted to their owning background agent.

## Durable memory files

Durable memory is stored as plain Markdown files under the scoped durable-memory
directory. Each memory is a standalone note, and each agent scope has its own
`MEMORY.md` index.

The old `agentId + channel + userId` durable/experience scope has been removed.
Current runtimes only read and write the agent-scoped layout.

`MEMORY.md` now follows bounded durable-index constraints:

- it is an index only, not a place for memory bodies
- it must not contain frontmatter
- each pointer line should stay on one line and about 150 characters or less
- the whole file should stay under roughly 200 lines and 25KB
- stale detail should move back into topic notes instead of expanding the index

At recall time, CrawClaw does not blindly inject the whole durable-memory
directory, and it does not fall back to putting the entire `MEMORY.md` file into
the system prompt. Durable recall now runs synchronously during prompt assembly:

- `MEMORY.md` acts as the first durable-memory index surface for the current
  scope
- header metadata such as title, description, and durable type provide the next
  recall layer
- a lightweight body index cache keeps a short excerpt and keyword set per note,
  so an older note with weak title/description can still enter the candidate
  set when its body is clearly relevant
- only a bounded top candidate slice reads body excerpts for a second-pass
  rerank
- durable recall diagnostics now record whether a selected note won on `index`,
  `header`, `body_index`, and/or `body_rerank` signals so inspect/debug flows
  can explain why a note was selected or omitted
- full note contents are loaded only for the final selected items
- prompt assembly receives durable recall score breakdowns and can shift a
  small amount of memory budget toward durable memory for durable-heavy queries
  or away from durable memory when experience/SOP recall is the stronger fit
- selected durable notes older than one day still carry a freshness reminder,
  and the model is explicitly told to verify file/code/repo-state claims
  against current reality before treating them as fact

Durable auto-write also follows a turn-end completion trigger:

- the run-loop now emits a `stop` lifecycle phase after a final top-level turn,
  and `durable_memory` consumes that phase as a subscriber
- the same stop event can carry a captured parent fork context for lifecycle
  subscribers; the embedded `durable_memory` definition explicitly uses
  `parentContextPolicy: "fork_messages_only"`, so the durable run receives only
  the forked model-visible messages needed for the recent-message extraction
  window, not the full parent prompt envelope
- the cursor-based recent-message window remains the extraction boundary; older
  forked context is available only to resolve references in the recent messages,
  not as a source for re-extracting stale history
- `durable_memory` only writes durable profile/context memory: user
  preferences, explicit future-behavior feedback, stable project facts, and
  stable references. Reusable procedures, command sequences, debugging
  workflows, test strategies, failure patterns, and implementation lessons belong
  to experience memory instead.
- the new messages for that turn must include a final assistant reply
- if the latest assistant reply still contains tool calls, or ended in
  `error` / `aborted`, the durable memory agent is skipped for that turn
- cursor advancement only happens once the turn is actually handled, so
  incomplete tool-call turns do not accidentally consume extraction history

CrawClaw also has a second durable-memory maintenance layer:

- `durable_memory` is the light per-turn background writer
- `dream` (auto-dream) is enabled by default as the lower-frequency
  consolidator; the runtime gates still require the configured minimum session
  count, minimum hours between successful runs, scan throttle, and file lock
- `session_summary` is the short-term continuity agent for one session
- both `durable_memory` and `dream` now subscribe to the same
  run-loop `stop` phase instead of being scheduled directly from `afterTurn`
- Dream runs as an independent embedded background maintenance job, not as a
  spawned child session and not as a parent-run fork. The stop event only
  triggers scheduling and scope resolution; Dream does not receive the parent
  prompt envelope, parent model-visible messages, parent run id, child-session
  state, subagent announcement, or parent provider/model selection. This is now
  enforced by the special-agent contract with `parentContextPolicy: "none"`,
  rather than relying on the caller to omit `parentForkContext`.
- Dream uses its own system prompt and isolated embedded special-agent context
  with the dream tool policy, so it does not inherit the default main-agent
  prompt, surfaced skills, bootstrap context files, or workspace reminders.
  The embedded runner skips those default prompt extras for Dream rather than
  falling back to the normal main-agent embedded prompt branch.
- auto-dream uses a per-scope `.consolidate-lock` file in the durable memory
  scope directory for both lock ownership and its consolidation watermark; the
  lock file `mtime` advances at run start and rolls back if the run fails
- auto-dream scans agent session transcript files by `mtime` and passes refs for
  sessions touched since the previous file watermark; Dream may use narrow
  `read` or read-only `exec` searches over those refs, while the host guard
  blocks mutating Bash and blocks raw `write` / `edit` outside the durable
  memory directory
- Dream does not consume `session_summary` files or compact-summary
  `summaryOverrideText`; those stay scoped to single-session continuity and
  compaction rather than cross-session durable consolidation
- auto-dream is bounded by its run timeout rather than a fixed turn-count cap, so
  large cross-session consolidations are not cut off only because they needed
  more agent turns
- auto-dream consolidates the same durable profile/context layer and must not
  convert reusable operational experience into durable notes
- auto-dream now surfaces phase-level actions for orient / gather /
  consolidate / prune through the Action Feed
- manual dream runs can now be bounded with `--session-limit` / `--signal-limit`
  and previewed with `--dry-run` without taking the dream lock or writing memory
- status and inspect surfaces explicitly report whether the dream closed loop is
  active for the inspected durable scope, instead of leaving dream as an opaque
  optional background behavior
- dream status and inspect surfaces report the file watermark, lock path, and
  whether a lock is currently active; dream run history is no longer persisted
  in the runtime DB

Promotion is separate from recall and maintenance:

- durable recall reads scoped durable notes directly
- `dream` consolidates and repairs those durable notes
- promotion candidates are governance artifacts for later review/writeback, not
  prompt-time durable recall inputs
- promotion payloads are explicitly marked `surface: governance_only` to make
  that boundary machine-readable as well as documented

## Session memory

Session memory now follows a single-track design:

- each session has one `summary.md` file
- a background `session_summary` agent maintains that file from the run-loop
  post-sampling hook
- the summary agent runs from one captured parent fork context: the run-loop
  lifecycle event carries the full current model-visible message context, then
  the summary run uses an isolated system prompt plus a narrow `summary.md`
  maintenance prompt instead of reusing the parent system prompt
- the fork context is captured from the active run-loop, not reconstructed from
  older persisted rows or reassembled from a separate persisted prompt artifact, so
  compaction boundaries stay aligned with what the main agent actually saw
- automatic lifecycle updates skip if that fork context is missing; explicit CLI
  or gateway refresh reconstructs a bounded manual fork context from persisted
  model-visible rows
- session-summary keeps short-lived cache retention for the fork, but does not
  derive or reuse a parent prompt-cache key, and it does not run durable or
  experience recall during summary maintenance
- the scheduler can start with a lightweight summary profile earlier, then
  upgrade the same file to a full profile later
- natural settled turns still trigger summary updates, but the scheduler can
  also refresh the file earlier when the token-growth threshold and tool-call
  threshold are both met
- the runtime DB only stores boundary/progress state such as
  `lastSummarizedMessageId`, `lastSummaryUpdatedAt`, `tokensAtLastSummary`, and
  `summaryInProgress`

`summary.md` is the only persistent session-summary source. CrawClaw no longer
keeps a separate runtime "session card" as the primary session-memory record.

The summary file uses a fixed structure, including sections such as:

- `Session Title`
- `Current State`
- `Open Loops`
- `Task specification`
- `Files and Functions`
- `Workflow`
- `Errors & Corrections`
- `Codebase and System Documentation`
- `Learnings`
- `Key results`
- `Worklog`

The file now has two maintenance modes:

- **Light profile** updates the minimum working-state sections first:
  `Current State`, `Open Loops`, `Task specification`, and `Key results`
- **Full profile** expands into the richer long-run sections such as
  `Files and Functions`, `Workflow`, `Errors & Corrections`, `Learnings`, and
  `Worklog`

Prompt assembly no longer injects `summary.md` into the model-visible system
context. Before compaction, continuity comes from the current transcript, and
the background summary agent keeps `summary.md` current from that same
model-visible transcript. When a session later compacts, CrawClaw consumes
`summary.md` as the compacted-history source of truth, stores that rendered
compact view in compaction state, and preserves only the recent tail after the
summarized boundary.

Compaction also no longer consumes the raw `summary.md` body. It renders a
structured compacted view from the most continuity-critical sections, including
`Current State`, `Open Loops`, `Task specification`, `Files and Functions`,
`Workflow`, `Errors & Corrections`, and `Key results`. After compaction, prompt
assembly prepends that rendered compact summary as a transcript summary message
before the preserved tail; it still does not inject the full `summary.md` file
as system context on ordinary turns.

Session summary can also seed durable-memory promotion candidates. After a
successful summary update, CrawClaw distills stable long-term facts from the
structured summary sections and records them as promotion candidates instead of
writing durable memory directly. Those candidates enter the promotion/governance
pipeline; they are not a third recall layer and are not injected into prompt
assembly until some later workflow explicitly materializes them elsewhere.

Session memory is still keyed by `sessionId`, so parent agents and spawned
sub-agents do **not** share the same summary file. Each child run owns its own
`summary.md`.

<Tip>
If you want your agent to remember something long-term, ask it explicitly. It
can write durable memory or an experience note depending on what should be retained.
</Tip>

## Experience recall

Experience memory is a separate memory layer for validated lessons from prior
work. It stores reusable procedures, decisions, runtime patterns, failure
patterns, workflow patterns, and references. NotebookLM is the prompt-facing
experience recall provider and the primary write target. The local experience
store is only used as a failure outbox when NotebookLM writeback is unavailable;
it is not a fallback prompt recall source or the primary experience store.
CrawClaw can:

- query NotebookLM for relevant reusable experience
- write structured experience notes directly through `write_experience_note`
- run a background Experience Agent after top-level turns to extract reusable
  experience without blocking the main task
- manage login, refresh, and provider status via `crawclaw memory`
- flush local pending experience notes with `crawclaw memory sync`
- summarize nightly memory prompt diagnostics via `crawclaw memory prompt-journal-summary`

Experience extraction and recall are deliberately split:

- lifecycle `stop` captures the just-finished top-level turn
- the Experience Agent reviews recent model-visible messages, session summary
  context, and the local pending outbox for unsynced NotebookLM writes
- experience extraction progress is tracked per session in the runtime store, so
  restarts resume from the persisted cursor instead of rescanning from turn `0`
- the agent can only use `write_experience_note`; it cannot run shell commands,
  browse, inspect source files, write durable memory, or spawn agents
- successful writes go directly to NotebookLM when the provider is ready
- if NotebookLM is not ready, writes stay in the local pending outbox until
  login, heartbeat, startup, or `crawclaw memory sync` flushes them
- the next prompt assembly synchronously recalls the most relevant experience
  from NotebookLM only

Experience recall runs during the context-assembly phase of each agent turn. The
runtime first classifies the user query, then builds a provider query plan from
that classification:

- preference-only prompts are routed toward durable memory and skip experience
  provider queries
- SOP and runbook prompts can borrow a small amount of provider search budget so
  weak metadata does not starve operational experience
- successful `write_experience_note` calls do not keep a full local experience
  copy; only failed NotebookLM writes are kept in the local pending outbox
- if NotebookLM returns no hits or is not authenticated, experience recall is
  empty for that turn instead of falling back to local outbox entries
- NotebookLM/Gemini owns semantic relevance and ordering for experience recall;
  CrawClaw preserves provider order and only applies deterministic guardrails
  such as NotebookLM-only source filtering, duplicate removal, non-empty content
  checks, and prompt-budget limits
- experience recall diagnostics expose the preserved `providerOrder` and
  selection reason, not a local score breakdown; local score fields are reserved
  for durable-memory observability
- selected experience recall is still bounded by the memory prompt budget; layer
  allocations are soft guidance, but the assembled experience section must fit
  the global experience budget for the turn
- the selected target layers, provider ids, reason, and limit are written into
  memory recall diagnostics so inspect/debug flows can explain why experience was
  queried or skipped

If there is no usable prompt for the current turn, the runtime skips experience
provider querying entirely.

`write_experience_note` is the only experience write tool in the current
runtime. When NotebookLM is enabled, it writes to NotebookLM first. With the
managed NotebookLM runtime, CrawClaw writes via `nlm source add --text --wait`
so the experience is available to later NotebookLM queries; a custom
`memory.notebooklm.write.command` is only needed for nonstandard write helpers.
If NotebookLM writeback fails, CrawClaw stores the
structured note in the local pending outbox and retries it later through
heartbeat, startup, or `crawclaw memory sync`. After a pending item syncs
successfully, the local payload is removed. Experience notes should capture
reusable context, trigger, action, result, lesson, applicability boundaries, and
supporting evidence rather than temporary task state. The write schema only
accepts the current structured fields; legacy aliases such as freeform
body/rationale fields are not kept as compatibility inputs.

NotebookLM auth can be kept warm by `memory.notebooklm.auth.autoLogin`. The
default provider runs the managed `nlm login --profile <profile>` flow on a
daily interval, reusing the persisted notebooklm-mcp-cli browser profile. For an
OpenClaw-managed browser, set the provider to `openclaw_cdp` and provide a CDP
URL. After auto login succeeds, CrawClaw clears the provider cache and flushes
pending experience notes to NotebookLM.

## Context Archive

Context Archive is the replay-oriented record layer for agent runs.

It captures:

- model-visible context, including the assembled prompt/messages/tool surface
- tool admission decisions, loop policy actions, and tool results
- post-turn updates such as session-summary maintenance, compaction,
  completion, and review outcomes

Context Archive is distinct from the older record layers:

- **Session transcripts** are product-facing conversation records and may be
  compacted or rewritten later
- **Prompt journal** is debug-only and intentionally lossy/truncated
- **Diagnostic session state** is an in-memory mirror/cache, not a durable truth
  source

If you need to export or replay a task-backed run, Context Archive is the layer
to use.

## Scope and sharing

These layers do not share the same boundaries:

- **Session memory** is isolated per session.
- **Session summary** remains keyed by `sessionId` and is not shared across
  sessions.
- **Durable memory** is shared whenever runs resolve to the same `agentId`
  scope.
- **Experience memory** uses the same NotebookLM provider configuration and
  prompt-facing recall across runs, while the local pending outbox is scoped by
  the same `agentId` boundary and the extraction cursor is still tracked per
  session.

`channel` and `userId` can still be recorded as source metadata on extracted
memory records, but they no longer determine storage directories, scope keys,
or long-term memory isolation.

Manual dream inspection and execution follow the same boundary: use `--agent`
or an explicit `scopeKey` equal to the agent id. The old channel/user-based
scope inputs are no longer accepted.

All agents that use the built-in memory runtime receive the same agent memory
routing contract. This guidance is not limited to the `main` agent.

## Session summary maintenance

Before [compaction](/concepts/compaction) trims a session, CrawClaw waits for
the current `session_summary` run to finish for a short bounded window and then
uses `summary.md` plus `lastSummarizedMessageId` as the compaction boundary.
Compaction starts just after that summarized boundary and expands backward only
as needed to satisfy minimum preserved-tail conditions. If a crashed process
left `summaryInProgress` set past the stale-lease window, compaction clears the
stale lease instead of waiting on a dead summary run.

This keeps short-term continuity on one source of truth:

- the background agent updates `summary.md`
- that agent sees the current model-visible message context carried by the
  captured parent fork context
- automatic summary updates require that parent fork context; explicit
  CLI/gateway refresh reconstructs a bounded manual fork context from persisted
  model-visible rows
- compaction preserves the tail after the summarized boundary, expanding
  backward only enough to keep a usable recent working set
- after compaction, model-visible history contains the compact summary message
  plus that preserved tail
- prompt assembly keeps using the recent transcript and does not separately
  inject `summary.md`

## CLI

```bash
crawclaw memory status   # Check NotebookLM provider status
crawclaw memory login    # Rebuild the NotebookLM profile
crawclaw memory refresh  # Refresh NotebookLM auth from cookie fallback
crawclaw memory sync     # Flush pending experience notes to NotebookLM
crawclaw memory dream status --json
crawclaw memory dream history --json
crawclaw memory dream run --agent main --force
crawclaw memory dream run --scope-key main --dry-run --session-limit 6 --signal-limit 6
crawclaw memory prompt-journal-summary --json --days 1
crawclaw agent export-context --task-id <task-id> --json
```

## Further reading

- [Memory configuration reference](/reference/memory-config) -- all config knobs
- [Compaction](/concepts/compaction) -- how compaction interacts with memory
