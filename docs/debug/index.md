---
summary: Entry point for internal debug notes and investigation documents
read_when:
  - You are debugging CrawClaw internals
  - You need investigation notes, open items, or deep implementation writeups
title: Debug Docs
---

# Debug Docs

`debug/` holds investigation notes, architecture deep dives, open items, and implementation writeups that are useful to maintainers but are not primary product docs.

## Runtime And Lifecycle

- [Agent runtime open items](/debug/agent-runtime-open-items)
- [Run loop lifecycle spine](/debug/run-loop-lifecycle-spine)
- [Node issue notes](/debug/node-issue)

## Memory And Special Agents

- [Claude memory refactor](/debug/claude-memory-refactor)
- [Memory extractor agent](/debug/memory-extractor-agent)
- [Special agent substrate](/debug/special-agent-substrate)

## Architecture Deep Dives

- [Claude Code architecture](/debug/claude-code-architecture)

## How To Use This Section

- Treat these pages as maintainer notes, not stable user-facing references.
- Prefer `concepts/` and `reference/` when you need stable explanations or documented contracts.
