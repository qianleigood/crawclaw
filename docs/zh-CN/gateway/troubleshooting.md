---
read_when:
  - "]]故障排除中心指向此处以进行更深入的诊断"
  - "]]你需要基于症状的稳定操作手册章节，包含精确命令"
summary: "]]针对网关、渠道、自动化和浏览器的深度故障排除操作手册"
title: "]]故障排除"
x-i18n:
  generated_at: "2026-06-05T15:07:30Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: b42569a32d587111654d24a3ae3bb17401460f4945b243fed4cdfd27a00d5661
  source_path: gateway/troubleshooting.md
  workflow: 15
---

# Gateway 故障排除

本文档是深度操作手册。
如果你想先了解快速分类流程，请从 [/help/troubleshooting](/help/troubleshooting) 开始。

## 命令阶梯

按以下顺序首先运行这些命令：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

预期的健康信号：

- CrawClaw Desktop 或本地 Gateway API 显示 `Runtime: running` 和 `RPC probe: ok`。
- CrawClaw Desktop 或本地 Gateway API 未报告任何阻塞性的配置/服务问题。
- CrawClaw Desktop 或本地 Gateway API 显示已连接/就绪的渠道。

## Anthropic 429 长上下文需要额外用量

当日志/错误包含以下内容时使用：
`HTTP 429: rate_limit_error: Extra usage is required for long context requests`。

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

查找：

- 所选的 Anthropic Opus/Sonnet 模型具有 `params.context1m: true`。
- 当前 Anthropic 凭证不具备长上下文使用资格。
- 请求仅在需要 1M beta 路径的长会话/模型运行时失败。

修复选项：

1. 为该模型禁用 `context1m` 以回退到正常上下文窗口。
2. 使用具有计费的 Anthropic API key，或在订阅账户上启用 Anthropic Extra Usage。
3. 配置备用模型，以便在 Anthropic 长上下文请求被拒绝时继续运行。

相关：

