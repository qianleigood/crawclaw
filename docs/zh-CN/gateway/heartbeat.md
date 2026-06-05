---
read_when:
  - 迁移旧的 heartbeat 配置
  - 决定如何替换周期性主会话检查
  - 区分智能体 heartbeat 和 keepalive 机制
summary: 遗留智能体 heartbeat 状态、已移除的界面和替代方案
title: Heartbeat
x-i18n:
  generated_at: "2026-06-05T14:17:09Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 2e443d4a3647b1e2898f7359e981c022f37dbe6ede8f7e9eca24333a8ec0c154
  source_path: gateway/heartbeat.md
  workflow: 15
---

# Heartbeat

遗留智能体 heartbeat 是旧的周期性主会话模型轮询。它要求智能体检查 `HEARTBEAT.md`、在空闲时回复 `HEARTBEAT_OK`，并可选地将提醒传递到聊天目标。

该周期性智能体轮询不再默认配置。不要使用遗留 heartbeat 配置进行新的自动化。使用[定时任务](/automation/cron-jobs)进行基于时间的检查，使用 Gateway API 系统事件进行事件驱动的主会话唤醒。

## 变更内容

- Gateway 网关不再安装默认的周期性 heartbeat 节奏。
- `agents.defaults.heartbeat.every`、按智能体的 `heartbeat.every` 和 `activeHours` 不再作为配置键接受。
- 运行时 `system heartbeat enable` 和 `system heartbeat disable` 控制已移除。
- `HEARTBEAT.md` 不再需要用于自动周期性检查。现有文件可以作为普通笔记保留在工作区，但新的自动化应放在 cron 任务、hooks 或常驻指令中。
- `HEARTBEAT_OK` 不应用作新流程的自动化契约。
- `system.mainSessionWake.last` 检查最近的主会话唤醒诊断事件。

## 改用这些

| 需求                                 | 使用                                    |
| ------------------------------------ | --------------------------------------- |
| 每 N 分钟或挂钟时间运行一次检查      | [定时任务](/automation/cron-jobs)       |
| 在系统事件后在主会话中运行           | Gateway API `system-event`              |
| 对生命周期、hooks 或外部事件做出反应 | [Hooks](/automation/hooks)              |
| 在上下文中保持始终在线的指令         | [常驻指令](/automation/standing-orders) |
| 跟踪分离的工作和完成状态             | [后台任务](/automation/tasks)           |

对于上下文感知的周期性检查，创建指向主会话的 cron 任务。对于精确或独立的工作，创建具有自己任务记录的正常 cron 任务。

## 诊断说明

剩余的诊断名称使用 `main-session-wake`，而不是遗留 heartbeat 模块名称。

- `system.mainSessionWake.last` 读取最后一个诊断事件。它不启用调度。
- `last-main-session-wake` 和 `system.mainSessionWake.last` RPC 方法是只读诊断。
- `next-heartbeat` 不再作为 wake-mode 值接受。对于事件驱动的主会话唤醒，使用 `now`。

## 未移除

不要删除或禁用每个名为 heartbeat 的功能。这些机制不是遗留智能体 heartbeat：

- Weixin Web `web.heartbeatSeconds` 保持 Web 渠道连接可观察。
- Hindsight 记忆同步 heartbeat 检查提供商可用性。
- WebSocket、gateway 和提供商 heartbeat 或 ping 帧保持协议连接活跃。

这些 keepalive 和认证路径继续使用其现有名称和配置以保持兼容性。

## 迁移清单

1. 从配置中移除 `agents.defaults.heartbeat.every`、按智能体 heartbeat 节奏设置和 `activeHours`。
2. 将调度检查移至[定时任务](/automation/cron-jobs)。
3. 将事件驱动后续操作移至 Gateway API `system-event` 或 hooks。
4. 保持渠道 keepalive 设置（如 `web.heartbeatSeconds`）不变。
5. 仅将 `system.mainSessionWake.last` 用于诊断。

## 相关

- [自动化与任务](/automation)
- [定时任务](/automation/cron-jobs)
- [后台任务](/automation/tasks)
- [Weixin](/channels/index)
