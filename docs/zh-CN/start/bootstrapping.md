---
read_when:
  - 了解智能体首次运行时会发生什么
  - 解释引导文件存放在哪里
  - 调试新手引导身份设置
summary: 用于初始化工作区和身份文件的智能体引导流程
title: 智能体引导
sidebarTitle: 引导
x-i18n:
  generated_at: "2026-06-10T09:23:48Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 789458713a15ab51bcf67ab45aa93f165a5f91b1522eff7a17c7de604775afb8
  source_path: start/bootstrapping.md
  workflow: 15
---

# 智能体引导

引导是准备智能体工作区并收集身份详情的**首次运行**流程。它发生在新手引导之后，也就是智能体第一次启动时。

## 引导会做什么

首次运行智能体时，CrawClaw 会引导工作区（默认 `~/.crawclaw/workspace`）：

- 写入 `AGENTS.md`、`BOOTSTRAP.md`、`IDENTITY.md`、`USER.md`。
- 运行一个简短的问答流程（一次只问一个问题）。
- 将身份和偏好写入 `IDENTITY.md`、`USER.md`、`SOUL.md`。
- 完成后移除 `BOOTSTRAP.md`，确保该流程只运行一次。

## 在哪里运行

引导始终在 **Gateway 主机** 上运行。如果远程客户端连接到其他位置的 Gateway，工作区和引导文件也位于那台远程机器上。

<Note>
当 Gateway 在另一台机器上运行时，请在 Gateway 主机上编辑工作区文件，例如 `user@gateway-host:~/.crawclaw/workspace`。
</Note>

## 相关文档

- 工作区布局：[智能体工作区](/concepts/agent-workspace)
