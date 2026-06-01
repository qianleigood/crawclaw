---
read_when:
  - 添加或修改后台执行行为
  - 调试长时间运行的执行任务
summary: 后台执行和进程管理
title: 后台执行与进程工具
x-i18n:
  generated_at: "2026-06-01T16:10:47Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: eed974f8d2821c1893599777c4066838abd699da79cc29f52d1521ae2de5d233
  source_path: gateway/background-process.md
  workflow: 15
---

# 后台执行 + 进程工具

CrawClaw 通过 `exec` 工具运行 shell 命令，并将长时间运行的任务保留在内存中。`process` 工具管理这些后台会话。

## exec 工具

主要参数：

- `command`（必填）
- `yieldMs`（默认 10000）：超过此延迟后自动转入后台
- `background`（布尔值）：立即转入后台
- `timeout`（秒，默认 1800）：超过此超时时间后终止进程
- `elevated`（布尔值）：如果启用/允许提升模式，则在主机上运行
- 需要真实 TTY？设置 `pty: true`。
- `workdir`、`env`

行为：

- 前台运行直接返回输出。
- 进入后台时（显式或超时），工具返回 `status: "running"` + `sessionId` 以及一小段尾部输出。
- 输出保留在内存中，直到会话被轮询或清除。
- 如果 `process` 工具被禁用，`exec` 会同步运行并忽略 `yieldMs`/`background`。
- 派生的 exec 命令接收 `CRAWCLAW_SHELL=exec`，以便进行上下文感知的 shell/profile 规则处理。

## 子进程桥接

当在 exec/process 工具外部派生长时间运行的子进程时（例如 CLI 重新生成或 gateway 网关辅助工具），请附加子进程桥接辅助工具，以便转发终止信号并在退出/错误时分离监听器。这可以避免 systemd 上的孤儿进程，并保持跨平台关机行为的一致性。

环境变量覆盖：

- `BASH_MAX_OUTPUT_LENGTH`：超大 shell 输出的持久化输出阈值。
  默认为 `30000` 字符，超过 `150000` 的值会被限制。

配置（首选）：

- `tools.exec.backgroundMs`（默认 10000）
- `tools.exec.timeoutSec`（默认 1800）
- `tools.exec.cleanupMs`（默认 1800000）
- `tools.exec.notifyOnExit`（默认 true）：当后台 exec 退出时，将系统事件加入队列并请求主会话唤醒。
- `tools.exec.notifyOnExitEmptySuccess`（默认 false）：设为 true 时，也会为产生无输出的成功后台运行入队完成事件。

## process 工具

操作：

- `list`：运行中 + 已完成的会话
- `poll`：排空会话的新输出（也报告退出状态）
- `log`：读取聚合输出（支持 `offset` + `limit`）
- `write`：发送 stdin（`data`，可选 `eof`）
- `kill`：终止后台会话
- `clear`：从内存中移除已完成的会话
- `remove`：如果正在运行则终止，否则如果已完成则清除

注意事项：

- 只有后台会话会被列出/持久化在内存中。
- 进程重启后会话会丢失（无磁盘持久化）。
- 仅当你运行 `process poll/log` 且工具结果被记录时，会话日志才会保存到聊天历史。
- `process` 按智能体作用域；它仅能看到该智能体启动的会话。
- `process list` 包含派生的 `name`（命令动词 + 目标），便于快速扫描。
- `process log` 使用基于行的 `offset`/`limit`。
- 当 `offset` 和 `limit` 都省略时，返回最后 200 行并包含分页提示。
- 当提供 `offset` 但省略 `limit` 时，从 `offset` 返回到结尾（不限制为 200）。

## 示例

运行长时间任务并稍后轮询：

```json
{ "tool": "exec", "command": "sleep 5 && echo done", "yieldMs": 1000 }
```

```json
{ "tool": "process", "action": "poll", "sessionId": "<id>" }
```

立即在后台启动：

```json
{ "tool": "exec", "command": "npm run build", "background": true }
```

发送 stdin：

```json
{ "tool": "process", "action": "write", "sessionId": "<id>", "data": "y\n" }
```
