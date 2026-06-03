---
summary: "Living checklist for the remaining agent/runtime work after phases one through three"
read_when:
  - You want a single place to track unfinished agent/runtime work
  - You are deciding what to build next after the current architecture rollout
  - You need the current backlog for review, Action Feed, and Context Archive
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
- inspect, status, and gateway inspection RPC support
- `/review` as the public two-stage review entrypoint
- Context Archive foundation
- Action Feed foundation
- Hindsight-backed direct experience retention after completed turns
- the shared special-agent substrate for `session-summary`, `durable-memory`,
  `dream`, `experience`, and review

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
    - runtime deny for special-agent tool enforcement
    - explicit parent context policy on special-agent definitions
    - explicit memory input contracts for memory-maintenance agents
    - explicit Hindsight layer policy for memory-maintenance tools
    - shared spawn / embedded-run / completion capture runtime
    - `session-summary` migrated to `embedded_fork`
    - `durable-memory` migrated as a narrow-input maintenance agent
    - `dream` migrated on the shared substrate
    - `experience` migrated on the shared substrate
    - review migrated
- [x] Keep future task-specific special agents on case-by-case substrate opt-in.
  - Runtime maintenance forks are the default only for fire-and-forget background agents.
  - User-invoked or session-bearing task agents stay `spawned_session` unless they need parent-run cache inheritance more than child-session state.
- [x] Replace ad hoc parent-context inheritance with definition-level policy.
  - Landed:
    - runtime forks now declare explicit `parentContextPolicy`
      (`none`, `fork_messages_only`, `full_envelope`) instead of relying on
      ad hoc call-site omission or `definitionId` checks
    - `durable-memory`, `dream`, and `experience` declare
      `parentContextPolicy: "none"`
    - `durable-memory` uses a structured `contextPackage` instead of inheriting
      the parent transcript
    - `session-summary` remains the only current memory special agent allowed
      a full parent handoff
    - session-summary compaction now persists the rendered compact view and
      prompt assembly prepends it as a compact summary message before the
      preserved tail
    - stale `summaryInProgress` leases are cleared by compaction
  - Remaining gap:
    - CrawClaw still does not replay the parent query loop as a live
      in-process clone. Structured packages and explicit parent-context policy
      are the supported handoff mechanisms.
- [x] Introduce a structured `QueryContext` owner for prompt assembly.
  - Landed:
    - base system prompt now emits structured sections instead of only one large string
    - memory assembly now emits structured `systemContextSections` as the only context-engine prompt output
    - memory `systemContextSections` now carry machine-readable section schema (`durable_memory` / `experience` / `routing`) instead of relying only on free-form text + metadata
    - prompt-build hooks now return structured `QueryContextPatch` objects instead of string mutations
    - cache identity is derived from the structured query context instead of ad-hoc prompt assembly paths
    - query-context tool payload normalization is now shared with query-layer cache contract helpers, reducing duplicated cache-shape logic
    - Context Archive model-visible capture now records structured query-context diagnostics

Design:

- [`Special-Agent Substrate`](/debug/special-agent-substrate)

## Priority 0: review hardening

The two-stage review flow is working, but it is still an MVP.

- [x] Upgrade review output from `VERDICT + summary` to a structured report.
  - Landed fields:
    - `verdict`
    - `summary`
    - `checks[]`
    - `failingCommands[]`
    - `warnings[]`
    - `artifacts[]`
  - The structured report now flows through:
    - review parsing
    - `/review` tool results
    - parent Action Feed review details
    - task-trajectory completion detail / archive payloads
- [ ] Make review failure a first-class completion signal.
  - `FAIL` and `PARTIAL` should feed parent completion state, not just the
    final textual report.
- [ ] Add review policy.
  - Define which task types require review by default.
  - Start with `fix` and `code` tasks.
- [ ] Support automatic review triggering from completion policy.
  - When completion blocks on `review_missing`, the system should be able to
    launch review automatically instead of relying only on manual `/review`.
