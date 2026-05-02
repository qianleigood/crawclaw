---
read_when:
  - 你想要配置 CrawClaw 记忆
  - 你想要启用基于 NotebookLM 的体验召回
  - 你想要调整会话摘要、dream 或 Context Archive
summary: 内置记忆运行时、NotebookLM、会话摘要和 Context Archive 的配置键
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

NotebookLM 是面向提示的体验召回和体验笔记写回提供商。CrawClaw 保留本地待处理发件箱，以便在 NotebookLM 认证不可用时不会丢失体验写入。成功的写入不会保留重复的本地负载；待处理的本地负载在同步到 NotebookLM 后被移除。NotebookLM/Gemini 负责体验召回期间的语义相关性和排序；CrawClaw 保留提供商顺序，仅应用本地防护栏，如源过滤、去重、空内容检查和提示预算限制。

内置 CLI 默认目标统一
[`notebooklm-mcp-cli`](https://github.com/jacob-bd/notebooklm-mcp-cli) 包。CrawClaw 在 postinstall 期间将其作为托管运行时安装，并
`crawclaw runtimes install`：保留 `memory.notebooklm.cli.command` 空以使用该托管 `nlm` 先查找指定位置，然后再查找 PATH `nlm` 作为后备。运行 `crawclaw memory
login` 或 `nlm login`然后为读写路径设置 notebook ID，你希望 CrawClaw 使用这些路径。

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

## 提取和摘要

| Key                                             | Description                                 |
| ----------------------------------------------- | ------------------------------------------- |
| `memory.durableExtraction.enabled`              | Enable the durable memory agent             |
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
