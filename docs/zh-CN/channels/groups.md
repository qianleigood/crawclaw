---
read_when:
  - 配置群聊
  - 审查群组白名单或上下文可见性
summary: 群组和聊天室渠道设置、白名单和上下文可见性
title: 群组
x-i18n:
  generated_at: "2026-05-22T02:11:26Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 8ecf303703898568793c53a604e74ece2f7afe2e182e5ddb9ffa8ba9c8a72c59
  source_path: channels/groups.md
  workflow: 15
---

# 群组

群聊和频道聊天室需要比私信更严格的设置。它们可以有更多参与者、共享上下文，以及不同的提及或回复规则。

## 上下文可见性和白名单

使用渠道白名单来决定 Gateway 网关接受哪些聊天室。使用上下文可见性设置来决定当群组消息成为智能体请求时，可以包含哪些历史消息。

## 模式：个人私信 + 公开群组 + 单一智能体

一种常见设置是为个人私信和选定的公开群组使用同一个智能体。将私信白名单和群组白名单分开，只有在可以接受共享上下文时，才将两者路由到同一个智能体。

## 相关内容

- [群组消息](/channels/group-messages)
- [广播组](/channels/broadcast-groups)
- [渠道路由](/channels/channel-routing)
