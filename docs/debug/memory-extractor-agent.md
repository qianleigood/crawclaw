---
read_when:
  - You want to refactor durable memory auto-write into a background agent
  - You want the exact trigger rules, input contract, capability boundary, and rollout plan for a memory_extractor agent
  - You want a practical mapping from parent-context memory extraction to CrawClaw's runtime architecture
summary: Design for refactoring durable memory auto-write into a background memory_extractor agent
title: Memory Extractor Agent Design
---

# Memory Extractor Agent Design

This document records the refactor direction that has now been landed:

**move CrawClaw durable memory auto-write from the former synchronous extraction
flow into a constrained background `memory_extractor` agent.**

The goal was not to copy Claude's implementation literally. It was to borrow two
durable-memory properties and fit them into CrawClaw's runtime architecture:

- more complete extraction rules
- a background execution shape that does not block the main interaction loop

## Why refactor

The original durable auto-write path had three structural problems:

1. Trigger point is too early  
   It used to hang off `afterTurn`, which was closer to "new messages arrived,
   maybe extract" than "the turn has stabilized, now consolidate memory".

2. The window is too narrow  
   It effectively works on something close to "the last 8 visible user/assistant messages from this turn's new messages", which can miss important feedback from the earlier half of the turn.

3. `feedback` semantics are incomplete  
   Feedback used to behave more like corrective memory. The stronger rule is:
   - record corrections
   - also record non-obvious approaches that were validated as successful

So this is not just a prompt tweak. It is a lifecycle, windowing, and execution-shape refactor.

## Target outcome

Durable auto-write should eventually behave like this:

- triggers only after a stable top-level turn ends
- only processes model-visible messages since an extraction cursor
- explicit durable write/delete wins, so background extraction skips
- `write_knowledge_note` no longer suppresses durable extraction
- `feedback` supports corrective + reinforcing semantics
- runs as a task-backed background special agent
- is visible through Action Feed, Context Archive, and inspect

In one sentence:

**it should become a constrained memory maintenance agent, not a bare LLM helper.**

## Current implementation status

As of the current version, the main path is already landed:

- cursor-based incremental extraction window
- `write_knowledge_note` no longer suppresses durable extraction
- bidirectional `feedback` guidance
- task-backed background `memory_extractor`
- hard stop at `maxTurns: 5` for the extraction agent
- manifest-first prompt workflow: candidate review first, then tightly batched durable writes within the 5-turn budget
- scoped memory file tools now back the extractor:
  - `memory_manifest_read`
  - `memory_note_read`
  - `memory_note_write`
  - `memory_note_edit`
  - `memory_note_delete`
- Action Feed and Context Archive integration
- explicit durable scope inheritance for memory-extraction child sessions
- parent fork context inheritance for continuity, with the cursor window kept as
  the authoritative extraction source

For the main refactor itself, no blocking follow-up remains.

The current trigger semantics are now aligned with "settled top-level
turn end" in a stricter sense:

- `afterTurn` is only reached from post-turn finalization
- `memory_extractor` is scheduled only when the turn's new messages include a
  final assistant reply
- if that latest assistant reply still contains tool calls, or ended in
  `error` / `aborted`, extraction is skipped for that turn
- subagent sessions are rejected in the worker manager, so automatic durable
  extraction stays on the top-level session path

Remaining work from here is product polish around observability, not another
core architecture change.

## Shape choice

### Why the former structured extraction worker was not kept

The current worker has real advantages:

- simple implementation
- stable structured output
- deterministic local upsert

But it also has real limits:

- no full agent-grade observability
- no independent task identity
- awkward to surface in Action Feed
- behaves more like a runtime helper than a real background maintenance unit

### Why not copy Claude's file-native forked extractor directly

Claude's forked extractor writes memory files directly. That works there, but CrawClaw already has better infrastructure for this:

- task-backed runtime
- guard and capability policy
- Action Feed
- Context Archive
- durable store upsert

So the right approach is:

- **borrow the parent-context execution pattern**
- **keep CrawClaw's durable store and upsert model**

## Core design

### Agent identity

Introduce a special built-in agent profile:

- `agentId: memory_extractor`
- `spawnSource: "memory-extraction"`
- `mode: background`
- task-backed
- hidden from ordinary chat transcript by default

This is conceptually similar to verifier:

- verifier = read-only validation agent
- memory_extractor = durable-memory maintenance agent

### Trigger rules

Only trigger when all of these are true:

1. current session is a top-level main session
2. durable auto-write is enabled
3. a stable top-level turn has ended
4. there are new model-visible messages since the last extraction cursor
5. this turn did not already perform explicit durable write or delete

Explicitly **not** a skip condition:

- `write_knowledge_note`

### Input contract

The input to `memory_extractor` must be narrow and structured:

