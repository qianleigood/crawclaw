---
title: "Builtin Memory Runtime"
summary: "The default CrawClaw memory runtime for durable notes, experience recall, session summaries, and Context Archive"
read_when:
  - You want to understand the default memory runtime
  - You want to configure the built-in memory database
  - You want to understand which memory layers run without plugins
---

# Builtin Memory Runtime

The builtin memory runtime is CrawClaw's default memory backend. It runs inside
the agent lifecycle and provides:

- **Durable memory** for scoped long-term Markdown notes
- **Experience memory** for reusable procedures, decisions, and failure patterns
- **Session summaries** for compacted long-session continuity
- **Dream consolidation** for lower-frequency durable-memory maintenance
- **Context Archive** for replay, export, and debug records

The runtime state is stored in SQLite at `memory.runtimeStore.dbPath`, which
defaults to `~/.crawclaw/memory-runtime.db`.

## Minimal config

Most users do not need to configure the builtin runtime. To pin the runtime DB:

```json5
{
  memory: {
    backend: "builtin",
    runtimeStore: {
      type: "sqlite",
      dbPath: "~/.crawclaw/memory-runtime.db",
    },
  },
}
```

NotebookLM is optional and is configured under `memory.notebooklm`. When it is
disabled or returns no useful result, CrawClaw skips experience recall for that
turn instead of reading the local outbox as a fallback. Durable-memory recall
still runs independently. The local experience index is a pending write queue
and sync ledger for NotebookLM. NotebookLM/Gemini owns semantic relevance and
ordering for experience recall; CrawClaw preserves provider order and only
applies deterministic guardrails before prompt assembly. The default NotebookLM
CLI path uses CrawClaw's managed `notebooklm-mcp-cli` runtime when it is
installed; run `crawclaw runtimes install` or `crawclaw runtimes repair` if
`nlm` is missing.

## Operational notes

- Durable notes live in scoped Markdown files and are recalled during prompt
  assembly.
- Experience extraction runs after eligible completed turns.
- Experience recall reads NotebookLM only; local pending entries sync after
  login, heartbeat, startup, or `crawclaw memory sync`.
- Session summaries are maintained separately from durable memory and are used
  as compaction continuity.
- Context Archive is off by default unless enabled under `memory.contextArchive`.

For the full memory model, see [Memory Overview](/concepts/memory).
