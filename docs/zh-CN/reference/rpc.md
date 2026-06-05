---
read_when:
  - 添加或更改外部 CLI 集成
  - 调试 RPC 适配器（signal-cli、imsg）
summary: 外部 CLI（signal-cli、legacy imsg）和 gateway 网关模式的 RPC 适配器
title: RPC 适配器
x-i18n:
  generated_at: "2026-06-05T14:46:36Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 04e367259b4476bc1585792c6a6a489316ce4c38367b2f1380f62908a80ca126
  source_path: reference/rpc.md
  workflow: 15
---

# RPC 适配器

CrawClaw 通过 JSON-RPC 集成外部 CLI。当前使用两种模式。

## 模式 A：HTTP 守护进程（signal-cli）

- `signal-cli` 作为守护进程运行，通过 HTTP 提供 JSON-RPC。
- 事件流是 SSE（`/api/v1/events`）。
- 健康探测：`/api/v1/check`。
- CrawClaw 通过 Gateway 渠道 API 拥有 Rust 原生渠道适配器的生命周期。

## 模式 B：stdio 子进程（遗留：imsg）

> **注意：** 对于新的微信设置，请改用 [微信](/channels/index)。

- CrawClaw 将 `imsg rpc` 作为子进程生成（遗留微信集成）。
- JSON-RPC 通过 stdin/stdout 进行行分隔（一行一个 JSON 对象）。
- 无 TCP 端口，无需守护进程。

使用的核心方法：

- `watch.subscribe` → 通知（`method: "message"`）
- `watch.unsubscribe`
- `send`
- `chats.list`（探测/诊断）

有关遗留设置和寻址（优先使用 `chat_id`），请参见 [微信](/channels/index)。

## 适配器指南

- Gateway 网关拥有进程（启动/停止与提供商生命周期绑定）。
- 保持 RPC 客户端弹性：超时、退出时重启。
- 优先使用稳定 ID（例如 `chat_id`）而非显示字符串。
