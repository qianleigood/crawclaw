---
title: "Memory configuration reference"
summary: "Configuration keys for the built-in memory runtime, NotebookLM, QMD, session summaries, and Context Archive"
read_when:
  - You want to configure CrawClaw memory
  - You want to enable NotebookLM-backed experience recall
  - You want to tune session summaries, dream, or Context Archive
---

# Memory configuration reference

CrawClaw memory configuration lives under the top-level `memory` key. The old
per-agent search configuration has been removed.

For the conceptual model, start with:

- [Memory Overview](/concepts/memory)
- [Builtin Memory Runtime](/concepts/memory-builtin)
- [QMD Engine](/concepts/memory-qmd)

## Backend

| Key              | Type     | Default     | Description                         |
| ---------------- | -------- | ----------- | ----------------------------------- |
| `memory.backend` | `string` | `"builtin"` | Use `"builtin"` for CrawClaw memory |

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

## NotebookLM

NotebookLM is an optional provider for experience recall and experience-note
writeback.

| Key                                  | Type      | Description                    |
| ------------------------------------ | --------- | ------------------------------ |
| `memory.notebooklm.enabled`          | `boolean` | Enable NotebookLM integration  |
| `memory.notebooklm.auth.profile`     | `string`  | Local NotebookLM profile name  |
| `memory.notebooklm.auth.cookieFile`  | `string`  | Optional cookie file path      |
| `memory.notebooklm.cli.enabled`      | `boolean` | Enable CLI-backed read queries |
| `memory.notebooklm.cli.command`      | `string`  | Read command executable        |
| `memory.notebooklm.cli.args`         | `array`   | Read command arguments         |
| `memory.notebooklm.cli.notebookId`   | `string`  | Optional read notebook id      |
| `memory.notebooklm.write.enabled`    | `boolean` | Enable note writeback          |
| `memory.notebooklm.write.command`    | `string`  | Write command executable       |
| `memory.notebooklm.write.args`       | `array`   | Write command arguments        |
| `memory.notebooklm.write.notebookId` | `string`  | Optional write notebook id     |

## Extraction and summaries

| Key                                             | Description                                 |
| ----------------------------------------------- | ------------------------------------------- |
| `memory.durableExtraction.enabled`              | Enable durable-memory extraction            |
| `memory.durableExtraction.recentMessageLimit`   | Recent message window for extraction        |
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

## QMD

QMD remains configured under `memory.qmd` when you intentionally use the QMD
sidecar path. See [QMD Engine](/concepts/memory-qmd).
