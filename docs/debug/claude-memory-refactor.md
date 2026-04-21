---
read_when:
  - You want CrawClaw durable memory auto-write to behave more like Claude Code
  - You want a source-grounded comparison between Claude's extraction rules and CrawClaw's durable-memory implementation history
  - You want a practical refactor path instead of a vague memory redesign discussion
summary: A source-grounded refactor proposal for making CrawClaw durable memory extraction more Claude-like
title: Claude-style Durable Memory Refactor
---

# Claude-style Durable Memory Refactor

This document answers one concrete question:

**If we want CrawClaw durable memory auto-write to behave more like Claude Code, what should we actually change?**

It is grounded in current source behavior:

- Claude Code:
  - `src/memdir/memoryTypes.ts`
  - `src/services/extractMemories/extractMemories.ts`
  - `src/services/extractMemories/prompts.ts`
- CrawClaw:
  - `src/memory/engine/context-memory-runtime.ts`
  - `src/memory/durable/extraction.ts`
  - `src/memory/durable/worker-manager.ts`
  - `src/memory/context/render-routing-guidance.ts`

## What Claude does today

Claude's durable memory extraction has six important properties.

### 1. It runs at turn end, not on arbitrary after-turn events

Claude wires extraction into stop hooks:

- `src/query/stopHooks.ts`

The trigger is effectively:

- a full query loop finished
- the model produced a final response
- there are no more tool calls in that loop

So Claude's extraction is closer to:

**"the turn is over; now consolidate memory."**

### 2. It only looks at model-visible messages since the last extraction cursor

Claude only considers:

- `user`
- `assistant`

It ignores:

- tools
- progress
- system
- attachments

The key logic is in `src/services/extractMemories/extractMemories.ts`:

- `isModelVisibleMessage(...)`
- `countModelVisibleMessagesSince(...)`
- `lastMemoryMessageUuid`

So Claude is not "take the last 8 messages". It is:

**take model-visible messages added since the last extraction cursor.**

### 3. If the main conversation already wrote memory this turn, extraction skips

Claude has an explicit mutual exclusion rule:

- `hasMemoryWritesSince(...)` in `src/services/extractMemories/extractMemories.ts`

If the main conversation already wrote memory files:

- the background extractor skips
- the cursor still advances

This prevents double-writing and keeps explicit writes authoritative.

### 4. `feedback` is explicitly bidirectional

Claude's source is very clear:

- `feedback` should record **failure AND success**

See `src/memdir/memoryTypes.ts`.

It does not only save:

- "don't do this"

It also saves:

- "that non-obvious approach was correct; keep doing that"

### 5. Claude uses a forked memory extractor agent

Claude does not use a structured note extractor inside the runtime.
It:

- forks a memory extraction agent
- lets it write/update memory files
- then update `MEMORY.md`

See:

- `src/services/extractMemories/extractMemories.ts`
- `src/services/extractMemories/prompts.ts`

### 6. Claude also has a heavier consolidation layer

Claude has a second-stage background path:

- `src/services/autoDream/autoDream.ts`

So its memory stack is really:

- lightweight turn-end extraction
- heavier periodic consolidation

## What CrawClaw used to do, and what changed

CrawClaw now runs durable auto-write through `memory_extractor`, but the older
implementation is still useful as comparison context.

### 1. The legacy trigger lived in `afterTurn`

CrawClaw currently submits durable extraction from:

- `src/memory/engine/context-memory-runtime.ts`

inside `afterTurn()`, through:

- `src/memory/durable/worker-manager.ts`

### 2. The legacy extraction window was "the last 8 visible user/assistant messages from this turn's new messages"

The extraction input is built by:

- `collectRecentDurableConversation(...)` in `src/memory/durable/extraction.ts`

The rules are:

- keep only `user` / `assistant`
- keep only visible text
- then `.slice(-8)`

So the current behavior is:

**the last 8 visible user/assistant messages from this turn's new message batch.**

That is much narrower than Claude's cursor-based incremental window.

### 3. The old path used structured extraction + deterministic upsert

The old path used to:

- call `callStructuredOutput(...)` in `src/memory/durable/extraction.ts`
- get structured `notes[]`
- write them via `src/memory/durable/store.ts`

The current main path no longer does that in-process; it runs through the
background `memory_extractor` agent and still writes through the durable store.

### 4. The old skip rule was too broad

Today, CrawClaw skips durable extraction on:

- explicit durable writes
- successful `write_knowledge_note`

That second condition is wrong in practice.

Knowledge writes and durable writes are different layers. A successful NotebookLM write should not automatically suppress durable extraction for collaboration preferences or project context.

### 5. `feedback` semantics used to be weaker than Claude's

CrawClaw guidance already treats `feedback` as long-lived collaboration guidance, but it does not yet emphasize:

- save validated successes too
- not just corrections

That makes current feedback more corrective than reinforcing.

## What we should not copy from Claude

We should **not** copy Claude's implementation wholesale.

The biggest thing we should not transplant is:

- a forked memory agent that directly edits memory files

CrawClaw already has stronger infrastructure here:

- structured note normalization
- deterministic upsert
- prompt journal
- Context Archive
- task/runtime integration

So the right approach is:

**borrow Claude's lifecycle and policy, keep CrawClaw's durable store model, but not the old in-process extractor path.**

