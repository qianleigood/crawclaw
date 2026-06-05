---
read_when:
  - 更改 typing indicators 行为或默认值
summary: CrawClaw 显示 typing indicators 的时机及如何调整
title: Typing Indicators
x-i18n:
  generated_at: "2026-06-05T14:15:20Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: d0eceea83e916b1c2e26b8c6bfa0adf98b72ee32f116f1befa1c8b531b3de0e7
  source_path: concepts/typing-indicators.md
  workflow: 15
---

# Typing Indicators

Typing indicators 在运行期间发送到聊天渠道。使用 `agents.defaults.typingMode` 控制 typing **何时**开始，使用 `typingIntervalSeconds` 控制**刷新频率**。

## 默认值

当 `agents.defaults.typingMode` **未设置**时，CrawClaw 保持传统行为：

- **私信**：一旦模型循环开始，立即开始 typing。
- **带提及的群聊**：立即开始 typing。
- **不带提及的群聊**：仅当消息文本开始流式传输时才开始 typing。
- **传统 Heartbeat 兼容性运行**：typing 禁用。

## 模式

将 `agents.defaults.typingMode` 设置为以下之一：

- `never` — 从不显示 typing indicator。
- `instant` — **一旦模型循环开始**就开始 typing，即使运行后来只返回静默回复 token。
- `thinking` — 在**第一个推理 delta** 时开始 typing（需要运行时的 `reasoningLevel: "stream"`）。
- `message` — 在**第一个非静默文本 delta** 时开始 typing（忽略 `NO_REPLY` 静默 token）。

"触发时间早晚"的顺序：
`never` → `message` → `thinking` → `instant`

## 配置

```json5
{
  agent: {
    typingMode: "thinking",
    typingIntervalSeconds: 6,
  },
}
```

你可以按会话覆盖模式或节奏：

```json5
{
  session: {
    typingMode: "message",
    typingIntervalSeconds: 4,
  },
}
```

## 注意事项

- `message` 模式不会为纯静默回复显示 typing（例如用于抑制输出的 `NO_REPLY` token）。
- `thinking` 仅在运行流式传输推理（`reasoningLevel: "stream"`）时触发。如果模型不发出推理 delta，typing 不会开始。
- 传统 Heartbeat 兼容性运行无论模式如何都不显示 typing。
- `typingIntervalSeconds` 控制**刷新节奏**，而不是开始时间。默认值为 6 秒。
