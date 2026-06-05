---
read_when:
  - 调度后台任务或唤醒事件
  - 将外部触发器（Webhook、Gmail）接入 CrawClaw
  - 在主会话唤醒和独立定时任务之间做出选择
summary: 定时任务、Webhook 和 Gmail PubSub 触发器，用于 Gateway 调度器
title: 定时任务
x-i18n:
  generated_at: "2026-06-05T14:12:20Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 6d2fa4bf499d1dfebf499954989ea286843aee0bddc07286dbe95289494e5b23
  source_path: automation/cron-jobs.md
  workflow: 15
---

# 定时任务（Cron）

Cron 是 Gateway 网关的内置调度器。它会持久化任务、在正确的时间唤醒智能体，并将输出传递回聊天渠道或 Webhook 端点。

## 快速开始

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

## Cron 工作原理

- Cron 在 Gateway 网关**进程内部**运行（不在模型内部）。
- 任务持久化存储在 `~/.crawclaw/cron/jobs.json`，重启不会丢失调度计划。
- 所有 cron 执行都会创建[后台任务](/automation/tasks)记录。
- 一次性任务（`--at`）默认在成功后自动删除。

## 调度类型

| 类型    | CLI 标志  | 说明                                        |
| ------- | --------- | ------------------------------------------- |
| `at`    | `--at`    | 一次性时间戳（ISO 8601 或相对时间如 `20m`） |
| `every` | `--every` | 固定间隔                                    |
| `cron`  | `--cron`  | 5 字段或 6 字段 cron 表达式，可选 `--tz`    |

没有时区的时间戳被视为 UTC。添加 `--tz America/New_York` 以按本地挂钟时间调度。

每小时顶部的循环表达式会自动错开最多 5 分钟以减少负载峰值。使用 `--exact` 强制精确计时，或使用 `--stagger 30s` 设置显式窗口。

## 执行方式

| 方式       | `--session` 值      | 运行位置            | 适用场景             |
| ---------- | ------------------- | ------------------- | -------------------- |
| 主会话     | `main`              | 主会话运行器        | 提醒、系统事件       |
| 独立       | `isolated`          | 专用 `cron:<jobId>` | 报告、后台任务       |
| 当前会话   | `current`           | 创建时绑定          | 上下文感知的循环工作 |
| 自定义会话 | `session:custom-id` | 持久化命名会话      | 依赖历史的工作流     |

**主会话**任务会将系统事件加入队列并唤醒主会话运行器（`--wake now`）。**独立**任务会使用新的会话运行专用智能体回合。**自定义会话**（`session:xxx`）会在各次运行之间保持上下文，使类似每日站会这类依赖之前总结的工作流成为可能。

### 独立任务的负载选项

- `--message`：提示文本（独立任务必需）
- `--model` / `--thinking`：模型和思考级别覆盖
- `--light-context`：跳过工作区引导文件注入
- `--tools exec,read`：限制任务可使用的工具

## 传递和输出

| 模式       | 处理方式                               |
| ---------- | -------------------------------------- |
| `announce` | 将摘要传递到目标渠道（独立的默认模式） |
| `webhook`  | POST 完成的事件负载到 URL              |
| `none`     | 仅内部使用，不进行传递                 |

使用 `--announce --channel feishu --to "-1001234567890"` 进行渠道传递。对于飞书论坛话题，使用 `-1001234567890:topic:123`。DingTalk/QQBot/飞书目标应使用显式前缀（`channel:<id>`、`user:<id>`）。

## Gateway API 示例

一次性提醒（主会话）：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

带传递的循环独立任务：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

带模型和思考级别覆盖的独立任务：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

## Webhook

Gateway 网关可以为外部触发器暴露 HTTP Webhook 端点。在配置中启用：

```json5
{
  hooks: {
    enabled: true,
    token: "shared-secret",
    path: "/hooks",
  },
}
```

### 认证

每个请求必须通过 Header 包含 Hook 令牌：

- `Authorization: Bearer <token>`（推荐）
- `x-crawclaw-token: <token>`

查询字符串令牌将被拒绝。

### POST /hooks/wake

将系统事件加入主会话队列：

```bash
curl -X POST http://127.0.0.1:18789/hooks/wake \
  -H 'Authorization: Bearer SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"text":"New email received","mode":"now"}'
```

- `text`（必需）：事件描述
- `mode`（可选）：`now`（默认）。这将请求事件驱动的
  主会话唤醒。

### POST /hooks/agent

运行独立的智能体回合：

```bash
curl -X POST http://127.0.0.1:18789/hooks/agent \
  -H 'Authorization: Bearer SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"message":"Summarize inbox","name":"Email","model":"openai/gpt-5.2-mini"}'
```

