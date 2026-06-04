---
read_when:
  - 你想了解默认的记忆运行时
  - 你想配置内置记忆数据库
  - 你想了解 Hindsight 如何支持记忆层
summary: 默认的 CrawClaw 记忆运行时，用于 Hindsight 的回忆、保留、反思和会话摘要
title: 内置记忆运行时
x-i18n:
  generated_at: "2026-06-04T03:23:13Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: fd80ec787a108bb9a5af48e054918fbac746b2ea51b2e033c297452b4b5eb6e2
  source_path: concepts/memory-builtin.md
  workflow: 15
---

# 内置记忆运行时

内置记忆运行时是 CrawClaw 的默认记忆后端。它在智能体生命周期内运行，提供：

- **持久记忆**：用于 Hindsight 中的有范围长期事实和偏好设置
- **经验记忆**：用于 Hindsight 中的可重用程序、决策和失败模式
- **资源记忆**：用于 Hindsight 中的文档、代码和引用回忆
- **心智模型**：用于 Hindsight 中的反思性综合
- **会话摘要**：用于压缩的长期会话连续性
- **梦境整合**：用于较低频率的反思和心智模型刷新

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

Hindsight 是可选的，在 `memory.hindsight` 下配置。CrawClaw Desktop 在打包期间将固定的 `hindsight-embed` 发布二进制文件暂存到嵌入式运行时中，验证其 sha256，并在未配置显式 Hindsight 端点时准备本地 sidecar。如果 sidecar 二进制文件不可用，Desktop 会记录该生命周期状态，并将记忆保留在本地，而不是强制失败的回写。Hindsight 拥有语义相关性和排序权；CrawClaw 保留提供商顺序，仅在提示词组装前应用确定性防护栏。将 Hindsight 作为 Desktop 管理的 sidecar 或远程服务运行；CrawClaw 只需要 HTTP API 端点和 bank 配置。

## 运维说明

- 持久、经验、资源和心智模型层是 Hindsight banks。
- 自动保留在符合条件的已完成轮次后运行，剥离注入的记忆标签，并在运行时发件箱中排队 Hindsight `experience` 回写。
- 网关和 Desktop 网关启动自动发件箱工作器。该工作器以小批量排出待处理的保留和遗忘任务；`memory.outbox.process` 仍然可用于手动排出和测试。
- `memory.status` 报告 Hindsight 生命周期、工作器状态、发件箱计数、最近活动以及 Desktop 策略覆盖。`memory.outbox.list` 和 `memory.activity.list` 公开队列和活动详情。
- 显式 `remember` 排队持久保留工作；显式 `do-not-remember` 跳过该轮次的 Hindsight 回写；显式 `forget` 排队本地墓碑标记。墓碑标记通过目标 id 或遗忘查询抑制匹配的将来回忆，同时避免破坏性远程删除，直到 Hindsight API 公开稳定的删除操作。
- 中文和混合中英文记忆路径使用内置质量防护：长保留载荷被分句分块并附带重叠元数据，回忆查询获得确定性双语技术别名，本地评分加上 top-rerank 上限在提示词注入前运行。活跃质量配置文件由 `memory.status` 报告，高级部署可以在 `memory.hindsight.quality` 下覆盖这些防护栏。
- Desktop 本地记忆项目携带 `provider`、`layer`、`bankId` 和同步状态元数据。创建和编辑操作在 Hindsight 可用时排队保留工作；清理排队遗忘墓碑标记并隐藏本地项目。
- 回忆读取 Hindsight 并过滤本地墓碑标记的项目。如果 Hindsight 不可用，该轮次的回忆部分为空。
- 会话摘要与持久记忆分开维护，用作压缩连续性。
- `durable-memory`、`experience` 和 `dream` 特殊智能体是受限的维护面。它们不会替换正常的提示词时回忆或 `afterTurn` 经验保留路径。

完整的记忆模型，请参阅[记忆概览](/concepts/memory)。
