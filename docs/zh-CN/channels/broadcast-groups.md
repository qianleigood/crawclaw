---
read_when:
  - 配置一对多渠道传递
  - 审查群组路由行为
summary: 广播式群组路由和传递边界
title: 广播组
x-i18n:
  generated_at: "2026-05-22T02:11:06Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 42da07d4e718d1f79b11a317f68dd1d316ffd75279faa3577aa80a0986b08847
  source_path: channels/broadcast-groups.md
  workflow: 15
---

# 广播组

广播组是共享的传递目标，一个智能体响应可以被发送到一个已配置的群组或聊天室。只有在聊天室已明确获批且目标受众清晰时，才使用广播组。

## 安全防护措施

- 将广播目标列入白名单。
- 优先使用显式智能体绑定，而非隐式默认路由。
- 在启用广泛传递之前，确认渠道特定的回复行为。

## 相关内容

- [群组](/channels/groups)
- [渠道路由](/channels/channel-routing)
- [安全](/gateway/security)
