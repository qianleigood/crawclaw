---
read_when:
  - 将频道流量路由到智能体
  - 更新多智能体频道行为
summary: 频道消息如何映射到智能体、会话和投递目标
title: 频道路由
x-i18n:
  generated_at: "2026-05-22T02:11:08Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 2223087fc6632a7ab0b15904375e3944a8ef484e48f46d4599b31381e9b3f4a3
  source_path: channels/channel-routing.md
  workflow: 15
---

# 频道路由

频道路由决定哪个智能体和会话应处理入站消息。Gateway 网关在启动智能体循环之前，会评估频道标识、发件人或群组标识、允许列表以及配置的路由规则。

## 路由模型

- 私信通常按频道账户加发件人进行映射。
- 群组、聊天室和线程使用其频道特定的聊天室或线程标识。
- 多智能体设置将发件人或群组绑定到智能体 ID。
- 智能体运行时从 Gateway 网关接收规范化的频道信封。

## 相关

- [多智能体](/concepts/multi-agent)
- [消息](/concepts/messages)
- [群组](/channels/groups)
