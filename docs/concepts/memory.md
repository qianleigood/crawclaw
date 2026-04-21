---
title: "Memory Overview"
summary: "How CrawClaw uses session memory, durable memory, NotebookLM knowledge recall, and Context Archive"
read_when:
  - You want to understand how memory works
  - You want to know what memory files to write
  - You want to understand what is replayable versus debug-only
---

# Memory Overview

CrawClaw remembers things through a layered memory system:

- **Session memory** for short-lived task continuity inside one session
- **Durable memory** for long-term user and collaboration facts, scoped by
  `agentId + channel + userId`
- **Knowledge recall** backed by NotebookLM and queried during prompt assembly
- **Context Archive** for replay/export/debug records of what a run actually saw
  and did

The model only "remembers" what is persisted into those layers -- there is no
hidden state.

## Durable memory files

Durable memory is stored as plain Markdown files under the scoped durable-memory
directory. Each memory is a standalone note, and each scope has its own
`MEMORY.md` index.

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
  `header`, `body_index`, `body_rerank`, and/or `dream_boost` signals so
  inspect/debug flows can explain why a note was selected or omitted
- full note contents are loaded only for the final selected items
- recently dream-touched notes can receive a light recall prior, but that prior
  decays over time and only applies when the current query is already relevant
  to the note
- prompt assembly receives durable recall score breakdowns and can shift a
  small amount of memory budget toward durable memory for durable-heavy queries
  or away from durable memory when knowledge/SOP recall is the stronger fit
- selected durable notes older than one day still carry a freshness reminder,
  and the model is explicitly told to verify file/code/repo-state claims
  against current reality before treating them as fact

Durable auto-write also follows a turn-end completion trigger:

- the run-loop now emits a `stop` lifecycle phase after a final top-level turn,
  and `memory_extractor` consumes that phase as a subscriber
- the same stop event can carry the captured parent fork context, including the
  parent prompt envelope and full model-visible message context; the embedded
  `memory_extractor` inherits that fork and appends only a narrow durable-memory
  maintenance prompt
- the cursor-based recent-message window remains the extraction boundary; older
  forked context is available only to resolve references in the recent messages,
  not as a source for re-extracting stale history
- the new messages for that turn must include a final assistant reply
- if the latest assistant reply still contains tool calls, or ended in
  `error` / `aborted`, background durable extraction is skipped for that turn
- cursor advancement only happens once the turn is actually handled, so
  incomplete tool-call turns do not accidentally consume extraction history

CrawClaw also has a second durable-memory maintenance layer:

- `memory_extractor` is the light per-turn background writer
- `dream` (auto-dream) is the lower-frequency consolidator
- `session_summary` is the short-term continuity agent for one session
- both `memory_extractor` and `dream` now subscribe to the same
  run-loop `stop` phase instead of being scheduled directly from `afterTurn`
- auto-dream uses runtime DB state, not file `mtime`, for both gating and lock
  ownership
- auto-dream prefers runtime store, session summaries, and Context Archive
  signals instead of transcript grep as its primary signal source
- auto-dream now surfaces phase-level actions for orient / gather /
  consolidate / prune through the Action Feed
- manual dream runs can now be bounded with `--session-limit` / `--signal-limit`
  and previewed with `--dry-run` without taking the dream lock or writing memory
- dream state now keeps the most recent skip/gate reason so status/history/
  inspect can explain why a consolidation did not start
- status and inspect surfaces explicitly report whether the dream closed loop is
  active for the inspected durable scope, instead of leaving dream as an opaque
  optional background behavior
- dream status/history surfaces now expose recent `touchedNotes`, so you can
  see which durable notes were just rewritten before checking later recall
  behavior

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
  lifecycle event carries both the parent prompt envelope and the full current
  model-visible message context, then the summary run appends a narrow
  `summary.md` maintenance prompt instead of adding another summary-specific
  system prompt
- the fork context is captured from the active run-loop, not reconstructed from
  older persisted rows or reassembled from a separate persisted prompt artifact, so
  compaction boundaries stay aligned with what the main agent actually saw
- automatic lifecycle updates skip if that fork context is missing; explicit CLI
  or gateway refresh reconstructs a bounded manual fork context from persisted
  model-visible rows
- session-summary keeps short-lived cache retention for the fork, but does not
  derive or reuse a parent prompt-cache key
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
can write durable memory or a knowledge note depending on what the fact is.
</Tip>

## Knowledge recall

Knowledge recall is a provider-backed layer. NotebookLM is the current default
provider, but prompt assembly talks to a knowledge provider registry instead of
calling the NotebookLM CLI directly. CrawClaw can:

- query NotebookLM for relevant knowledge
- write structured knowledge notes directly through `write_knowledge_note`
- manage login, refresh, and provider status via `crawclaw memory`
- summarize nightly memory prompt diagnostics via `crawclaw memory prompt-journal-summary`

Knowledge recall runs during the context-assembly phase of each agent turn. The
runtime first classifies the user query, then builds a knowledge query plan from
that classification:

- preference-only prompts are routed toward durable memory and skip knowledge
  provider queries
- SOP and runbook prompts can borrow a small amount of provider search budget so
  weak metadata does not starve operational knowledge
- successful `write_knowledge_note` calls update a small local baseline index,
  so recently written knowledge can still be recalled when live provider search
  returns no hits
- local baseline hits keep their own `local_knowledge_index` source, so inspect
  and prompt diagnostics can distinguish them from live NotebookLM hits
- selected knowledge recall is still bounded by the memory prompt budget; layer
  allocations are soft guidance, but the assembled knowledge section must fit
  the global knowledge budget for the turn
- the selected target layers, provider ids, reason, and limit are written into
  memory recall diagnostics so inspect/debug flows can explain why knowledge was
  queried or skipped

If there is no usable prompt for the current turn, the runtime skips knowledge
provider querying entirely.

`write_knowledge_note` is the only NotebookLM write path in the current
runtime. It writes directly through the tool path after schema and guard
validation.

## Context Archive

Context Archive is the replay-oriented record layer for agent runs.

It captures:

- model-visible context, including the assembled prompt/messages/tool surface
- tool admission decisions, loop policy actions, and tool results
- post-turn updates such as session-summary maintenance, compaction,
  completion, and verifier outcomes

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
- **Durable memory** is shared whenever runs resolve to the same
  `agentId + channel + userId` scope.
- **Knowledge recall** uses the same configured NotebookLM backend across runs;
  it is not partitioned by session id.

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
crawclaw memory dream status --json
crawclaw memory dream history --json
crawclaw memory dream run --agent main --channel telegram --user alice --force
crawclaw memory dream run --agent main --channel telegram --user alice --dry-run --session-limit 6 --signal-limit 6
crawclaw memory prompt-journal-summary --json --days 1
crawclaw agent export-context --task-id <task-id> --json
```

## Further reading

- [Memory configuration reference](/reference/memory-config) -- all config knobs
- [Compaction](/concepts/compaction) -- how compaction interacts with memory
