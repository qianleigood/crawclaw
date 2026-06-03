---
title: "Builtin Memory Runtime"
summary: "The default CrawClaw memory runtime for Hindsight recall, retain, reflection, and session summaries"
read_when:
  - You want to understand the default memory runtime
  - You want to configure the built-in memory database
  - You want to understand how Hindsight backs memory layers
---

# Builtin Memory Runtime

The builtin memory runtime is CrawClaw's default memory backend. It runs inside
the agent lifecycle and provides:

- **Durable memory** for scoped long-term facts and preferences in Hindsight
- **Experience memory** for reusable procedures, decisions, and failure patterns
  in Hindsight
- **Resource memory** for document, code, and reference recall in Hindsight
- **Mental models** for reflective synthesis in Hindsight
- **Session summaries** for compacted long-session continuity
- **Dream consolidation** for lower-frequency reflection and mental-model refresh

The runtime state is stored in SQLite at `memory.runtimeStore.dbPath`, which
defaults to `~/.crawclaw/memory-runtime.db`.

## Minimal config

Most users do not need to configure the builtin runtime. To pin the runtime DB:

```json5
{
  memory: {
    runtimeStore: {
      dbPath: "~/.crawclaw/memory-runtime.db",
    },
  },
}
```

Hindsight is optional and is configured under `memory.hindsight`. When it is
disabled or returns no useful result, CrawClaw keeps local session summaries but
skips Hindsight recall and retain for that turn. Hindsight owns semantic
relevance and ordering; CrawClaw preserves provider order and only applies
deterministic guardrails before prompt assembly. Run Hindsight as a sidecar or
remote service; CrawClaw only needs the HTTP API endpoint and bank configuration.

## Operational notes

- Durable, experience, resource, and mental-model layers are Hindsight banks.
- Auto retain runs after eligible completed turns, strips injected memory tags,
  and enqueues Hindsight `experience` writeback in the runtime outbox.
- `memory.outbox.process` is the worker entrypoint that drains pending retain
  jobs. `memory.status`, `memory.outbox.list`, and `memory.activity.list`
  expose queue health and recent activity.
- Explicit `remember` enqueues durable retain work; explicit
  `do-not-remember` skips Hindsight writeback for the turn; explicit `forget`
  is observable but currently marked unsupported because the Hindsight client
  has no delete API.
- Recall reads Hindsight only; if Hindsight is unavailable, recall sections are
  empty for that turn.
- Session summaries are maintained separately from durable memory and are used
  as compaction continuity.
- The `durable-memory`, `experience`, and `dream` special agents are constrained
  maintenance surfaces. They do not replace the normal prompt-time recall or
  `afterTurn` experience retain path.

For the full memory model, see [Memory Overview](/concepts/memory).
