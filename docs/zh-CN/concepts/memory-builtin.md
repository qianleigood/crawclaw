---
read_when:
  - 你想了解默认的记忆运行时
  - 你想要配置内置记忆数据库
  - 你想要了解 Hindsight 如何支撑记忆层
summary: 用于 Hindsight 召回、保留、反思和会话摘要的默认 CrawClaw 记忆运行时
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

- **持久记忆** 用于 Hindsight 中有作用域的长期事实和偏好
- **体验记忆** 用于 Hindsight 中可复用流程、决策和失败模式
- **会话摘要** 用于压缩后长期会话的连续性
- **Dream 整合** 用于较低频率的反思和 mental model 刷新

运行时状态存储在 SQLite 中，位于 `memory.runtimeStore.dbPath`，默认为 `~/.crawclaw/memory-runtime.db`。

## 最小配置

大多数用户不需要配置内置运行时。要固定运行时数据库：

```json5
{
  memory: {
    runtimeStore: {
      dbPath: "~/.crawclaw/memory-runtime.db",
    },
  },
}
```

Hindsight 是可选的，配置位于 `memory.hindsight`。当它被禁用或返回无用结果时，CrawClaw 会保留本地会话摘要，但跳过该回合的 Hindsight 召回和保留。Hindsight 拥有语义相关性和排序权；CrawClaw 保留提供商顺序，仅在提示组装前应用确定性防护栏。Hindsight 可以作为 sidecar 或远程服务运行；CrawClaw 只需要 HTTP API endpoint 和 bank 配置。

## 操作说明

- durable、experience、resource 和 mental-model 层都是 Hindsight banks。
- Auto retain 在符合条件的回合完成后运行，并在写入前剥离已注入的 memory tags。
- 召回仅读取 Hindsight；如果 Hindsight 不可用，该回合的召回部分为空。
- 会话摘要与持久记忆分开维护，用作压缩连续性。

完整的记忆模型，请参阅 [记忆概览](/concepts/memory)。