字段：`message`（必需）、`name`、`agentId`、`wakeMode`、`deliver`、`channel`、`to`、`model`、`thinking`、`timeoutSeconds`。

### 映射 Hook（POST /hooks/\<name\>）

自定义 Hook 名称通过配置中的 `hooks.mappings` 解析。映射可以将任意负载转换为带有模板或代码转换的 `wake` 或 `agent` 操作。

### 安全

- 将 Hook 端点置于 local loopback、tailnet 或可信的反向代理之后。
- 使用专用的 Hook 令牌；不要重复使用 Gateway 认证令牌。
- 设置 `hooks.allowedAgentIds` 以限制显式的 `agentId` 路由。
- 除非需要调用者选择的会话，否则保持 `hooks.allowRequestSessionKey=false`。
- Hook 负载默认会包裹安全边界。

## Gmail PubSub 集成

通过 Google PubSub 将 Gmail 收件箱触发器接入 CrawClaw。

**前置条件**：`gcloud` CLI、`gog`（gogcli）、CrawClaw hooks 已启用、Tailscale 用于公共 HTTPS 端点。

### 向导设置（推荐）

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

这将写入 `hooks.gmail` 配置，启用 Gmail 预设，并使用 Tailscale Funnel 作为推送端点。

### 服务推送回调

CrawClaw 通过正常的 `/hooks/gmail` 映射路径接收 Gmail PubSub 回调。从你自己的服务管理器运行和更新 `gog gmail watch serve`，然后将其推送 URL 指向配置的 CrawClaw Hook URL。

### 手动一次性设置

1. 选择拥有 `gog` 所用 OAuth 客户端的 GCP 项目：

```bash
gcloud auth login
gcloud config set project <project-id>
gcloud services enable gmail.googleapis.com pubsub.googleapis.com
```

2. 创建主题并授予 Gmail 推送权限：

```bash
gcloud pubsub topics create gog-gmail-watch
gcloud pubsub topics add-iam-policy-binding gog-gmail-watch \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
```

3. 启动监视：

```bash
gog gmail watch start \
  --account crawclaw@gmail.com \
  --label INBOX \
  --topic projects/<project-id>/topics/gog-gmail-watch
```

### Gmail 模型覆盖

```json5
{
  hooks: {
    gmail: {
      model: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
      thinking: "off",
    },
  },
}
```

## 管理任务

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

## 配置

```json5
{
  cron: {
    enabled: true,
    store: "~/.crawclaw/cron/jobs.json",
    maxConcurrentRuns: 1,
    retry: {
      maxAttempts: 3,
      backoffMs: [60000, 120000, 300000],
      retryOn: ["rate_limit", "overloaded", "network", "server_error"],
    },
    webhookToken: "replace-with-dedicated-webhook-token",
    sessionRetention: "24h",
    runLog: { maxBytes: "2mb", keepLines: 2000 },
  },
}
```

禁用 cron：`cron.enabled: false` 或 `CRAWCLAW_SKIP_CRON=1`。

**一次性重试**：临时错误（速率限制、过载、网络、服务器错误）最多重试 3 次，指数退避。永久错误立即禁用。

**循环重试**：重试之间指数退避（30 秒到 60 分钟）。下次成功运行后重置退避时间。

### 维护

`cron.sessionRetention`（默认 `24h`）会清理独立的运行会话条目。
`cron.runLog.maxBytes` / `cron.runLog.keepLines` 会自动清理运行日志文件。

## 故障排除

### 命令阶梯

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化操作。

### Cron 未触发

- 检查 `cron.enabled` 和 `CRAWCLAW_SKIP_CRON` 环境变量。
- 确认 Gateway 网关正在持续运行。
- 对于 `cron` 调度，验证时区（`--tz`）与主机时区。
- 运行输出中的 `reason: not-due` 表示手动运行未使用 `--force`。

### Cron 触发但无传递

- 传递模式为 `none` 意味着不期望有外部消息。
- 传递目标缺失/无效（`channel`/`to`）意味着跳过了出站。
- 渠道认证错误（`unauthorized`、`Forbidden`）意味着传递被凭证阻止。

### 时区注意事项

- 没有 `--tz` 的 Cron 使用 Gateway 网关主机时区。
- 没有时区的 `at` 调度被视为 UTC。
- `activeHours` 不再是有效的 Heartbeat 配置键。Cron 调度使用
  任务时区或 Gateway 网关主机时区。

## 相关

- [自动化与任务](/automation) — 所有自动化机制一览
- [后台任务](/automation/tasks) — Cron 执行的任务账本
- [Heartbeat](/gateway/heartbeat) — Heartbeat 迁移说明
- [时区](/concepts/timezone) — 时区配置
