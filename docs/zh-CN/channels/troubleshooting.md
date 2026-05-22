---
read_when:
  - 渠道未连接或未投递消息
  - 调试渠道配对、允许列表或路由
summary: 渠道设置、投递和路由的故障排除入口
title: 渠道故障排除
x-i18n:
  generated_at: "2026-05-22T02:11:59Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: b0635fbc8ad3ad9c9b402dba35543fb3b285304901c8d69ce07fae49aa991961
  source_path: channels/troubleshooting.md
  workflow: 15
---

# 渠道故障排除

从 CrawClaw Desktop 状态和 Gateway 网关诊断开始。渠道问题通常属于四个领域之一：设置凭证、配对或允许列表、运行时生命周期或路由。

## 检查清单

- 确认 Gateway 网关正在运行且可从 CrawClaw Desktop 访问。
- 确认渠道已配置并启用。
- 检查发件人或聊天室的配对或允许列表状态。
- 检查渠道生命周期状态和最近日志。
- 确认路由映射到预期的智能体。

## 相关

- [Gateway 网关故障排除](/gateway/troubleshooting)
- [配对](/channels/pairing)
- [频道路由](/channels/channel-routing)
