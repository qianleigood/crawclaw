---
read_when:
  - 你需要网络架构和安全概述
  - 你在调试本地与 tailnet 访问或配对问题
  - 你想要网络文档的权威列表
summary: 网络中心：gateway 网关暴露面、配对、设备发现和安全
title: 网络
x-i18n:
  generated_at: "2026-06-05T14:40:40Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 71f56a41b5831c622ef8204eec92d220fe902114c2568a70d2b810c14501b1b0
  source_path: network.md
  workflow: 15
---

# 网络中心

本中心链接 CrawClaw 在 local loopback、LAN 和 tailnet 上连接、配对和保护设备的核心文档。

## 核心模型

大多数操作通过 Gateway 网关（CrawClaw Desktop 或本地 Gateway API）进行，这是一个单一的长运行进程，负责渠道连接和 WebSocket 控制平面。

- **local loopback 优先**：Gateway WS 默认为 `ws://127.0.0.1:18789`。非 local loopback 绑定需要令牌。
- **建议每台主机一个 Gateway 网关**。如需隔离，请使用隔离的配置文件和端口运行多个 gateway（[多 Gateway 网关](/gateway/multiple-gateways)）。
- **远程访问**通常使用 SSH 隧道或 Tailscale VPN（[远程访问](/gateway/remote)）。

关键参考：

- [Gateway 架构](/concepts/architecture)
- [Gateway 协议](/gateway/protocol)
- [Gateway 运行手册](/gateway)
- [远程访问](/gateway/remote)

## 配对 + 身份

- [配对概述](/channels/pairing)
- [设备配对（配对 + 令牌轮换）](/network)
- [配对（私信批准）](/channels/pairing)

本地信任：

- 本地连接（local loopback 或 gateway 主机自身的 tailnet 地址）可以自动批准配对，以保持同主机用户体验流畅。
- 非本地 tailnet/LAN 客户端仍需明确的配对批准。

## 设备发现 + 传输协议

- [设备发现和传输协议](/gateway/discovery)
- [Bonjour / mDNS](/gateway/bonjour)
- [远程访问（SSH）](/gateway/remote)
- [Tailscale](/gateway/tailscale)

## 安全

- [安全概述](/gateway/security)
- [Gateway 配置参考](/gateway/configuration)
- [故障排除](/gateway/troubleshooting)
- [Doctor](/gateway/doctor)
