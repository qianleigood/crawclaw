---
read_when:
  - 你想简要了解 Gateway 网络模型
summary: 客户端如何连接到 Gateway
title: 网络模型
x-i18n:
  generated_at: "2026-06-05T14:17:56Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: d21f5a9683dd41aa347aecec7a6c8ca69fa705cf8b629162a69ba8b46d050248
  source_path: gateway/network-model.md
  workflow: 15
---

# 网络模型

> 此内容已合并到[网络](/network#core-model)。请参阅该页面获取当前指南。

大多数操作通过 Gateway（CrawClaw Desktop 或本地 Gateway API）流动，这是一个单一的长运行进程，拥有渠道连接和 WebSocket 控制平面。

## 核心规则

- 建议每个主机一个 Gateway。它是唯一允许拥有 Weixin Web 会话的进程。对于救援机器人或严格隔离，使用隔离的配置和端口运行多个 gateway。参见[多 Gateway](/gateway/multiple-gateways)。
- 优先使用 local loopback：Gateway WS 默认为 `ws://127.0.0.1:18789`。向导默认生成 gateway 令牌，即使对于 local loopback 也是如此。对于 tailnet 访问，运行 CrawClaw Desktop 或本地 Gateway API，因为非 local loopback 绑定需要令牌。远程使用通常是 SSH 隧道或 tailnet VPN。参见[远程访问](/gateway/remote)和[设备发现](/gateway/discovery)。
