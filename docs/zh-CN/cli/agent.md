---
read_when:
  - 你想从脚本运行一个智能体回合（可选发送回复）
summary: "`crawclaw agent` 的 CLI 参考（通过 Gateway 网关发送一个智能体回合）"
title: agent
x-i18n:
  generated_at: "2026-02-03T07:44:38Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: dcf12fb94e207c68645f58235792596d65afecf8216b8f9ab3acb01e03b50a33
  source_path: cli/agent.md
  workflow: 15
---

# `crawclaw agent`

通过 Gateway 网关运行智能体回合（使用 `--local` 进行嵌入式运行）。使用 `--agent <id>` 直接指定已配置的智能体。

相关内容：

- 智能体发送工具：[Agent send](/tools/agent-send)

## 示例

```bash
crawclaw agent --to +15555550123 --message "status update" --deliver
crawclaw agent --agent ops --message "Summarize logs"
crawclaw agent --session-id 1234 --message "Summarize inbox" --thinking medium
crawclaw agent --agent ops --message "Generate report" --deliver --reply-channel slack --reply-to "#reports"
crawclaw agent inspect --run-id 778a918a-2a03-469f-9428-021272e341ee
crawclaw agent inspect --task-id 65b3fbc5-1827-4e99-b6f5-a9b964bcaa1d --json
crawclaw agent export-context --task-id 65b3fbc5-1827-4e99-b6f5-a9b964bcaa1d --json
```

## `agent inspect`

按 `runId` 或 `taskId` 检查一个 task-backed agent run。

它既可以看前台主运行，也可以看后台 subagent / ACP 子运行；前提是对应的
runtime/task 元数据已经落盘。

- 已经从日志或 transcript 拿到 runtime id 时，用 `--run-id`
- 想看任务/task-backed runtime 视图时，用 `--task-id`
- 脚本消费完整快照时，加 `--json`

inspection 输出会包含：

- runtime state
- task record
- runtime metadata 和 capability snapshot 引用
- trajectory 和 completion 摘要
- guard context
- 最近的 loop 摘要
- 基于 archive 的 query context 诊断
- 从 `run.lifecycle.*` archive event 重建的 run timeline

`agent inspect` 是只读入口，不会 resume、cancel 或修改运行状态。

如果 archive 数据可用，`agent inspect` 现在还会额外展示：

- provider / tool / subagent / compaction / stop 事件构成的紧凑 lifecycle timeline
- 每个 timeline entry 的 decision code 和 span 元数据
- 最新一份 query-context 快照，包括 section token 使用和 provider request 形态

示例：

```bash
crawclaw agent inspect --run-id 778a918a-2a03-469f-9428-021272e341ee
crawclaw agent inspect --task-id 65b3fbc5-1827-4e99-b6f5-a9b964bcaa1d --json
```

## `agent export-context`

导出某个 task-backed run 的 Context Archive 记录。

这是面向 replay / debug 的导出入口，不会修改运行状态。

- 已经拿到 runtime id 时，用 `--run-id`
- 想按 task-backed 视图导出时，用 `--task-id`
- 想按更宽的归档范围导出时，用 `--session-id` 或 `--agent-id`
- 想把导出包写到磁盘时，用 `--out <path>`
- 想给脚本消费 JSON 时，用 `--json`

示例：

```bash
crawclaw agent export-context --run-id 778a918a-2a03-469f-9428-021272e341ee --json
crawclaw agent export-context --task-id 65b3fbc5-1827-4e99-b6f5-a9b964bcaa1d --out /tmp/context-archive.json
```
