---
read_when:
  - 设置私有渠道
  - 调试渠道审批或允许列表行为
summary: 可信私信、设备和渠道访问的配对模型
title: 渠道配对
x-i18n:
  generated_at: "2026-05-22T02:11:48Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: d5759f42bf4b3b5bb685ad8e6ff49568c52b93c280ba9cfc60a09da72cc5d909
  source_path: channels/pairing.md
  workflow: 15
---

# 渠道配对

配对是渠道访问的用户审批层。它保持本地 Gateway 网关控制的明确性：CrawClaw Desktop 显示待处理请求，Gateway 网关存储已批准状态，渠道投递使用最终的安全决策。

## 配对定位

- 配对是 Gateway 网关的安全决策，而非提供商的决策。
- 渠道特定的设置可以请求配对，但共享安全模型仍由 Gateway 网关管理。
- 设备和私信配对应使用来自渠道适配器的稳定标识符。

## 何时使用允许列表

当渠道有已知的发件人、聊天室或群组应被接受而无需交互式审批步骤时，使用允许列表。当操作员应从 CrawClaw Desktop 审批发件人或设备时，使用配对。

## 相关

- [安全](/gateway/security)
- [渠道](/channels)
- [群组](/channels/groups)
