---
title: "Memory configuration reference"
summary: "Configuration keys for the built-in memory runtime, Hindsight, session summaries, and Context Archive"
read_when:
  - You want to configure CrawClaw memory
  - You want to enable Hindsight-backed experience recall
  - You want to tune session summaries, dream, or Context Archive
---

# Memory configuration reference

CrawClaw memory configuration lives under the top-level `memory` key. The old
per-agent search configuration has been removed.

For the conceptual model, start with:

- [Memory Overview](/concepts/memory)
- [Builtin Memory Runtime](/concepts/memory-builtin)

## Runtime store

| Key                          | Type     | Default                         | Description                  |
| ---------------------------- | -------- | ------------------------------- | ---------------------------- |
| `memory.runtimeStore.type`   | `string` | `"sqlite"`                      | Runtime store implementation |
| `memory.runtimeStore.dbPath` | `string` | `~/.crawclaw/memory-runtime.db` | SQLite DB path               |

```json5
{
  memory: {
    runtimeStore: {
      type: "sqlite",
      dbPath: "~/.crawclaw/memory-runtime.db",
    },
  },
}
```

## Hindsight

Hindsight is the prompt-facing provider for experience recall and
experience-note writeback. CrawClaw keeps a local pending outbox so experience
writes are not lost while Hindsight is unavailable. Successful writes do not
keep a duplicate local payload; pending local payloads are removed after they
sync to Hindsight. Hindsight is responsible for semantic relevance and ordering
during experience recall; CrawClaw preserves provider order and only applies
local guardrails such as source filtering, duplicate removal, empty-content
checks, and prompt-budget limits.

Hindsight runs as a sidecar or remote service. CrawClaw only stores the endpoint,
bank names, timeout, and recall policy; Python, Postgres, embedding models, and
rerankers belong to the Hindsight deployment. For Chinese-heavy recall, use a
multilingual Hindsight setup such as `BAAI/bge-m3` embeddings plus
`BAAI/bge-reranker-v2-m3` reranking, and configure the Hindsight text-search
extension that best supports Chinese keyword segmentation.

| Key                               | Type      | Default                          | Description                                   |
| --------------------------------- | --------- | -------------------------------- | --------------------------------------------- |
| `memory.hindsight.enabled`        | `boolean` | `false`                          | Enable Hindsight recall and writeback         |
| `memory.hindsight.baseUrl`        | `string`  | `""`                             | Hindsight HTTP API base URL                   |
| `memory.hindsight.apiKey`         | `string`  | `""`                             | Optional bearer token for the Hindsight API   |
| `memory.hindsight.apiKeyEnv`      | `string`  | `""`                             | Env var name that contains the bearer token   |
| `memory.hindsight.experienceBank` | `string`  | `crawclaw:main:experience`       | Bank used for experience recall and writes    |
| `memory.hindsight.durableBank`    | `string`  | `crawclaw:main:durable`          | Bank used for durable-derived recall          |
| `memory.hindsight.resourceBank`   | `string`  | `crawclaw:main:resource`         | Bank used for source/resource recall          |
| `memory.hindsight.defaultBudget`  | `string`  | `mid`                            | Hindsight recall budget: `low`, `mid`, `high` |
| `memory.hindsight.maxTokens`      | `number`  | `2048`                           | Maximum Hindsight recall tokens               |
| `memory.hindsight.timeoutMs`      | `number`  | `15000`                          | HTTP timeout for Hindsight calls              |
| `memory.hindsight.tagsMatch`      | `string`  | `all_strict`                     | Tag matching mode for recall filters          |
| `memory.hindsight.tags`           | `array`   | `agent:main`, `layer:experience` | Tags sent with recall and writeback           |

## Extraction and summaries

| Key                                             | Description                                 |
| ----------------------------------------------- | ------------------------------------------- |
| `memory.durableExtraction.enabled`              | Enable the durable memory agent             |
| `memory.experience.enabled`                     | Enable background experience extraction     |
| `memory.experience.maxNotesPerTurn`             | Maximum experience notes per completed turn |
| `memory.sessionSummary.enabled`                 | Enable session-summary maintenance          |
| `memory.sessionSummary.minTokensBetweenUpdates` | Token growth threshold between updates      |
| `memory.sessionSummary.toolCallsBetweenUpdates` | Tool-call threshold between updates         |

## Context Archive

| Key                                   | Description                              |
| ------------------------------------- | ---------------------------------------- |
| `memory.contextArchive.enabled`       | Enable Context Archive                   |
| `memory.contextArchive.mode`          | Archive mode: `off`, `replay`, or `full` |
| `memory.contextArchive.rootDir`       | Archive output directory                 |
| `memory.contextArchive.redactSecrets` | Redact secrets in archive payloads       |
| `memory.contextArchive.retentionDays` | Retention window for archive records     |
