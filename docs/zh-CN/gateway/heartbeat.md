---
read_when:
  - 迁移旧 heartbeat 配置时
  - 决定如何替换周期性主会话检查时
  - 区分 agent heartbeat 与 keepalive 机制时
summary: 旧版 agent heartbeat 状态、兼容性入口和替代方案
title: 心跳
x-i18n:
  generated_at: "2026-02-03T07:48:57Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 18b017066aa2c41811b985564dd389834906f4576e85b576fb357a0eff482e69
  source_path: gateway/heartbeat.md
  workflow: 15
---

# 心跳

旧版 agent heartbeat 是过去的周期性主会话模型轮询。它会要求智能体检查
`HEARTBEAT.md`，空闲时回复 `HEARTBEAT_OK`，并可选地把提醒投递到聊天目标。

这种周期性 agent 轮询现在不再默认配置。新的自动化不要再使用旧 heartbeat
配置。基于时间的检查请使用 [Scheduled Tasks](/automation/cron-jobs)，事件驱动的主会话唤醒请使用 [system events](/cli/system)。

## 变化

- Gateway 不再安装默认的周期性 heartbeat cadence。
- `agents.defaults.heartbeat.every`、单智能体 `heartbeat.every` 和
  `activeHours` 不再是有效配置键。
- 运行时 `system heartbeat enable` 和 `system heartbeat disable` 控制已移除。
- 自动周期性检查不再要求 `HEARTBEAT.md`。已有文件可以继续作为工作区里的普通笔记保留，但新的自动化应放在 cron jobs、hooks 或 standing orders 中。
- 新流程不应把 `HEARTBEAT_OK` 当作自动化契约。
- `crawclaw system heartbeat last` 仍作为兼容性检查命令存在，用来读取最近一次 wake/heartbeat 诊断事件。

## 改用这些机制

| 需求                           | 使用                                           |
| ------------------------------ | ---------------------------------------------- |
| 每 N 分钟或在固定时间运行检查  | [Scheduled Tasks](/automation/cron-jobs)       |
| 系统事件后在主会话中运行       | [`crawclaw system event`](/cli/system)         |
| 响应生命周期、hooks 或外部事件 | [Hooks](/automation/hooks)                     |
| 让长期指令保持在上下文中       | [Standing Orders](/automation/standing-orders) |
| 跟踪分离工作和完成状态         | [Background Tasks](/automation/tasks)          |

需要对话上下文的周期性检查，可以创建目标为主会话的 cron job。需要精确或隔离的工作，则创建普通 cron job，并让它拥有自己的 task record。

## 兼容性说明

某些诊断 RPC 名称仍然包含 `heartbeat`，用于兼容旧客户端。请把这些名称视为只读诊断入口，而不是自动化模型。

- `crawclaw system heartbeat last` 读取最近一次诊断事件。它不会启用调度。
- `last-heartbeat` 和 `system.heartbeat.last` RPC 方法是只读兼容别名。
- `next-heartbeat` 不再是有效的 wake-mode 值。事件驱动的主会话唤醒请使用 `now`。

## 未移除的内容

不要删除或禁用所有名为 heartbeat 的功能。以下机制不是旧版 agent heartbeat：

- WhatsApp Web `web.heartbeatSeconds` 用来观察 Web 渠道连接状态。
- NotebookLM auth heartbeat 检查认证健康状态。
- WebSocket、Gateway 和 provider heartbeat/ping 帧用于保持协议连接存活。

这些 keepalive 和 auth 路径会继续使用已有名称和配置，以保持兼容。

## 迁移清单

1. 从配置中移除 `agents.defaults.heartbeat.every`、单智能体 heartbeat cadence 设置和 `activeHours`。
2. 将计划性检查迁移到 [Scheduled Tasks](/automation/cron-jobs)。
3. 将事件驱动的 follow-up 迁移到 [`crawclaw system event`](/cli/system) 或 hooks。
4. 保留 `web.heartbeatSeconds` 这类渠道 keepalive 设置。
5. 在旧事件名仍存在期间，只把 `crawclaw system heartbeat last --json` 用作诊断。

## 相关内容

- [Automation & Tasks](/automation)
- [Scheduled Tasks](/automation/cron-jobs)
- [Background Tasks](/automation/tasks)
- [System CLI](/cli/system)
- [WhatsApp](/channels/whatsapp)
