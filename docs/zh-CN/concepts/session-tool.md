---
read_when:
  - 你想了解智能体拥有哪些会话工具
  - 你想配置跨会话访问或子智能体生成
summary: 用于列出会话、读取历史记录和跨会话消息传递的智能体工具
title: 会话工具
x-i18n:
  generated_at: "2026-06-05T14:14:38Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 1d830ee19c960259d80119955033ac542f10fd5370c311c6b40b5c5dd5c05d2d
  source_path: concepts/session-tool.md
  workflow: 15
---

# 会话工具

CrawClaw 为智能体提供跨会话工作的工具——列出对话、读取历史记录、向其他会话发送消息以及生成子智能体。

## 可用工具

| 工具               | 功能                                 |
| ------------------ | ------------------------------------ |
| `sessions_list`    | 列出会话，支持可选过滤（类型、最新） |
| `sessions_history` | 读取特定会话的对话记录               |
| `sessions_send`    | 向另一个会话发送消息，可选择等待回复 |
| `sessions_spawn`   | 生成用于后台工作的独立子智能体会话   |

## 列出和读取会话

`sessions_list` 返回会话及其键、类型、渠道、模型、代币计数和时间戳。按类型（`main`、`group`、`cron`、`hook`、`node`）或最新度（`activeMinutes`）过滤。

`sessions_history` 获取特定会话的对话记录。默认情况下，工具结果被排除——传入 `includeTools: true` 以查看它们。

两个工具都接受**会话键**（如 `"main"`）或先前列表调用返回的**会话 ID**。

## 发送跨会话消息

`sessions_send` 将消息传递到另一个会话，可选择等待回复：

- **即发即忘：**设置 `timeoutSeconds: 0` 以加入队列并立即返回。
- **等待回复：**设置超时时间并内联获取回复。

目标回复后，CrawClaw 可以运行**回复循环**，智能体交替发送消息（最多 5 回合）。目标智能体可以回复 `REPLY_SKIP` 以提前停止。

## 生成子智能体

`sessions_spawn` 为后台任务创建独立会话。它始终是非阻塞的——立即返回 `runId` 和 `childSessionKey`。

关键选项：

- `runtime: "subagent"`（默认）或外部 harness 智能体的 `"acp"`。
- 子会话的 `model` 和 `thinking` 覆盖。
- `thread: true` 将生成绑定到聊天线程（社区聊天、飞书等）。

子智能体获取完整工具集减去会话工具（不允许递归生成）。完成后，announce 步骤将结果发布到请求者的渠道。

关于 ACP 特定行为，请参阅 [ACP 智能体](/tools/acp-agents)。

## 可见性

会话工具的作用域限制了智能体可以查看的内容：

| 级别    | 作用域                         |
| ------- | ------------------------------ |
| `self`  | 仅当前会话                     |
| `tree`  | 当前会话 + 生成的子智能体      |
| `agent` | 此智能体的所有会话             |
| `all`   | 所有会话（如果配置了跨智能体） |

配置。

## 延伸阅读

- [会话管理](/concepts/session) — 路由、生命周期、维护
- [ACP 智能体](/tools/acp-agents) — 外部 harness 生成
- [多智能体](/concepts/multi-agent) — 多智能体架构
- [Gateway 配置](/gateway/configuration) — 会话工具配置旋钮