```ts
type MemoryExtractorInput = {
  sessionId: string;
  sessionKey: string;
  scope: {
    scopeKey: string;
    agentId?: string | null;
    channel?: string | null;
    userId?: string | null;
  };
  cursorAfter?: {
    messageId?: string;
    turn?: number;
  };
  recentModelVisibleMessages: Array<{
    id?: string;
    role: "user" | "assistant";
    text: string;
    turnIndex?: number;
  }>;
  existingManifest: Array<{
    title: string;
    durableType: "user" | "feedback" | "project" | "reference";
    description: string;
    dedupeKey?: string;
    relativePath: string;
  }>;
  explicitSignals: {
    explicitRememberAsked: boolean;
    explicitForgetAsked: boolean;
    hadDurableWriteThisTurn: boolean;
    hadDurableDeleteThisTurn: boolean;
    hadKnowledgeWriteThisTurn: boolean;
  };
};
```

The most important constraint is:

- do not pass the whole transcript
- do not pass the whole project context
- only pass the incremental messages and manifest needed for durable extraction

### Capability boundary

This agent should be even narrower than verifier.

Allowed:

- `memory_manifest_read`
- `memory_note_read`
- `memory_note_write`
- `memory_note_edit`
- `memory_note_delete`

Disallowed:

- read project source code
- `exec`
- `browser`
- `web`
- `write_knowledge_note`
- `sessions_spawn`
- writes outside the current durable scope

In other words:

**it is a tiny agent whose only job is maintaining the durable memory directory.**

### Output contract

The agent should emit a structured result:

```ts
type MemoryExtractorResult = {
  status: "written" | "skipped" | "no_change" | "failed";
  writtenPaths: string[];
  updatedPaths: string[];
  deletedPaths: string[];
  extractedTypes: Array<"user" | "feedback" | "project" | "reference">;
  reason?: string;
};
```

This result does not need to be user-facing by default, but it must feed:

- Action Feed
- Context Archive
- inspect

## Extraction rules

### Only process model-visible incremental messages

The window should become:

- `user/assistant` messages since the extraction cursor
- plus a safety cap, for example 20 to 30 messages

The cap is only a guardrail. It should not define "recent" by itself.

### Explicit durable write/delete wins

If the turn already used:

- `memory_manifest_read`
- `memory_note_read`
- `memory_note_write`
- `memory_note_edit`
- `memory_note_delete`

then the memory_extractor skips that turn and still advances the cursor.

### `write_knowledge_note` should not suppress durable extraction

Reason:

- NotebookLM knowledge and durable collaboration memory are different layers
- a turn can validly write knowledge and still deserve durable feedback/project extraction

### `feedback` becomes bidirectional

`feedback` should no longer mean only "correction memory".

It should cover:

- corrective
  - "don't do this in the future"
  - "do not default to that response style"
- reinforcing
  - "that non-obvious choice was correct"
  - "keep doing this in similar situations"

First stage does not require a new top-level type.

The safer first step is:

- keep top-level `feedback`
- strengthen prompt and note-schema semantics

### Prefer update over duplicate creation

This should align directly with Claude:

- update existing notes when the topic matches
- only create new notes when needed
- allow delete when forgetting/removal is explicit

## State design

Introduce a per-session extraction cursor:

```ts
type DurableExtractionCursor = {
  sessionKey: string;
  lastExtractedMessageId?: string;
  lastExtractedTurn?: number;
  lastRunAt?: number;
};
```

Advance rules:

- advance after successful writes
- advance when skipping due to explicit durable write/delete
- do not advance on failure

## Relationship to existing systems

### Action Feed

`memory_extractor` should be first-class in Action Feed.

Minimum actions:

- `memory extraction scheduled`
- `memory extraction running`
- `memory extraction skipped`
- `memory extraction wrote 2 notes`
- `memory extraction failed`

### Context Archive

This flow must land cleanly in Context Archive.

At minimum archive:

- input window
- manifest snapshot
- skip reason
- final write result

### inspect

`agent inspect` should later show:

- whether the latest extraction triggered
- how large the input window was
- whether it skipped
- which notes it wrote

## Rollout result

The rollout is now complete. In practice it landed in two phases.

### Phase 1: fix the rules first

Completed:

- cursor-based incremental window
- remove `knowledge_write` suppression
- bidirectional feedback

During this transition, the legacy structured extraction + upsert path was
briefly reused.

### Phase 2: move execution into a background `memory_extractor` agent

Completed:

- durable auto-write becomes a task-backed background special agent
- scoped memory file tools replace the earlier high-level durable write tools inside `memory_extractor`
- Action Feed / Archive / inspect all integrate cleanly

Current final state:

- the former structured extraction worker has been removed from the durable
  auto-write path
- `memory_extractor` is the only automatic durable write path

## Completed PR breakdown

### PR-A

cursor-based durable extraction window

### PR-B

remove knowledge-write suppression

### PR-C

bidirectional feedback guidance

### PR-D

background memory_extractor agent

### PR-E

Action Feed / Archive / inspect integration

## Bottom line

The most valuable move here is not piling more prompt logic onto the existing after-turn extractor.

It is:

**upgrade durable auto-write into a cursor-driven rule set running on a CrawClaw background special agent.**

The key architectural choice is:

- adopt the stronger turn-end extraction rules
- integrate with CrawClaw task/runtime/action/archive
- keep CrawClaw's existing durable store and upsert path

That gives us Claude's stronger extraction policy without bypassing the runtime architecture we already built.
