---
title: "Session vs Memory"
summary: "Boundary between raw session history and retained memory"
read_when:
  - You are working on sessions, transcript storage, or the durable memory agent
  - You need to explain what remains after a session is evaluated
---

# Session vs Memory

This document defines the boundary between sessions and memory in CrawClaw.

## Short Version

- A `session` is the record of what happened.
- `memory` is what remains valuable after the system evaluates what happened.

Sessions are raw history. Memory is retained information and experience.

## Session

A session is the execution and conversation trail for a run context.

A session should preserve:

- chronology
- message order
- tool usage
- execution context
- recent local state
- operator-visible history

Typical uses:

- replaying a conversation
- debugging or auditing behavior
- showing recent chat history
- loading the current working context
- resolving recent run state

Sessions are allowed to be noisy. They exist so the system does not lose fidelity.

## Memory

Memory is the subset of information that survives beyond the raw session because it is likely to matter again.

Memory should preserve:

- stable facts
- durable preferences
- user or project context
- recurring constraints
- retained experience worth future recall

Typical uses:

- future retrieval
- personalization
- durable context assembly
- cross-session reasoning
- experience recall

Memory should be selective. It exists so the system does not carry all history forever.

## Boundary Rule

If the system needs a faithful record, keep it in the session.

If the system needs a reusable retained signal, promote it into memory.

That means:

- all memory may originate from sessions
- not all session data should become memory

## What Stays In Session Only

Keep information in session history only when it is:

- transient
- procedural noise
- specific to one run
- useful mainly for audit or replay
- unlikely to matter later

Examples:

- intermediate tool traces
- failed attempts that carry no durable lesson
- message ordering details
- temporary run state
- ad hoc execution chatter

## What Should Move Into Memory

Promote session content into memory when it is:

- likely to matter again
- independent of one exact transcript position
- useful across future turns or sessions
- helpful for personalization or continuity

Examples:

- user preferences
- project conventions
- recurring environment facts
- durable task context
- summaries of important outcomes

## Anti-Patterns

### Treating session history as memory

This creates bloated recall and poor signal quality.

Symptoms:

- retrieval returns transcript noise
- memory grows too quickly
- prompts include procedural junk instead of useful context

### Treating memory like a transcript archive

This makes memory too expensive and too vague.

Symptoms:

- long, low-value retained records
- poor ranking
- repeated storage of equivalent raw interactions

## Product Framing

Use this wording consistently:

- Session answers: "What happened?"
- Memory answers: "What should matter later?"

## Architectural Mapping

Session-heavy areas today include:

- `src/sessions`
- `src/chat`
- `src/gateway`
- `src/agents/context-archive`

Memory-heavy areas today include:

- `src/memory/durable`
- `src/memory/experience`
- `src/memory/experience`
- `src/memory/recall`
- `src/memory/search`
- `src/memory/engine`

## Promotion Rule

The intended flow is:

1. Work happens in a session.
2. The system records the full trail.
3. Evaluation decides what is important.
4. Only the important subset is promoted into memory.

Memory should be derived from session history, not treated as a second copy of it.
