---
read_when:
  - 你想减少工具输出导致的上下文增长
  - 你想了解 Anthropic 提示词缓存优化
summary: 修剪旧工具结果以保持上下文精简和缓存高效
title: 会话修剪
x-i18n:
  generated_at: "2026-06-05T14:14:36Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: cf0ca51e425310426fae28af10cf263656c7f62019ce71778c95c1c03bd2bc60
  source_path: concepts/session-pruning.md
  workflow: 15
---

# 会话修剪

会话修剪在每次 LLM 调用前从上下文中**修剪旧工具结果**。它减少累积工具输出（exec 结果、文件读取、搜索结果）导致的上下文膨胀，而不会影响你的对话消息。

<Info>
修剪仅在内存中进行——它不会修改磁盘上的会话记录。
你的完整历史始终被保留。
</Info>

## 为什么这很重要

长会话累积的工具体输出会膨胀上下文窗口。这会增加成本，并可能迫使[压缩](/concepts/compaction)比必要时间更早发生。

修剪对于 **Anthropic 提示词缓存** 尤其有价值。缓存 TTL 过期后，下一个请求会重新缓存完整提示。修剪减少缓存写入大小，直接降低成本。

## 工作原理

1. 等待缓存 TTL 过期（默认 5 分钟）。
2. 找到旧工具结果（用户和助手消息永不触碰）。
3. **软修剪**过大的结果——保留头部和尾部，插入 `...`。
4. **硬清除**其余部分——替换为占位符。
5. 重置 TTL，以便后续请求重用新缓存。

## 智能默认值

CrawClaw 为 Anthropic 配置自动启用修剪：

| 配置类型             | 启用修剪 |
| -------------------- | -------- |
| OAuth 或 setup-token | 是       |
| API 密钥             | 是       |

如果你设置了显式值，CrawClaw 不会覆盖它们。

## 启用或禁用

对于非 Anthropic 提供商，修剪默认关闭。启用方法：

```json5
{
  agents: {
    defaults: {
      contextPruning: { mode: "cache-ttl", ttl: "5m" },
    },
  },
}
```

禁用方法：设置 `mode: "off"`。

## 修剪 vs 压缩

|            | 修剪         | 压缩           |
| ---------- | ------------ | -------------- |
| **内容**   | 修剪工具结果 | 总结对话       |
| **保存？** | 否（按请求） | 是（在记录中） |
| **范围**   | 仅工具结果   | 整个对话       |

它们互补——修剪在压缩周期之间保持工具体输出精简。

## 延伸阅读

- [压缩](/concepts/compaction) — 基于总结的上下文减少
- [Gateway 配置](/gateway/configuration) — 所有修剪配置旋钮
  （`contextPruning.*`）