- [ ] Tighten review capability governance further.
  - Keep review stages read-only.
  - Keep review stages unable to patch files or recursively spawn more agents.
- [ ] Improve review-to-parent action bubbling.
  - Parent chat should see the most important review checks, not only
    `started/running/REVIEW_PASS/REVIEW_FAIL/REVIEW_PARTIAL`.

## Priority 1: Action Feed completion

Action Feed is already live, but it is not fully productized.

- [ ] Add richer detail rendering in chat.
  - Current `<details>` output is acceptable for debugging, but still too raw
    for normal users.
- [ ] Surface review child actions into the parent feed more cleanly.
- [ ] Add consistent action coverage for:
  - memory recall decisions
  - model/provider fallback
  - completion blockers
  - compaction retries and rewrites
- [ ] Make Action Feed the single semantic source across:
  - live chat
  - inspect
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
  - review actions
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
  - review

## Priority 1: UI and operator surfaces

The backend architecture is ahead of the current operator UI.

- [ ] Add agent runtime detail panels to Browser client.
  - runtime state
  - trajectory
  - completion
  - review result
  - loop and guard actions
- [ ] Add a dedicated Action Feed view in the existing UI, not only inline chat.
- [ ] Expose Context Archive refs in the UI.
- [ ] Add a clearer operator view for stuck tasks, waiting approvals, and review
      blockers.
- [ ] Add a human-friendly inspect page instead of relying only on CLI and raw
      JSON.

## Priority 2: memory/runtime follow-ups

Memory is aligned with the current simplified model, but follow-up work remains.

- [ ] Add an automatic durable-memory extraction scheduler if product wants
      durable auto-write.
  - Current landed boundary:
    - `durable-memory` special-agent definition
    - narrow `contextPackage` input
    - `parentContextPolicy: "none"`
    - durable-only Hindsight layer enforcement
  - Future scheduler requirements:
    - cursor-based incremental window
    - explicit durable write/delete wins
    - experience writes do not suppress durable extraction
    - bidirectional `feedback` guidance
    - inspection/replay evidence for automatic extraction runs
  - Design and background:
    - [`Durable Memory Agent Design`](/debug/memory-extractor-agent)
    - [`Durable Memory Refactor Status`](/debug/claude-memory-refactor)
- [x] Add agent-scoped routing guidance for experience knowledge writes, matching the
      durable-memory guidance quality level.
- [x] Move maintenance-agent context isolation onto `SpecialAgentDefinition`.
  - `durable-memory`, `dream`, and `experience` now declare
    `parentContextPolicy: "none"`.
  - `session-summary` declares `parentContextPolicy: "full_envelope"` because
    it is explicitly a session-continuity agent.
- [ ] Revisit candidate extraction as a future suggestion layer only.
  - It should not become a hidden writeback path again.
- [x] Keep dreaming as a separate durable-memory consolidation pipeline.
  - Dream uses an embedded-fork special-agent run with no parent context.
  - It does not inherit parent prompt or transcript state.
  - Hindsight/experience writes stay on the explicit experience path; Dream
    does not run main memory runtime recall and only consolidates durable
    profile/context memory.

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
  - review
  - Action Feed
  - Context Archive export/replay
- [ ] Add replay datasets that specifically cover:
  - false complete
  - false loop block
  - review failure
  - approval-unavailable paths
- [ ] Use those datasets in the promotion workflow for future policy changes.

## What should not be reopened

These are intentionally **not** backlog items right now:

- bringing back the old experience review queue
- making Hindsight writeback go through a hidden approval pipeline
- replacing transcript, runtime store, or trajectory with a single new store
- putting LLMs in charge of hard guard allow/deny decisions
- letting an online agent self-modify guard safety boundaries

## Working rule for future work

When new work is added in this area, prefer this order:

1. review
2. Action Feed
3. Context Archive
4. UI/operator surfaces
5. memory follow-ups

That order keeps the runtime honest before adding more product polish.
