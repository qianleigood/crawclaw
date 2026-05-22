---
read_when:
  - 调试群消息投递
  - 更新渠道消息规范化
summary: 群聊、聊天室和线程化渠道的消息处理规则
title: 群消息
x-i18n:
  generated_at: "2026-05-22T02:11:28Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 386c3d7fe6f8fc33430e307f7910d3d82cf655d3cf9c74ef1950a44f75607d1b
  source_path: channels/group-messages.md
  workflow: 15
---

# 群消息

群消息在到达智能体运行时之前由 Gateway 网关进行规范化。渠道适配器提供聊天室、发件人、线程和回复元数据；Gateway 网关应用访问策略和路由；运行时看到类型化的渠道信封。

## 消息结构

- Channel ID 标识适配器。
- Sender ID 标识发送消息的人员或机器人。
- Room 或 thread ID 标识共享对话。
- 回复元数据在渠道支持时会被保留。

## 相关

- [消息](/concepts/messages)
- [群组](/channels/groups)
- [渠道故障排除](/channels/troubleshooting)
