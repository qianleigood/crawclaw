---
title: "Memory configuration reference"
summary: "Configuration keys for the built-in memory runtime, NotebookLM, session summaries, and Context Archive"
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

NotebookLM is the prompt-facing provider for experience recall and
experience-note writeback. CrawClaw keeps a local pending outbox so experience
writes are not lost while NotebookLM auth is unavailable. Successful writes do
not keep a duplicate local payload; pending local payloads are removed after
they sync to NotebookLM.
NotebookLM/Gemini is responsible for semantic relevance and ordering during
experience recall; CrawClaw preserves provider order and only applies local
guardrails such as source filtering, duplicate removal, empty-content checks,
and prompt-budget limits.

The built-in CLI defaults target the unified
[`notebooklm-mcp-cli`](https://github.com/jacob-bd/notebooklm-mcp-cli) package.
CrawClaw installs it as a managed runtime during postinstall and
`crawclaw runtimes install`. Leave `memory.notebooklm.cli.command` empty to use
that managed `nlm` first, then PATH `nlm` as a fallback. Run `crawclaw memory
login` or `nlm login`, then set a notebook id for the read and write paths you
want CrawClaw to use.

| Key                                           | Type      | Description                     |
| --------------------------------------------- | --------- | ------------------------------- |
| `memory.notebooklm.enabled`                   | `boolean` | Enable NotebookLM integration   |
| `memory.notebooklm.auth.profile`              | `string`  | Local NotebookLM profile name   |
| `memory.notebooklm.auth.cookieFile`           | `string`  | Optional cookie file path       |
| `memory.notebooklm.auth.autoLogin.enabled`    | `boolean` | Enable periodic auto login      |
| `memory.notebooklm.auth.autoLogin.intervalMs` | `number`  | Auto login interval in ms       |
| `memory.notebooklm.auth.autoLogin.provider`   | `string`  | `nlm_profile` or `openclaw_cdp` |
| `memory.notebooklm.auth.autoLogin.cdpUrl`     | `string`  | CDP URL for OpenClaw provider   |
| `memory.notebooklm.cli.enabled`               | `boolean` | Enable CLI-backed read queries  |
| `memory.notebooklm.cli.command`               | `string`  | Optional read command override  |
| `memory.notebooklm.cli.args`                  | `array`   | Read command arguments          |
| `memory.notebooklm.cli.notebookId`            | `string`  | Optional read notebook id       |
| `memory.notebooklm.write.command`             | `string`  | Optional write command override |
| `memory.notebooklm.write.args`                | `array`   | Custom write command arguments  |
| `memory.notebooklm.write.notebookId`          | `string`  | Optional write notebook id      |

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
