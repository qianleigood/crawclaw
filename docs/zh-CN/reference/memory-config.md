---
read_when:
  - 你想要配置 CrawClaw 记忆
  - 你想要启用 Hindsight 支撑的体验召回
  - 你想要调整会话摘要或 dream 整合
summary: Hindsight 原生记忆运行时和会话摘要的配置键
title: 记忆配置参考
x-i18n:
  generated_at: "2026-05-02T05:44:53Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 9a75b647a917d7a7d76407434f3e2dd8453af2d5e3ccc77db8df921176a18d81
  source_path: reference/memory-config.md
  workflow: 15
---

# 记忆配置参考

CrawClaw 记忆配置位于顶级 `memory` 键。旧的每智能体搜索配置已被移除。

如需了解概念模型，请从以下内容开始：

- [记忆概览](/concepts/memory)
- [内置记忆运行时](/concepts/memory-builtin)

## 运行时存储

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

Hindsight 是面向提示的召回、保留、反思和 mental model 提供商。当前写入通过 Hindsight knowledge ingestion 路径执行，不保留重复的本地负载。Hindsight 负责语义相关性和排序；CrawClaw 保留提供商顺序，仅应用本地防护栏，如源过滤、去重、空内容检查和提示预算限制。

| Key                                                      | Type      | Default             | Description                                   |
| -------------------------------------------------------- | --------- | ------------------- | --------------------------------------------- |
| `memory.hindsight.enabled`                               | `boolean` | `false`             | Enable Hindsight recall and writeback         |
| `memory.hindsight.baseUrl`                               | `string`  | `""`                | Hindsight HTTP API base URL                   |
| `memory.hindsight.apiKey`                                | `string`  | `""`                | Optional bearer token for the Hindsight API   |
| `memory.hindsight.apiKeyEnv`                             | `string`  | `""`                | Env var name that contains the bearer token   |
| `memory.hindsight.bankPrefix`                            | `string`  | `crawclaw`          | Prefix for derived Hindsight banks            |
| `memory.hindsight.bankGranularity`                       | `array`   | `agent`             | Dimensions used to derive bank IDs            |
| `memory.hindsight.sharedMode`                            | `boolean` | `false`             | Use one shared Hindsight bank                 |
| `memory.hindsight.sharedBankId`                          | `string`  | `crawclaw:shared`   | Shared bank ID when shared mode is enabled    |
| `memory.hindsight.memoryMode`                            | `string`  | `hybrid`            | Assembly mode for Hindsight plus summaries    |
| `memory.hindsight.autoRetain`                            | `boolean` | `true`              | Automatically retain eligible completed turns |
| `memory.hindsight.retainRoles`                           | `array`   | `user`, `assistant` | Roles eligible for retain payloads            |
| `memory.hindsight.retainEveryNTurns`                     | `number`  | `1`                 | Eligible turn interval for auto retain        |
| `memory.hindsight.retainOverlapTurns`                    | `number`  | `0`                 | Prior turns included when retaining           |
| `memory.hindsight.retainAsync`                           | `boolean` | `false`             | Run retain work asynchronously when supported |
| `memory.hindsight.defaultBudget`                         | `string`  | `mid`               | Recall budget: `low`, `mid`, or `high`        |
| `memory.hindsight.maxTokens`                             | `number`  | `2048`              | Maximum Hindsight recall tokens               |
| `memory.hindsight.recallContextTurns`                    | `number`  | `1`                 | Recent turns used to compose recall queries   |
| `memory.hindsight.recallMaxQueryChars`                   | `number`  | `800`               | Maximum recall query characters               |
| `memory.hindsight.recallTypes`                           | `array`   | `observation`       | Hindsight memory types requested in recall    |
| `memory.hindsight.recallInjectionPosition`               | `string`  | `prepend`           | Where recall is injected into model context   |
| `memory.hindsight.autoReflect`                           | `boolean` | `true`              | Enable dream-time reflection                  |
| `memory.hindsight.reflectBudget`                         | `string`  | `high`              | Hindsight budget for reflection calls         |
| `memory.hindsight.reflectMaxTokens`                      | `number`  | `2048`              | Maximum reflection output tokens              |
| `memory.hindsight.defaultMentalModels`                   | `boolean` | `true`              | Maintain default mental-model banks           |
| `memory.hindsight.enableKnowledgeTools`                  | `boolean` | `false`             | Expose Hindsight-backed knowledge tools       |
| `memory.hindsight.tagsMatch`                             | `string`  | `all_strict`        | Tag matching mode for recall filters          |
| `memory.hindsight.tags`                                  | `array`   | `agent:main`        | Base tags sent with Hindsight operations      |
| `memory.hindsight.timeoutMs`                             | `number`  | `15000`             | HTTP timeout for Hindsight calls              |
| `memory.hindsight.languageHints.primaryLanguage`         | `string`  | `auto`              | Language hint for bank descriptions           |
| `memory.hindsight.languageHints.bilingualTechnicalTerms` | `boolean` | `true`              | Expand Chinese and English technical terms    |

## Dream 和摘要

| Key                                             | Description                            |
| ----------------------------------------------- | -------------------------------------- |
| `memory.dreaming.enabled`                       | Enable Hindsight reflection jobs       |
| `memory.dreaming.minHours`                      | Minimum hours between dream scans      |
| `memory.dreaming.minSessions`                   | Minimum sessions before consolidation  |
| `memory.sessionSummary.enabled`                 | Enable session-summary maintenance     |
| `memory.sessionSummary.minTokensToInit`         | Token threshold before first summary   |
| `memory.sessionSummary.minTokensBetweenUpdates` | Token growth threshold between updates |
| `memory.sessionSummary.toolCallsBetweenUpdates` | Tool-call threshold between updates    |
