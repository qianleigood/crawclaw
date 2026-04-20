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

`MEMORY.md` now follows Claude-style index constraints:

- it is an index only, not a place for memory bodies
- it must not contain frontmatter
- each pointer line should stay on one line and about 150 characters or less
- the whole file should stay under roughly 200 lines and 25KB
- stale detail should move back into topic notes instead of expanding the index

At recall time, CrawClaw does not blindly inject the whole durable-memory
directory. It scans note headers for the current scope, builds a lightweight
manifest, and selects only a small set of clearly relevant notes for the
current prompt. Full note contents are loaded only for the selected items.

On the main agent run path, durable recall now follows a Claude-style
`prefetch + consume` flow:

- the runner starts durable recall asynchronously before prompt assembly
- assembly consumes the prefetched result if it is already ready
- if the prefetch is still pending, the current turn proceeds without durable
  recall instead of blocking the model call
- if no prefetch handle exists for the turn, durable recall is skipped rather
  than falling back to an in-assemble synchronous lookup
- selected durable notes older than one day now carry a freshness reminder, and
  the model is explicitly told to verify file/code/repo-state claims against
  current reality before treating them as fact

Durable auto-write also follows a Claude-style completion trigger:

- the run-loop now emits a `stop` lifecycle phase after a final top-level turn,
  and `memory_extractor` consumes that phase as a subscriber
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

## Session memory

Session memory now follows a Claude-style single-track design:

- each session has one `summary.md` file
- a background `session_summary` agent maintains that file from the run-loop
  post-sampling hook
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
- `Task specification`
- `Files and Functions`
- `Workflow`
- `Errors & Corrections`
- `Codebase and System Documentation`
- `Learnings`
- `Key results`
- `Worklog`

Prompt assembly no longer injects `summary.md` into the model-visible system
context. Before compaction, continuity comes from the recent transcript. When a
session later compacts, CrawClaw consumes `summary.md` as the compacted-history
source of truth and preserves only the recent tail after the summarized
boundary.

Session memory is still keyed by `sessionId`, so parent agents and spawned
sub-agents do **not** share the same summary file. Each child run owns its own
`summary.md`.

<Tip>
If you want your agent to remember something long-term, ask it explicitly. It
can write durable memory or a knowledge note depending on what the fact is.
</Tip>

## Knowledge recall

Knowledge recall uses NotebookLM. CrawClaw can:

- query NotebookLM for relevant knowledge
- write structured knowledge notes directly through `write_knowledge_note`
- manage login, refresh, and provider status via `crawclaw memory`
- summarize nightly memory prompt diagnostics via `crawclaw memory prompt-journal-summary`

Knowledge recall runs during the context-assembly phase of each agent turn. If
there is no usable prompt for the current turn, the runtime skips NotebookLM
querying entirely.

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
as needed to satisfy minimum preserved-tail conditions.

This keeps short-term continuity on one source of truth:

- the background agent updates `summary.md`
- compaction preserves the tail after the summarized boundary, expanding
  backward only enough to keep a usable recent working set
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
