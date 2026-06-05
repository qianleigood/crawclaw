---
read_when:
  - 运行或调试 gateway 进程
  - 调查单实例强制执行
summary: 使用 WebSocket 监听器绑定的 Gateway 单例保护
title: Gateway 锁
x-i18n:
  generated_at: "2026-06-05T14:16:30Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: a206a25e79f5ae2e9ed507d7db52c5db02570990c15b3815d6644d6b6bc46a91
  source_path: gateway/gateway-lock.md
  workflow: 15
---

# Gateway 锁

## 为什么

- 确保同一主机上每个基础端口只有一个 gateway 实例运行；额外的 gateway 必须使用隔离配置和唯一端口。
- 在崩溃/SIGKILL 后不留下陈旧的锁文件。
- 当控制端口已被占用时快速失败并给出清晰的错误。

## 机制

- Gateway 在启动时立即使用独占 TCP 监听器绑定 WebSocket 监听器（默认 `ws://127.0.0.1:18789`）。
- 如果绑定失败并返回 `EADDRINUSE`，启动会抛出 `GatewayLockError("another gateway instance is already listening on ws://127.0.0.1:<port>")`。
- 操作系统在任何进程退出时自动释放监听器，包括崩溃和 SIGKILL——无需单独的锁文件或清理步骤。
- 关闭时，gateway 关闭 WebSocket 服务器和底层 HTTP 服务器以及时释放端口。

## 错误面

- 如果另一个进程占用端口，启动会抛出 `GatewayLockError("another gateway instance is already listening on ws://127.0.0.1:<port>")`。
- 其他绑定失败显示为 `GatewayLockError("failed to bind gateway socket on ws://127.0.0.1:<port>: …")`。

## 操作说明

- 如果端口被**另一个**进程占用，错误相同；释放端口或通过 CrawClaw Desktop 或本地 Gateway API 选择另一个端口。
- 本地启动器可能在生成 gateway 之前维护自己的轻量级 PID 保护；运行时锁由 WebSocket 绑定强制执行。

## 相关

- [多 Gateway](/gateway/multiple-gateways) — 使用唯一端口运行多个实例
- [故障排除](/gateway/troubleshooting) — 诊断 `EADDRINUSE` 和端口冲突
