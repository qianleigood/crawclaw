# CrawClaw Learning Loop

This document explains how CrawClaw should be understood as a learning system rather than a flat collection of tools, memory, and automation features.

The core loop is:

`action -> record -> evaluate -> retain -> recall -> automate -> action`

Each stage has a different job. Keeping these boundaries clear helps avoid overlap between sessions, memory, skills, and workflows.

## The Loop

### 1. Action

The agent performs work in the current turn:

- calls tools
- uses plugins
- interacts through gateway surfaces
- reads or writes files
- sends or receives messages

This is the execution surface of the system.

Relevant areas:

- `src/agents/tools`
- `src/gateway`
- `src/plugin-sdk`
- `src/plugins`

Question answered:

- "What should the system do right now?"

### 2. Record

The system records what happened without yet deciding what deserves long-term retention.

Examples:

- chat history
- transcripts
- gateway execution records
- tool traces
- run events
- context archive captures

This is raw operational history.

Relevant areas:

- `src/sessions`
- `src/chat`
- `src/agents/context-archive`
- `src/gateway/server-methods`

Question answered:

- "What happened?"

### 3. Evaluate

The system decides which parts of history are important enough to keep, summarize, or promote.

Examples:

- memory extraction
- session summary generation
- durable memory promotion
- compaction
- diagnostics and audit signals

This stage separates noise from signal.

Relevant areas:

- `src/memory/extraction`
- `src/memory/session-summary`
- `src/memory/durable`
- `src/memory/promotion`
- `src/memory/diagnostics`

Question answered:

- "What is worth keeping?"

### 4. Retain

Selected knowledge is stored in longer-lived memory structures.

Examples:

- durable memory records
- knowledge notes
- recall indexes
- vector or graph-backed memory
- NotebookLM-backed knowledge integration

This is not raw history. It is retained knowledge.

Relevant areas:

- `src/memory/durable`
- `src/memory/knowledge`
- `src/memory/notebooklm`
- `src/memory/search`
- `src/memory/recall`
- `src/memory/vector`
- `src/memory/graph`

Question answered:

- "Where does long-term knowledge live?"

### 5. Recall

When a new task begins, the system pulls the most relevant retained knowledge back into the working context.

Examples:

- relevant memory retrieval
- skill discovery
- recent transcript continuity
- compaction summary consumption
- context assembly
- synchronous durable recall

This is how the agent avoids starting from zero.

Relevant areas:

- `src/memory/engine`
- `src/memory/recall`
- `src/memory/search`
- `src/agents/query-context`
- `src/agents/skills`

Question answered:

- "What from the past should influence this task?"

### 6. Automate

When a pattern is stable enough, it should stop being just a recalled idea and become an explicit reusable capability.

This happens at multiple levels:

- a reusable instruction or method becomes a `skill`
- a repeatable multi-step procedure becomes a `workflow`
- a recurring or event-driven workflow becomes `cron` or `hook` automation

Relevant areas:

- `src/agents/skills`
- `src/workflows`
- `src/cron`
- `src/hooks`

Question answered:

- "What should stop being ad hoc and become reusable?"

## Canonical Boundaries

### Session

A session is the record of a conversation or run context.

It is:

- chronological
- trace-oriented
- useful for replay, audit, and recent context

It is not:

- a durable knowledge store
- a reusable behavior definition

Use sessions for:

- history
- transcript search
- recent execution state

### Memory

Memory is retained knowledge extracted from experience.

It is:

- curated
- longer-lived than a session
- intended for future retrieval

It is not:

- the raw transcript itself
- an executable automation plan

Use memory for:

- facts
- preferences
- durable context
- recalled knowledge snippets

### Knowledge

Knowledge is the structured or externalized subset of memory that is meant for explicit retrieval and reuse.

It may live in:

- local durable memory
- notebook-backed stores
- graph or vector systems
- promoted note stores

Use knowledge for:

- searchable retained information
- long-lived reference material
- cross-session recall

### Skill

A skill is a reusable way of doing something.

It is:

- method-oriented
- reusable across tasks
- narrower than a workflow

It is not:

- just a remembered fact
- a full operational process with deployment state

Use skills for:

- repeatable techniques
- instructions
- structured problem-solving patterns
- reusable task habits

### Workflow

A workflow is a defined multi-step execution path with state, topology, and operational behavior.

It is:

- process-oriented
- executable
- suitable for deployment, rerun, rollback, or automation

It is not:

- merely a hint or suggestion
- just a skill description

Use workflows for:

- repeatable procedures
- orchestrated tasks
- multi-step automation
- long-running or approval-aware process execution

## Promotion Path

The intended promotion path is:

1. A task happens inside a session.
2. The system records the full interaction.
3. Evaluation decides which parts matter.
4. Important information is retained as memory or knowledge.
5. Repeated successful approaches are turned into skills.
6. Stable multi-step skills become workflows.
7. Recurrent workflows become scheduled or event-driven automation.

This promotion ladder should stay directional:

- not every session artifact becomes memory
- not every memory item becomes a skill
- not every skill becomes a workflow
- not every workflow should be automated

## Decision Rules

Use these rules when deciding where something belongs.

### Put it in session history when:

- it is mainly useful as an audit trail
- it is tied to a single conversation or run
- it may be useful later, but has not been evaluated yet

### Put it in memory when:

- it is likely to matter again
- it survives beyond the current run
- it helps future recall or personalization

### Put it in a skill when:

- it describes a reliable method
- the method can be reused across many tasks
- it improves how the agent approaches work

### Put it in a workflow when:

- the process has clear steps
- state transitions matter
- it benefits from explicit run management, deployment, or rollback

### Put it behind cron/hooks when:

- the workflow is repeatable on a schedule
- the workflow is triggered by external events
- the operator wants autonomous execution rather than manual invocation

## Product Framing

CrawClaw should be explained as a growth system:

- it acts
- it records
- it learns
- it remembers
- it reuses
- it automates

That framing is stronger than listing features such as sessions, memory, skills, and workflows separately.

## Current Architectural Mapping

Today the project already contains the main pieces of this loop:

- action: `agents/tools`, `gateway`, `plugin-sdk`, `plugins`
- record: `sessions`, `chat`, `context-archive`, gateway execution surfaces
- evaluate: `memory/extraction`, `memory/session-summary`, `memory/promotion`
- retain: `memory/durable`, `memory/knowledge`, `memory/notebooklm`, `memory/vector`, `memory/graph`
- recall: `memory/engine`, `memory/search`, `memory/recall`, `agents/query-context`, `agents/skills`
- automate: `agents/skills`, `workflows`, `cron`, `hooks`

The main design challenge is no longer feature absence. It is maintaining crisp boundaries between these layers and presenting them as one coherent system.

## Future Documentation

Follow-up docs should expand this model with:

- session vs memory reference
- memory vs skill reference
- skill vs workflow reference
- workflow promotion and automation policy
- operator-facing guidance for when to retain, promote, or automate
