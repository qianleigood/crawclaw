---
summary: "Living checklist for the remaining agent/runtime work after phases one through three"
read_when:
  - You want a single place to track unfinished agent/runtime work
  - You are deciding what to build next after the current architecture rollout
  - You need the current backlog for verifier, Action Feed, and Context Archive
title: "Agent Runtime Open Items"
---

# Agent runtime open items

This page is the **living backlog** for the remaining work on the current
CrawClaw agent/runtime architecture.

It is intentionally scoped to **unfinished work only**. It does not repeat the
phases that are already done.

## Current status

The following are already landed:

- task-backed agent runtime
- subagent and ACP task integration
- guard architecture phase one and two
- completion evidence and completion guard
- loop policy, replay, report, and promotion gate
- inspect, status, gateway inspection RPC, and CLI support
- `/verify` as the public verification entrypoint
- Context Archive foundation
- Action Feed foundation
- the background `memory_extractor` path for durable auto-write
- the shared special-agent substrate for `session_summary`, `memory_extractor`, `dream`, and verification

The items below are the main gaps that still matter.

## Priority 1: unified lifecycle spine

Run-loop lifecycle semantics are still split across multiple planes.

- [x] Add a single run-loop lifecycle spine.
  - Target phases:
    - `turn_started`
    - `post_sampling`
    - `settled_turn`
    - `stop`
    - `stop_failure`
    - `pre_compact`
    - `post_compact`
    - `subagent_start`
    - `subagent_stop`
- [x] Make run-loop helpers the canonical lifecycle emitters for the currently landed phases.
- [x] Migrate session summary to consume the spine.
- [x] Migrate durable extraction and auto-dream to consume the spine.
- [x] Reduce compaction lifecycle adapters to `pre_compact` / `post_compact` subscribers.
- [x] Make internal hooks and plugin hooks adapters instead of parallel lifecycle owners.
- [x] Connect Action Feed and Context Archive to the same lifecycle spine.
- [x] Remove `MemoryRuntime` lifecycle callback ownership.

Design:

- [`Run-loop Lifecycle Spine`](/debug/run-loop-lifecycle-spine)

## Priority 0: shared special-agent substrate

The lifecycle spine is unified. The next agent/runtime step is to keep special
agent runtime mechanics equally consistent without flattening agent-specific
contracts.

- [x] Add a shared runtime substrate for maintenance-style special agents.
  - Landed:
    - shared `SpecialAgentDefinition`
    - dual execution modes: `spawned_session` and `embedded_fork`
    - explicit transcript policy on special-agent definitions
    - explicit tool policies resolved from the shared special-agent registry
    - Claude-style runtime deny for special-agent tool enforcement
    - explicit provider-level cache policy on special-agent definitions
    - parent-run `cacheSafeParams` snapshot persistence keyed by `runId`
    - shared spawn / embedded-run / completion capture runtime
    - shared event / history / usage hooks in the runtime runner
    - `session_summary` migrated to `embedded_fork`
    - `memory_extractor` migrated as a pilot on the shared substrate
    - `dream` migrated on the shared substrate
    - embedded memory special runs now record usage/history/action observations into Context Archive
    - embedded memory special runs now surface usage, including cache read/write, in Action Feed completion details
    - verifier migrated
- [x] Keep future task-specific special agents on case-by-case substrate opt-in.
  - Embedded maintenance forks are the default only for fire-and-forget background agents.
  - User-invoked or session-bearing task agents stay `spawned_session` unless they need parent-run cache inheritance more than child-session state.
- [x] Add explicit cache-write suppression (`skipCacheWrite` equivalent) to the embedded-fork substrate.
  - Embedded memory special agents now carry explicit cache-write suppression through the shared substrate.
  - The runtime maps that to provider-supported "avoid creating new cache entries" controls while still preserving prompt-cache reads when the provider can do so.
- [x] Expand parent-run cache snapshots from hash/key metadata to a fuller cache-safe prompt envelope.
  - Landed:
    - tool prompt payload and tool-inventory digest
    - thinking config
    - fork-context messages
    - embedded memory special agents intentionally do not inherit the captured parent prompt envelope
    - the cache-safe snapshot still carries canonical cache-identity state for non-memory embedded forks that opt into reuse
    - embedded memory special runs keep short retention plus cache-write suppression instead of reusing a parent prompt-cache key
    - cache ownership is now split cleanly into:
      - `CacheEnvelope` identity + snapshot persistence
      - fork-cache planning / drift checks
      - provider cache hints
  - Remaining gap:
    - CrawClaw still does not reuse a literal in-process Claude-style `CacheSafeParams` object; request reconstruction is still adapter-shaped even though the inherited envelope is now canonical enough for stable cache identity and drift protection.
- [x] Introduce a structured `QueryContext` owner for prompt assembly.
  - Landed:
    - base system prompt now emits structured sections instead of only one large string
    - memory assembly now emits structured `systemContextSections` as the only context-engine prompt output
    - memory `systemContextSections` now carry machine-readable section schema (`session_memory` / `durable_memory` / `knowledge` / `routing`) instead of relying only on free-form text + metadata
    - prompt-build hooks now return structured `QueryContextPatch` objects instead of string mutations
    - cache identity is derived from the structured query context instead of ad-hoc prompt assembly paths
    - query-context tool payload normalization is now shared with query-layer cache contract helpers, reducing duplicated cache-shape logic
    - Context Archive model-visible capture now records structured query-context diagnostics

Design:

- [`Special-Agent Substrate`](/debug/special-agent-substrate)

## Priority 0: verifier hardening

The verifier is working, but it is still an MVP.

