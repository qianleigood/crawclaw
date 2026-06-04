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

Hindsight is optional and is configured under `memory.hindsight`. CrawClaw
Desktop stages a pinned `hindsight-embed` release binary into the embedded
runtime during packaging, verifies its sha256, and prepares that local sidecar
when no explicit Hindsight endpoint is configured. If the sidecar binary is
unavailable, Desktop records that lifecycle state and keeps memory local instead
of forcing failing writeback. Hindsight owns semantic relevance and ordering;
CrawClaw preserves provider order and only applies deterministic guardrails
before prompt assembly. Run Hindsight as the Desktop-managed sidecar or as a
remote service; CrawClaw only needs the HTTP API endpoint and bank
configuration.

## Operational notes

- Durable, experience, resource, and mental-model layers are Hindsight banks.
- Auto retain runs after eligible completed turns, strips injected memory tags,
  and enqueues Hindsight `experience` writeback in the runtime outbox.
- The gateway and Desktop gateway start an automatic outbox worker. The worker
  drains pending retain and forget jobs in small batches; `memory.outbox.process`
  remains available for manual drains and tests.
- `memory.status` reports Hindsight lifecycle, worker state, outbox counts,
  recent activity, and Desktop policy overlays. `memory.outbox.list` and
  `memory.activity.list` expose queue and activity details.
- Explicit `remember` enqueues durable retain work; explicit
  `do-not-remember` skips Hindsight writeback for the turn; explicit `forget`
  enqueues a local tombstone. Tombstones suppress matching future recall by
  target id or forget query while avoiding destructive remote deletes until the
  Hindsight API exposes a stable delete operation.
- Chinese and mixed Chinese-English memory paths use built-in quality guards:
  long retain payloads are sentence-chunked with overlap metadata, recall
  queries get deterministic bilingual technical aliases, and local score plus
  top-rerank caps run before prompt injection. The active quality profile is
  reported by `memory.status`, and advanced deployments can override these
  guardrails under `memory.hindsight.quality`.
- Desktop local memory items carry `provider`, `layer`, `bankId`, and sync
  status metadata. Create and edit operations enqueue retain work for Hindsight
  when available; cleanup enqueues a forget tombstone and hides the local item.
- Recall reads Hindsight and filters locally tombstoned items. If Hindsight is
  unavailable, recall sections are empty for that turn.
- Session summaries are maintained separately from durable memory and are used
  as compaction continuity.
- The `durable-memory`, `experience`, and `dream` special agents are constrained
  maintenance surfaces. They do not replace the normal prompt-time recall or
  `afterTurn` experience retain path.

For the full memory model, see [Memory Overview](/concepts/memory).