Promotion should stay separate from that durable recall path:

- durable notes are the prompt-time recall surface
- `dream` is the consolidation and repair layer for those notes
- promotion candidates are governance inputs for later review/writeback, not a
  third recall layer
- promotion payloads should keep an explicit `surface: governance_only` marker
  so tooling cannot accidentally treat them as prompt-time recall inputs

Durable recall observability should also stay explicit:

- selected notes should record whether they won on `index`, `header`,
  `body_rerank`, and/or `dream_boost`
- omitted notes should record whether they lost at `candidate_cutoff`,
  `ranked_below_limit`, `llm_filtered`, or `llm_none`
- recent dream `touchedNotes` should be surfaced in status/history/inspect so
  we can see whether consolidation is plausibly affecting later recall

## Recommended target shape

I recommend the following target model for CrawClaw.

### 1. Move from "last 8 recent messages" to cursor-based turn-end incremental extraction

Target behavior:

- only for top-level interactive sessions
- triggered at the end of a stable top-level turn
- uses a per-session extraction cursor
- only processes model-visible messages since the last extraction

So the rule becomes:

- not `newMessages.slice(-8)`
- but `model-visible messages since last durable extraction cursor`

### 2. Keep explicit write priority, but tighten the skip rule

Recommended skip rule:

- explicit durable write: skip auto extraction
- explicit durable delete: skip auto extraction
- `write_knowledge_note`: **do not skip durable extraction**

Rationale:

- knowledge and durable memory are different layers
- NotebookLM writes should not suppress durable collaboration memory

### 3. Upgrade `feedback` to explicitly include reinforcing guidance

We should align CrawClaw feedback semantics with Claude:

- corrections should save feedback
- confirmations of non-obvious successful approaches should also save feedback

The first stage does not need a brand new top-level type. The safer move is:

- keep top-level `feedback`
- strengthen prompt/examples/schema expectations

### 4. Introduce an extraction cursor

Suggested state:

```ts
type DurableExtractionCursor = {
  sessionKey: string;
  lastExtractedMessageId?: string;
  lastExtractedTurn?: number;
  lastRunAt?: number;
};
```

The extraction input should come from runtime-store queries, not just from in-memory turn slices.

We can still keep a hard ceiling for safety, but it should be a fallback bound, not the primary definition of "recent".

Suggested cap:

- 20 to 30 model-visible messages

### 5. Keep subagents out by default

CrawClaw already skips subagent sessions in:

- `src/memory/durable/worker-manager.ts`

That is the right default.

Durable memory should reflect top-level collaboration, not local task noise from subagents.

### 6. Keep extraction and dreaming/consolidation as separate layers

Long term, CrawClaw should explicitly separate:

- turn-end extraction
- periodic dreaming/consolidation

Do not make turn-end extraction carry the entire burden of long-horizon memory cleanup.

## Recommended refactor path

I recommend four PRs.

### PR1: Replace the "last 8 messages" window with a cursor-based incremental window

Target:

- extraction input no longer comes from `newMessages.slice(-8)`
- runtime store provides model-visible messages since the last extraction cursor

Likely files:

- `src/memory/runtime/runtime-store.ts`
- `src/memory/runtime/sqlite-runtime-store.ts`
- `src/memory/durable/worker-manager.ts`
- `src/memory/durable/extraction.ts`

### PR2: Narrow skip logic and stop suppressing durable extraction after `write_knowledge_note`

Target:

- durable extraction only conflicts with durable writes/deletes
- knowledge writes no longer suppress durable extraction

Likely file:

- `src/memory/durable/extraction.ts`

### PR3: Make feedback explicitly bidirectional

Target:

- prompt and routing guidance should say:
  - save corrections
  - save validated non-obvious successes

Likely files:

- `src/memory/context/render-routing-guidance.ts`
- `src/memory/durable/extraction.ts`
- memory docs

### PR4: Refactor lifecycle from generic `afterTurn` scheduling toward stable top-level turn-end scheduling

This is the only truly larger refactor.

Target:

- not "afterTurn got messages, so maybe queue extraction"
- but "the top-level turn ended in a stable state, so now evaluate extraction"

If a true stop-hook equivalent is hard to wire immediately, an intermediate version is acceptable:

- still schedule from `afterTurn`
- but only commit extraction after a stable top-level turn boundary

## What we should avoid

### Do not replace CrawClaw with Claude's file-native memory writer

That would throw away good parts of CrawClaw:

- structured extraction
- type normalization
- deterministic store upsert
- Context Archive integration

### Do not merge extraction and dreaming into one stage

They solve different problems:

- extraction = incremental turn-end memory capture
- dreaming = slower long-horizon consolidation

### Do not let subagents auto-write durable memory by default

That will amplify local task noise and weaken durable memory quality.

## Bottom line

The right change is:

**refactor CrawClaw durable memory into a Claude-style turn-end, cursor-driven, explicit-write-first extractor with bidirectional feedback semantics, while keeping CrawClaw's structured extraction and deterministic upsert model.**

The best order is:

1. cursor-based incremental window
2. remove `knowledge_write` suppression
3. bidirectional feedback
4. lifecycle refactor

That gets the highest-value behavior fixes first without forcing a risky full rewrite.