- [/providers/anthropic](/providers/anthropic)
- [/reference/token-use](/reference/token-use)
- [/help/faq#why-am-i-seeing-http-429-ratelimiterror-from-anthropic](/help/faq#why-am-i-seeing-http-429-ratelimiterror-from-anthropic)

## 无回复

如果渠道正常运行但无响应，请在重新连接任何内容之前检查路由和策略。

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

查找：

- 私信发送者的配对待处理。
- 群组提及门控（`requireMention`、`mentionPatterns`）。
- 渠道/群组允许列表不匹配。

常见特征：

- `drop guild message (mention required` → 群组消息被忽略直至被提及。
- `pairing request` → 发送者需要批准。
- `blocked` / `allowlist` → 发送者/渠道被策略过滤。

相关：

- [/channels/troubleshooting](/channels/troubleshooting)
- [/channels/pairing](/channels/pairing)
- [/channels/groups](/channels/groups)

## 浏览器客户端连接

当面向浏览器的客户端无法连接时，验证 URL、认证模式和 secure context 假设。

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

查找：

- 正确的 probe URL 和客户端 URL。
- 客户端和网关之间的认证模式/令牌不匹配。

常见特征：

- `AUTH_TOKEN_MISMATCH` → 共享令牌漂移；刷新令牌配置并重试。
- `gateway connect failed:` → 错误的主机/端口/URL 目标。

### 认证详情代码快速映射

使用失败 `connect` 响应中的 `error.details.code` 来选择下一步操作：

| 详情代码              | 含义                           | 推荐操作                                                               |
| --------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `AUTH_TOKEN_MISSING`  | 客户端未发送所需的共享令牌。   | 将客户端令牌设置为匹配 CrawClaw Desktop 或本地 Gateway API，然后重试。 |
| `AUTH_TOKEN_MISMATCH` | 共享令牌与网关认证令牌不匹配。 | 检查此表中的当前 Gateway 认证详情并刷新客户端令牌。                    |

相关：

- [/gateway/configuration](/gateway/configuration)（网关认证模式）
- [/gateway/trusted-proxy-auth](/gateway/trusted-proxy-auth)
- [/gateway/remote](/gateway/remote)
- [设备配对](/network)

## Gateway 运行时不可达

当本地 Gateway 进程无法保持运行或 API 无法访问时使用。

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

查找：

- 端口/监听器冲突。

常见特征：

- `Gateway start blocked: set gateway.mode=local` → 本地网关模式未启用。修复：在配置中设置 `gateway.mode="local"`（或运行 CrawClaw Desktop 或本地 Gateway API）。
- `refusing to bind gateway ... without auth` → 非 local loopback 绑定需要令牌/密码。
- `another gateway instance is already listening` / `EADDRINUSE` → 端口冲突。

相关：

- [/gateway/background-process](/gateway/background-process)
- [/gateway/configuration](/gateway/configuration)
- [/gateway/doctor](/gateway/doctor)

## 渠道已连接消息未流动

如果渠道状态已连接但消息流中断，专注于策略、权限和特定渠道的传递规则。

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

查找：

- 私信策略（`pairing`、`allowlist`、`open`、`disabled`）。
- 群组允许列表和提及要求。
- 缺失的渠道 API 权限/作用域。

常见特征：

- `mention required` → 消息被群组提及策略忽略。
- `pairing` / 待批准追踪 → 发送者未获批准。
- `missing_scope`、`not_in_channel`、`Forbidden`、`401/403` → 渠道认证/权限问题。

相关：

- [/channels/troubleshooting](/channels/troubleshooting)
- [/channels/index](/channels/index)

## Cron 和主会话唤醒传递

如果 cron 或排队的 主会话唤醒未运行或未传递，首先验证调度器状态，然后检查传递目标。

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

查找：

- Cron 已启用且下一次唤醒存在。
- 作业运行历史状态（`ok`、`skipped`、`error`）。
- 唤醒跳过原因（`requests-in-flight`、`alerts-disabled`、`no-system-events`）。

常见特征：

- `cron: scheduler disabled; jobs will not run automatically` → Cron 已禁用。
- `cron: timer tick failed` → 调度器 tick 失败；检查文件/日志/运行时错误。
- `heartbeat: unknown accountId` → 无效的旧心跳传递账户 ID。
- `heartbeat skipped` 且 `reason=dm-blocked` → 旧心跳传递解析为私信式目标，而 `agents.defaults.heartbeat.directPolicy`（或按智能体覆盖）设置为 `block`。

相关：

- [/automation/cron-jobs#troubleshooting](/automation/cron-jobs#troubleshooting)
- [/automation/cron-jobs](/automation/cron-jobs)
- [/gateway/heartbeat](/gateway/heartbeat)

## 浏览器工具失败

当浏览器工具操作失败但网关本身健康时使用。

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

从当前智能体或 Gateway `/tools/invoke` 路径直接检查浏览器工具：

```json
{ "action": "status", "profile": "crawclaw" }
```

```json
{ "action": "profiles" }
```

查找：

- `tools.catalog` 是否在 `native-plugin` 下列出了 `browser`。
- 有效的浏览器可执行文件路径。
- 托管的 `agent-browser` 运行时健康状态。

常见特征：

- 智能体报告浏览器工具缺失/不可用 → 本机工具目录未暴露 `browser`。
- `agent-browser runtime is not installed` → 运行 CrawClaw Desktop 或本地 Gateway API。
- `browser.executablePath not found` → 配置的路径无效。

相关：

- [/tools/browser-linux-troubleshooting](/tools/browser-linux-troubleshooting)
- [/tools/browser](/tools/browser)

## 如果你升级后突然出现故障

大多数升级后故障是由配置漂移或现在强制执行的更严格默认值引起的。

### 1) 认证和 URL 覆盖行为已更改

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

检查项：

- 如果 `gateway.mode=remote`，CLI 调用可能指向远程，而你的本地服务正常。
- 显式 `--url` 调用不会回退到存储的凭证。

常见特征：

- `gateway connect failed:` → 错误的 URL 目标。
- `unauthorized` → 端点可达但认证错误。

### 2) 绑定和认证护栏更严格

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

检查项：

- 非 local loopback 绑定（`lan`、`tailnet`、`custom`）需要配置认证。
- 旧密钥如 `gateway.token` 不能替代 `gateway.auth.token`。

常见特征：

- `refusing to bind gateway ... without auth` → 绑定+认证不匹配。
- `RPC probe: failed` 但运行时正在运行 → 网关存活但当前认证/URL 无法访问。

### 3) 配对或身份策略已更改

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

检查项：

- 渠道策略或发送者身份更改后的待处理私信配对批准。

如果检查后服务配置和运行时仍然不一致，从相同的配置文件/状态目录重新安装服务元数据：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

相关：

- [/channels/pairing](/channels/pairing)
- [/gateway/authentication](/gateway/authentication)
- [/gateway/background-process](/gateway/background-process)
