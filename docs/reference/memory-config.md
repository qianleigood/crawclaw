---
title: "Memory configuration reference"
summary: "Configuration keys for the Hindsight-native memory runtime and session summaries"
read_when:
  - You want to configure CrawClaw memory
  - You want to enable Hindsight-backed experience recall
  - You want to tune session summaries or dream consolidation
---

# Memory configuration reference

CrawClaw memory configuration lives under the top-level `memory` key. The old
per-agent search configuration has been removed.

For the conceptual model, start with:

- [Memory Overview](/concepts/memory)
- [Builtin Memory Runtime](/concepts/memory-builtin)

## Runtime store

| Key                          | Type     | Default                         | Description    |
| ---------------------------- | -------- | ------------------------------- | -------------- |
| `memory.runtimeStore.dbPath` | `string` | `~/.crawclaw/memory-runtime.db` | SQLite DB path |

```json5
{
  memory: {
    runtimeStore: {
      dbPath: "~/.crawclaw/memory-runtime.db",
    },
  },
}
```

## Hindsight

Hindsight is the prompt-facing provider for experience recall and experience
writeback. Current writes go through the Hindsight knowledge ingestion path and
do not keep a duplicate local payload. Hindsight is responsible for semantic
relevance and ordering during experience recall; CrawClaw preserves provider
order and only applies local guardrails such as source filtering, duplicate
removal, empty-content checks, and prompt-budget limits.

Hindsight runs as a sidecar or remote service. CrawClaw only stores the endpoint,
bank names, timeout, and recall policy; Python, Postgres, embedding models, and
rerankers belong to the Hindsight deployment. For Chinese-heavy recall, use a
multilingual Hindsight setup such as `BAAI/bge-m3` embeddings plus
`BAAI/bge-reranker-v2-m3` reranking, and configure the Hindsight text-search
extension that best supports Chinese keyword segmentation.

| Key                                                      | Type      | Default             | Description                                                      |
| -------------------------------------------------------- | --------- | ------------------- | ---------------------------------------------------------------- |
| `memory.hindsight.enabled`                               | `boolean` | `false`             | Enable Hindsight recall and writeback                            |
| `memory.hindsight.baseUrl`                               | `string`  | `""`                | Hindsight HTTP API base URL                                      |
| `memory.hindsight.apiKey`                                | `string`  | `""`                | Optional bearer token for the Hindsight API                      |
| `memory.hindsight.apiKeyEnv`                             | `string`  | `""`                | Env var name that contains the bearer token                      |
| `memory.hindsight.bankPrefix`                            | `string`  | `crawclaw`          | Prefix for derived Hindsight banks                               |
| `memory.hindsight.bankGranularity`                       | `array`   | `agent`             | Dimensions used to derive bank IDs                               |
| `memory.hindsight.sharedMode`                            | `boolean` | `false`             | Use one shared Hindsight bank                                    |
| `memory.hindsight.sharedBankId`                          | `string`  | `crawclaw:shared`   | Shared bank ID when shared mode is enabled                       |
| `memory.hindsight.memoryMode`                            | `string`  | `hybrid`            | `hybrid`, `context`, or `tools` recall mode                      |
| `memory.hindsight.autoRetain`                            | `boolean` | `true`              | Automatically retain eligible completed turns                    |
| `memory.hindsight.retainRoles`                           | `array`   | `user`, `assistant` | Roles eligible for retain payloads                               |
| `memory.hindsight.retainEveryNTurns`                     | `number`  | `1`                 | Eligible turn interval for auto retain                           |
| `memory.hindsight.retainOverlapTurns`                    | `number`  | `0`                 | Prior turns included when retaining                              |
| `memory.hindsight.retainAsync`                           | `boolean` | `false`             | Compatibility flag; turn-end retain uses the runtime outbox      |
| `memory.hindsight.defaultBudget`                         | `string`  | `mid`               | Recall budget: `low`, `mid`, or `high`                           |
| `memory.hindsight.maxTokens`                             | `number`  | `2048`              | Maximum Hindsight recall tokens                                  |
| `memory.hindsight.recallContextTurns`                    | `number`  | `1`                 | Recent turns used to compose recall queries                      |
| `memory.hindsight.recallMaxQueryChars`                   | `number`  | `800`               | Maximum recall query characters                                  |
| `memory.hindsight.recallTypes`                           | `array`   | `observation`       | Hindsight memory types requested in recall                       |
| `memory.hindsight.recallInjectionPosition`               | `string`  | `prepend`           | Where recall is injected into model context                      |
| `memory.hindsight.autoReflect`                           | `boolean` | `true`              | Enable dream-time reflection                                     |
| `memory.hindsight.reflectBudget`                         | `string`  | `high`              | Hindsight budget for reflection calls                            |
| `memory.hindsight.reflectMaxTokens`                      | `number`  | `2048`              | Maximum reflection output tokens                                 |
| `memory.hindsight.defaultMentalModels`                   | `boolean` | `true`              | Maintain default mental-model banks                              |
| `memory.hindsight.enableKnowledgeTools`                  | `boolean` | `false`             | Allow configured knowledge-tool access outside context-only mode |
| `memory.hindsight.tagsMatch`                             | `string`  | `all_strict`        | Tag matching mode for recall filters                             |
| `memory.hindsight.tags`                                  | `array`   | `agent:main`        | Base tags sent with Hindsight operations                         |
| `memory.hindsight.timeoutMs`                             | `number`  | `15000`             | HTTP timeout for Hindsight calls                                 |
| `memory.hindsight.languageHints.primaryLanguage`         | `string`  | `auto`              | Language hint for bank descriptions                              |
| `memory.hindsight.languageHints.bilingualTechnicalTerms` | `boolean` | `true`              | Expand Chinese and English technical terms                       |

`memory.hindsight.memoryMode` controls prompt recall and tool access:

- `hybrid`: prompt recall is enabled and configured knowledge tools may be used
  by runtime surfaces that allow them.
- `context`: prompt recall is enabled and knowledge-tool access is disabled.
- `tools`: prompt recall is disabled and configured knowledge tools are the
  explicit access path.

Automatic turn-end retain is separate from this prompt recall mode. Eligible
completed turns enqueue a Hindsight `experience` retain job when Hindsight is
enabled and auto retain is enabled. `memory.outbox.process` drains that queue.

## Dreaming and summaries

| Key                                             | Description                            |
| ----------------------------------------------- | -------------------------------------- |
| `memory.dreaming.enabled`                       | Enable Hindsight reflection jobs       |
| `memory.dreaming.minHours`                      | Minimum hours between dream scans      |
| `memory.dreaming.minSessions`                   | Minimum sessions before consolidation  |
| `memory.sessionSummary.enabled`                 | Enable session-summary maintenance     |
| `memory.sessionSummary.minTokensToInit`         | Token threshold before first summary   |
| `memory.sessionSummary.minTokensBetweenUpdates` | Token growth threshold between updates |
| `memory.sessionSummary.toolCallsBetweenUpdates` | Tool-call threshold between updates    |
