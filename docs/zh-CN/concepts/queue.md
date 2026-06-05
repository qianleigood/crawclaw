---
read_when:
  - 更改智能体执行或并发设置
summary: 序列化入站智能体运行的命令队列设计
title: 命令队列
x-i18n:
  generated_at: "2026-06-05T14:14:08Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 61da29a37545bce3dadf57d9c823ffa62f2668c02db17699c2f670dcf5277bcd
  source_path: concepts/queue.md
  workflow: 15
---

# 命令队列（2026-01-16）

我们通过 Rust 运行时队列序列化入站智能体运行（所有渠道），以防止多个智能体运行发生碰撞，同时仍允许跨会话安全并行。

## 原因

- 智能体运行可能很昂贵（LLM 调用），当多个入站消息几乎同时到达时可能会发生碰撞。
- 序列化避免了争夺共享资源（会话文件、日志、CLI stdin）并减少了上游速率限制的可能性。

## 工作原理

- 支持通道感知的 FIFO 队列以可配置的并发上限排出每个通道（未配置通道默认为 1；main 默认为 4，subagent 为 8）。
- Rust 智能体运行时按**会话键**（通道 `session:<key>`）加入队列，以保证每个会话只有一个活动运行。
- 然后每个会话运行被加入**全局通道**（默认为 `main`），使整体并行度由 `agents.defaults.maxConcurrent` 限制。
- 启用详细日志时，排队的运行如果在开始前等待超过约 2 秒会发出简短通知。
- 打字指示器仍在加入队列时立即触发（当渠道支持时），因此在我们等待轮到自己时用户体验不变。

## 队列模式（按渠道）

入站消息可以控制当前运行、等待后续回合或同时执行两者：

- `steer`：立即注入当前运行（在下一个工具边界后取消待处理的工具调用）。如果不流式传输，则回退到后续。
- `followup`：在当前运行结束后加入下一个智能体回合的队列。
- `collect`：将所有排队的消息合并为**单个**后续回合（默认）。如果消息针对不同的渠道/线程，它们会单独排出以保留路由。
- `steer-backlog`（又称 `steer+backlog`）：立即接管**并且**保留消息以供后续回合使用。
- `interrupt`（旧版）：中止该会话的活动运行，然后运行最新消息。
- `queue`（旧别名）：与 `steer` 相同。

Steer-backlog 意味着你可以在被接管的运行之后获得后续响应，因此流式传输界面可能看起来像重复。如果你希望每个入站消息只有一个响应，首选 `collect`/`steer`。
发送 `/queue collect` 作为独立命令（按会话）或设置 `messages.queue.byChannel.feishu: "collect"`。

默认值（配置中未设置时）：

- 所有界面 → `collect`

通过 `messages.queue` 全局或按渠道配置：

```json5
{
  messages: {
    queue: {
      mode: "collect",
      debounceMs: 1000,
      cap: 20,
      drop: "summarize",
      byChannel: { feishu: "collect" },
    },
  },
}
```

## 队列选项

选项适用于 `followup`、`collect` 和 `steer-backlog`（以及当回退到 followup 时的 `steer`）：

- `debounceMs`：在开始后续回合前等待安静时间（防止"继续，继续"）。
- `cap`：每个会话的最大排队消息数。
- `drop`：溢出策略（`old`、`new`、`summarize`）。

Summarize 保留被丢弃消息的简短要点列表，并将其作为合成后续提示注入。
默认值：`debounceMs: 1000`、`cap: 20`、`drop: summarize`。

## 按会话覆盖

- 发送 `/queue <mode>` 作为独立命令以存储当前会话的模式。
- 选项可以组合：`/queue collect debounce:2s cap:25 drop:summarize`
- `/queue default` 或 `/queue reset` 清除会话覆盖。

## 范围和保证

- 适用于所有使用网关回复管道的入站渠道的 Rust 智能体运行。
- 默认通道（`main`）对于入站回复和主会话唤醒是进程范围的；设置 `agents.defaults.maxConcurrent` 以允许多个会话并行运行。
- 可能存在其他通道（例如 `cron`、`subagent`），以便后台作业可以并行运行而不会阻止入站回复。这些独立运行作为[后台任务](/automation/tasks)跟踪。
- 按会话通道保证只有一个智能体运行同时访问给定会话。
- 没有 TypeScript 智能体运行器参与执行；运行时所有权归 Rust。

## 故障排除

- 如果命令看起来卡住了，启用详细日志并查找"queued for …ms"行以确认队列正在排出。
- 如果你需要队列深度，启用详细日志并观察队列计时行。
