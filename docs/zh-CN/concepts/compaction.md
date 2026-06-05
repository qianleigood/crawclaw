---
read_when:
  - 你想了解自动压缩和 /compact
  - 你在调试达到上下文限制的长会话
summary: CrawClaw 如何总结长对话以保持在模型限制内
title: 压缩
x-i18n:
  generated_at: "2026-06-05T14:12:13Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: d611d326a9cec2ae8a24626ad85a9a08e2860faf89688994b9a53844eb87a399
  source_path: concepts/compaction.md
  workflow: 15
---

# 压缩

每个模型都有一个上下文窗口——它能处理的最大 token 数量。当对话接近该限制时，CrawClaw 会**压缩**旧消息为摘要，以便聊天可以继续。

## 工作原理

1. 旧的对话轮次被总结为一个压缩条目。
2. 摘要保存在会话记录中。
3. 最近的消息保持完整。

完整的对话历史保留在磁盘上。压缩只改变模型在下一轮看到的内容。

## 自动压缩

自动压缩默认开启。当会话接近上下文限制时，或当模型返回上下文溢出错误时（此时 CrawClaw 会压缩并重试），自动压缩就会运行。

<Info>
在压缩之前，CrawClaw 会自动提醒智能体将重要笔记保存到[记忆](/concepts/memory)文件中。这可以防止上下文丢失。
</Info>

## 手动压缩

在任何聊天中输入 `/compact` 可以强制进行压缩。添加说明以指导摘要生成：

```
/compact Focus on the API design decisions
```

## 使用不同的模型

默认情况下，压缩使用你智能体的主模型。你可以使用更强大的模型来获得更好的摘要：

```json5
{
  agents: {
    defaults: {
      compaction: {
        model: "openrouter/anthropic/claude-sonnet-4-6",
      },
    },
  },
}
```

## 压缩开始通知

默认情况下，压缩静默运行。若要在压缩开始时显示简短通知，请启用 `notifyUser`：

```json5
{
  agents: {
    defaults: {
      compaction: {
        notifyUser: true,
      },
    },
  },
}
```

启用后，用户在每次压缩运行开始时会看到一条简短消息（例如"正在压缩上下文..."）。

## 压缩与修剪

|                | 压缩               | 修剪                     |
| -------------- | ------------------ | ------------------------ |
| **作用**       | 总结旧对话         | 裁剪旧工具结果           |
| **是否保存？** | 是（在会话记录中） | 否（仅在内存中，按请求） |
| **范围**       | 整个对话           | 仅工具结果               |

[会话修剪](/concepts/session-pruning) 是一种更轻量的补充，它在不总结的情况下裁剪工具输出。

## 故障排除

**压缩过于频繁？** 模型的上下文窗口可能较小，或者工具输出可能较大。尝试启用[会话修剪](/concepts/session-pruning)。

**压缩后上下文感觉过时了？** 使用 `/compact Focus on <topic>` 来引导摘要生成，或启用[记忆刷新](/concepts/memory) 以便笔记能够保留。

**需要一个干净的状态？** `/new` 会在不压缩的情况下开始新会话。

有关高级配置（保留 token、标识符保留、自定义上下文引擎、OpenAI 服务器端压缩），请参阅[会话管理深度探讨](/reference/session-management-compaction)。

## 相关

- [会话](/concepts/session) — 会话管理和生命周期
- [会话修剪](/concepts/session-pruning) — 裁剪工具结果
- [上下文](/concepts/context) — 如何为智能体轮次构建上下文
- [钩子](/automation/hooks) — 压缩生命周期钩子（before_compaction、after_compaction）
