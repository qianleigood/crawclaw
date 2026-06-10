---
read_when:
  - 你想了解会话路由和隔离
  - 你想为多用户设置配置私信范围
summary: CrawClaw 如何管理对话会话
title: 会话管理
x-i18n:
  generated_at: "2026-06-05T14:14:57Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: d11af812b9117f8ff9e81f84187662f7463a697d0caaf0b8eabaad16b2bce6f0
  source_path: concepts/session.md
  workflow: 15
---

# 会话管理

CrawClaw 将对话组织成**会话**。每条消息根据其来源路由到会话——私信、群聊、定时任务等。

## 消息路由方式

| 来源      | 行为             |
| --------- | ---------------- |
| 私信      | 默认共享会话     |
| 群聊      | 每个群独立       |
| 房间/频道 | 每个房间独立     |
| 定时任务  | 每次运行全新会话 |
| Webhook   | 每个 hook 独立   |

## 私信隔离

默认情况下，所有私信共享一个会话以保持连续性。这对于单用户设置没有问题。

<Warning>
如果多人可以向你的智能体发送消息，请启用私信隔离。否则，所有用户共享同一个对话上下文——Alice 的私信对 Bob 可见。
</Warning>

**修复方法：**

```json5
{
  session: {
    dmScope: "per-channel-peer", // 按渠道 + 发送者隔离
  },
}
```

其他选项：

- `main`（默认）——所有私信共享一个会话。
- `per-peer`——按发送者隔离（跨渠道）。
- `per-channel-peer`——按渠道 + 发送者隔离（推荐）。
- `per-account-channel-peer`——按账户 + 渠道 + 发送者隔离。

<Tip>
如果同一人从多个渠道联系你，使用 `session.identityLinks` 链接他们的身份，以便他们共享一个会话。
</Tip>

使用 CrawClaw Desktop 或本地 Gateway API 验证你的设置。

## 会话生命周期

会话会被重复使用直到过期：

- **每日重置**（默认）——在网关主机当地时间凌晨 4:00 创建新会话。
- **空闲重置**（可选）——在一段时间不活动后创建新会话。设置 `session.reset.idleMinutes`。
- **手动重置**——在聊天中输入 `/new`。`/new <model>` 也可以切换模型。

如果同时配置了每日和空闲重置，则以先到期的为准。

## 状态存储位置

所有会话状态由**网关**拥有。UI 客户端向网关查询会话数据。

- **存储：** `~/.crawclaw/agents/<agentId>/sessions/sessions.json`
- **记录：** `~/.crawclaw/agents/<agentId>/sessions/<sessionId>.jsonl`

## 会话维护

CrawClaw 自动限制会话存储随时间的增长。默认情况下，它以 `warn` 模式运行（报告将被清理的内容）。将 `session.maintenance.mode` 设置为 `"enforce"` 以进行自动清理：

```json5
{
  session: {
    maintenance: {
      mode: "enforce",
      pruneAfter: "30d",
      maxEntries: 500,
    },
  },
}
```

使用 CrawClaw Desktop 或本地 Gateway API 进行预览。

## 检查会话

- `/health` ——网关、会话存储路径和最近活动。
- `/sessions` ——已存储会话列表。使用工具目录中的 `session_status` 检查当前会话。
- 聊天中的 `/status` ——上下文使用量、模型和切换状态。
- `/context list` ——系统提示词中的内容。

## 延伸阅读

- [会话修剪](/concepts/session-pruning) ——修剪工具结果
- [压缩](/concepts/compaction) ——总结长对话
- [会话工具](/concepts/session-tool) ——用于跨会话工作的智能体工具
- [会话管理深度探讨](/reference/session-management-compaction) ——存储 schema、记录、发送策略、来源元数据和高级配置
- [多智能体](/concepts/multi-agent) ——跨智能体的路由和会话隔离
- [后台任务](/automation/tasks) —— detached 工作如何创建带有会话引用的任务记录
- [渠道路由](/channels/channel-routing) ——入站消息如何路由到会话
