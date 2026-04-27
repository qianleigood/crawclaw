---
read_when:
  - 你想在不创建 cron 作业的情况下入队系统事件
  - 你想查看最新的唤醒或 heartbeat 诊断事件
  - 你想检查系统在线状态条目
summary: "`crawclaw system` 的 CLI 参考（系统事件、heartbeat 诊断、在线状态）"
title: system
x-i18n:
  generated_at: "2026-02-03T07:45:23Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 36ae5dbdec327f5a32f7ef44bdc1f161bad69868de62f5071bb4d25a71bfdfe9
  source_path: cli/system.md
  workflow: 15
---

# `crawclaw system`

Gateway 网关的系统级辅助工具：入队系统事件、查看旧版 heartbeat 诊断和查看在线状态。

## 常用命令

```bash
crawclaw system event --text "Check for urgent follow-ups" --mode now
crawclaw system main-session-wake last
crawclaw system presence
```

## `system event`

在**主**会话上入队系统事件。下一次主会话运行会将其作为 `System:` 行注入到提示中。使用 `--mode now` 立即触发主会话唤醒。`now` 是默认值，也是唯一支持的 wake mode。

标志：

- `--text <text>`：必填的系统事件文本。
- `--mode <mode>`：`now`（默认）。
- `--json`：机器可读输出。

## `system main-session-wake last`

Heartbeat 诊断查看：

- `last`：显示最新的 heartbeat 或主会话唤醒诊断事件。

标志：

- `--json`：机器可读输出。

## `system presence`

列出 Gateway 网关已知的当前系统在线状态条目（节点、实例和类似状态行）。

标志：

- `--json`：机器可读输出。

## 注意

- 需要一个运行中的 Gateway 网关，可通过你当前的配置访问（本地或远程）。
- 系统事件是临时的，不会在重启后持久化。
- 旧版周期性 agent heartbeat 不能从这个命令组启用。新的计划检查请使用[定时任务](/automation/cron-jobs)。
