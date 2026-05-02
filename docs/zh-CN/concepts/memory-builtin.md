---
read_when:
  - 你想了解默认的记忆运行时
  - 你想要配置内置记忆数据库
  - 你想要了解哪些记忆层可以在不安装插件的情况下运行
summary: 用于持久笔记、体验召回、会话摘要和 Context Archive 的默认 CrawClaw 记忆运行时
title: 内置记忆运行时
x-i18n:
  generated_at: "2026-05-02T05:32:45Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 3426f3d169ad40689b83b9b221165fe58e5795d71fa96a4443a2bca4f0391648
  source_path: concepts/memory-builtin.md
  workflow: 15
---

# Builtin Memory Runtime

内置记忆运行时是 CrawClaw 的默认记忆后端。它在智能体生命周期内运行，并提供：

- **持久记忆** 用于作用域限定的长期 Markdown 笔记
- **体验记忆** 用于可复用流程、决策和失败模式
- **会话摘要** 用于压缩后长期会话的连续性
- **Dream 整合** 用于较低频率的持久记忆维护
- **Context Archive** 用于重放、导出和调试记录

运行时状态存储在 SQLite 中，位于 `memory.runtimeStore.dbPath`，默认为 `~/.crawclaw/memory-runtime.db`。

## 最小配置

大多数用户不需要配置内置运行时。要固定运行时数据库：

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

NotebookLM 是可选的，配置位于 `memory.notebooklm`。当它被禁用或返回无用结果时，CrawClaw 会跳过该回合的体验召回，而不是将本地发件箱作为后备读取。持久记忆召回仍独立运行。本地体验存储是 NotebookLM 的待处理写入队列和同步账本，而非提示召回来源。NotebookLM/Gemini 拥有体验召回的语义相关性和排序权；CrawClaw 保留提供商顺序，仅在提示组装前应用确定性防护栏。默认 NotebookLM CLI 路径使用 CrawClaw 管理的 `notebooklm-mcp-cli` 运行时（当已安装时）；运行 `crawclaw runtimes install` 或 `crawclaw runtimes repair` 如果
`nlm` 缺失。

## 操作说明

- 持久笔记存在于作用域限定的 Markdown 文件中，并在提示组装期间被召回。
- 体验提取在符合条件的回合完成后运行。
- 体验召回仅读取 NotebookLM；本地待处理条目在登录、心跳、启动或 `crawclaw memory sync`。
- 会话摘要与持久记忆分开维护，用作压缩连续性。
- Context Archive 默认关闭，除非在以下位置启用 `memory.contextArchive`。

完整的记忆模型，请参阅 [记忆概览](/concepts/memory)。