- [x] Upgrade verifier output from `VERDICT + summary` to a structured report.
  - Landed fields:
    - `verdict`
    - `summary`
    - `checks[]`
    - `failingCommands[]`
    - `warnings[]`
    - `artifacts[]`
  - The structured report now flows through:
    - verifier parsing
    - `/verify` tool results
    - parent Action Feed verification details
    - task-trajectory completion detail / archive payloads
- [ ] Make verifier failure a first-class completion signal.
  - `FAIL` and `PARTIAL` should feed parent completion state, not just the
    final textual report.
- [ ] Add verifier policy.
  - Define which task types require verification by default.
  - Start with `fix` and `code` tasks.
- [ ] Support automatic verifier triggering from completion policy.
  - When completion blocks on `verification_missing`, the system should be able
    to launch verifier automatically instead of relying only on manual `/verify`.
- [ ] Tighten verifier capability governance further.
  - Keep verifier read-only.
  - Keep verifier unable to patch files or recursively spawn more agents.
- [ ] Improve verifier-to-parent action bubbling.
  - Parent chat should see the most important verifier checks, not only
    `started/running/PASS/FAIL/PARTIAL`.

## Priority 1: Action Feed completion

Action Feed is already live, but it is not fully productized.

- [ ] Add richer detail rendering in chat.
  - Current `<details>` output is acceptable for debugging, but still too raw
    for normal users.
- [ ] Surface verifier child actions into the parent feed more cleanly.
- [ ] Add consistent action coverage for:
  - memory recall decisions
  - model/provider fallback
  - completion blockers
  - compaction retries and rewrites
- [ ] Make Action Feed the single semantic source across:
  - live chat
  - inspect
  - export-context
  - Context Archive replay
- [ ] Add a detail panel or drawer for long-running tasks.
- [ ] Add channel-specific renderers.
  - Feishu should use a single updatable card instead of noisy message spam.

## Priority 1: Context Archive completion

Context Archive is now useful, but not finished as the long-term replay layer.

- [ ] Finish model-visible capture coverage for every major run path.
- [ ] Ensure every important action has an archive record.
  - tool admission/result
  - guard decisions
  - loop actions
  - verifier actions
  - completion decisions
- [ ] Improve export ergonomics.
  - Exported bundles should be easier to inspect and share internally.
- [ ] Improve replay ergonomics.
  - Replay should be able to consume archive data without extra manual joins.
- [ ] Harden retention and storage policy.
  - size limits
  - cleanup behavior
  - large blob handling
  - secret redaction validation
- [ ] Add explicit archive coverage tests for:
  - parent agent
  - subagent
  - ACP
  - verifier

## Priority 1: UI and operator surfaces

The backend architecture is ahead of the current operator UI.

- [ ] Add agent runtime detail panels to Control UI.
  - runtime state
  - trajectory
  - completion
  - verifier result
  - loop and guard actions
- [ ] Add a dedicated Action Feed view in the existing UI, not only inline chat.
- [ ] Expose Context Archive refs in the UI.
- [ ] Add a clearer operator view for stuck tasks, waiting approvals, and
      verification blockers.
- [ ] Add a human-friendly inspect page instead of relying only on CLI and raw
      JSON.

## Priority 2: memory/runtime follow-ups

Memory is aligned with the current simplified model, but follow-up work remains.

- [x] Upgrade the main durable auto-write path to a background `memory_extractor` agent.
  - Landed:
    - cursor-based incremental window
    - explicit durable write/delete wins
    - `write_knowledge_note` no longer suppresses durable extraction
    - bidirectional `feedback` guidance
    - task-backed background special agent
    - Action Feed / Context Archive recording
  - Design and background:
    - [`Memory Extractor Agent Design`](/debug/memory-extractor-agent)
    - [`Claude-style Durable Memory Refactor`](/debug/claude-memory-refactor)
- [ ] Add agent-scoped routing guidance for `write_knowledge_note`, matching the
      durable-memory guidance quality level.
- [ ] Revisit candidate extraction as a future suggestion layer only.
  - It should not become a hidden writeback path again.
- [ ] Decide whether dreaming / dream runs should be introduced as a new
      pipeline on top of the current runtime store.
- [ ] If dreaming is added later:
  - keep NotebookLM writes on the explicit tool path
  - keep automatic consolidation separate from formal knowledge writes

## Priority 2: multi-agent governance

Multi-agent architecture is landed, but governance can still improve.

- [ ] Make agent-specific capability policies easier to inspect and compare.
- [ ] Add clearer parent/child evidence aggregation rules.
- [ ] Improve background-agent operational visibility.
- [ ] Add more explicit failure reasons for subagent and ACP runs.

## Priority 2: regression and live validation

The architecture has strong targeted regression coverage, but the next step is
more systematic validation.

- [ ] Add repeatable live smoke flows for:
  - main agent
  - subagent
  - ACP
  - verifier
  - Action Feed
  - Context Archive export/replay
- [ ] Add replay datasets that specifically cover:
  - false complete
  - false loop block
  - verification failure
  - approval-unavailable paths
- [ ] Use those datasets in the promotion workflow for future policy changes.

## What should not be reopened

These are intentionally **not** backlog items right now:

- bringing back the old knowledge review queue
- making NotebookLM writeback go through a hidden approval pipeline
- replacing transcript, runtime store, or trajectory with a single new store
- putting LLMs in charge of hard guard allow/deny decisions
- letting an online agent self-modify guard safety boundaries

## Working rule for future work

When new work is added in this area, prefer this order:

1. verifier
2. Action Feed
3. Context Archive
4. UI/operator surfaces
5. memory follow-ups

That order keeps the runtime honest before adding more product polish.
