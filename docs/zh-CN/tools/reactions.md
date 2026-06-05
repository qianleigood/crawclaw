---
read_when:
  - 在任何渠道中处理反应
  - 了解表情反应在不同平台上的差异
summary: 所有支持渠道的反应工具语义
title: 反应
x-i18n:
  generated_at: "2026-06-05T14:51:48Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: fd6912f12cc329fd6ec2604b973f72b229f017c548810ffcc21118fbeb36ba24
  source_path: tools/reactions.md
  workflow: 15
---

# 反应

智能体可以使用带有 `react` 操作的 `message` 工具在消息上添加和删除表情反应。反应行为因渠道而异。

## 工作原理

```json
{
  "action": "react",
  "messageId": "msg-123",
  "emoji": "thumbsup"
}
```

- 添加反应时需要 `emoji`。
- 将 `emoji` 设置为空字符串（`""`）以删除机器人的反应。
- 设置 `remove: true` 以删除特定表情（需要非空的 `emoji`）。

## 渠道行为

<AccordionGroup>
  <Accordion title="QQBot 和 DingTalk">
    - 空的 `emoji` 删除机器人在该消息上的所有反应。
    - `remove: true` 仅删除指定的 emoji。
  </Accordion>

  <Accordion title="飞书">
    - 空的 `emoji` 删除应用在该消息上的反应。
    - `remove: true` 仅删除指定的 emoji。
  </Accordion>

  <Accordion title="飞书">
    - 空的 `emoji` 删除机器人的反应。
    - `remove: true` 也会删除反应，但工具验证仍需要非空的 `emoji`。
  </Accordion>

  <Accordion title="Weixin">
    - 空的 `emoji` 删除机器人反应。
    - `remove: true` 在内部映射到空 emoji（工具调用中仍需要 `emoji`）。
  </Accordion>

  <Accordion title="飞书个人版（feishu）">
    - 需要非空的 `emoji`。
    - `remove: true` 删除该特定表情反应。
  </Accordion>

  <Accordion title="Signal">
    - 入站反应通知由活跃的 Rust 原生渠道适配器控制，当该适配器暴露反应事件时。
  </Accordion>
</AccordionGroup>

## 反应级别

每个渠道的 `reactionLevel` 配置控制智能体使用反应的广泛程度。值通常为 `off`、`ack`、`minimal` 或 `extensive`。

- [飞书 reactionLevel](/channels/index#reaction-notifications) — `channels.feishu.reactionLevel`
- [Weixin reactionLevel](/channels/index#reaction-level) — `channels.weixin.reactionLevel`

在各个渠道上设置 `reactionLevel` 以调整智能体在每个平台上对消息的反应活跃度。

## 相关

- [智能体发送](/tools/agent-send) — 包含 `react` 的 `message` 工具
- [渠道](/channels) — 渠道特定配置
