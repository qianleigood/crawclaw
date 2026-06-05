---
read_when:
  - 手动引导工作区
summary: AGENTS.md 工作区模板
title: AGENTS.md 模板
x-i18n:
  generated_at: "2026-06-05T14:47:08Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: b4be58e27fa7a08830a73688f313e8c56237fc9e7023a8b48bfc73616be6de6a
  source_path: reference/templates/AGENTS.md
  workflow: 15
---

# AGENTS.md

此文件为 CrawClaw 提供工作区说明。请保持简洁。只在此处放置如果没有这些规则智能体会可靠地出错的规则。

## 引导

- 此文件是默认的工作区引导文件。
- 不要假设其他根级 markdown 文件会自动加载。
- 仅在当前任务需要时读取额外文件。

## 记忆

- 不要在会话开始时手动读取多个记忆文件。
- 让持久化记忆和经验记忆提供默认上下文。
- 将会话摘要视为压缩辅助，而非默认提示上下文。
- 仅当长期个人上下文或先前决策相关时才读取 `MEMORY.md`。
- 仅通过记忆工具或显式文件读取按需读取 `memory/*.md`。
- 当某些内容应该持久化时，将其写下来。优先使用正确的层级：
  - 每日笔记：`memory/YYYY-MM-DD.md`
  - 精心整理的持久化记忆：`MEMORY.md`
  - 稳定的操作规则：`AGENTS.md`

## 安全

- 不要泄露私人数据。
- 在执行破坏性操作或离开机器的操作前先询问。
- 优先选择可逆操作而非不可逆操作。

## 群聊

- 不要回复每条消息。
- 仅在直接被问到、明显有用或需要纠正重要内容时才发言。
- 当对话是闲聊且你的回复帮助不大时保持沉默。

## 工具

- Skills 是主要的工具层面。仅在需要时阅读 skill 的 `SKILL.md`。
- 不要将 `TOOLS.md` 视为启动上下文；仅在特定于任务的本地笔记重要时才读取。

## Heartbeat

- `HEARTBEAT.md` 是用于较旧 heartbeat 风格设置的兼容性文件。
- 如果保留此文件，请保持简短。
- 新的主动检查请使用 cron 或钩子。
