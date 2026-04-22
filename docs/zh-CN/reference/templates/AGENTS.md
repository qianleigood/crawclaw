---
read_when:
  - 手动引导初始化工作区
summary: AGENTS.md 的工作区模板
x-i18n:
  generated_at: "2026-04-09T11:30:00Z"
  model: claude-opus-4-5
  provider: pi
  source_path: reference/templates/AGENTS.md
  workflow: 15
---

# AGENTS.md

这个文件为 CrawClaw 提供工作区指令。保持简洁。只写“没有这条，模型就容易做错”的规则。

## Bootstrap

- 这个文件就是默认工作区 bootstrap。
- 不要假设其他根目录 markdown 文件会自动加载。
- 只有当前任务真的需要时，才去读额外文件。

## 记忆

- 不要在会话开始时手动读取多份记忆文件。
- 先让 session summary、durable recall 和 knowledge recall 提供默认上下文。
- 只有在确实需要长期个人背景或历史决策时，才读取 `MEMORY.md`。
- `memory/*.md` 只在按需情况下通过 memory 工具或显式读文件进入上下文。
- 需要长期保留的信息要写下来，并写到正确层级：
  - 每日日志：`memory/YYYY-MM-DD.md`
  - 精炼长期记忆：`MEMORY.md`
  - 稳定操作规则：`AGENTS.md`

## 安全

- 不要外泄隐私数据。
- 破坏性操作或会离开本机的操作先询问。
- 优先选择可回退、可恢复的动作。

## 群聊

- 不要回复每一条消息。
- 只有在被直接询问、能明显提供价值，或必须纠正重要错误时再发言。
- 如果只是轻松闲聊、你的回复价值很低，就保持安静。

## 工具

- Skills 是主要工具面。只有需要时才读取对应 `SKILL.md`。
- 不要把 `TOOLS.md` 当作启动上下文；只有任务真的依赖本地备注时才读取。

## 心跳

- `HEARTBEAT.md` 是旧 heartbeat 风格配置的兼容文件。
- 如果保留此文件，请保持简短。
- 新的主动检查请使用 cron 或 hooks。
