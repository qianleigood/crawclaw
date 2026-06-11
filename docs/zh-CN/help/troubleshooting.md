---
read_when:
  - CrawClaw 无法工作，你需要最快的修复路径
  - 你想在深入阅读详细手册前进行分类排查
summary: 症状优先的 CrawClaw 故障排除门户
title: 常见故障排除
x-i18n:
  generated_at: "2026-06-05T14:39:02Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: e7c3e5318349dd7903e854a778af70ad37e442ed2216239e0693f1692f63e471
  source_path: help/troubleshooting.md
  workflow: 15
---

# 故障排除

如果你只有 2 分钟，使用此页面作为分类排查的入口。

## 最初的六十秒

按顺序执行以下检查清单：

先使用 CrawClaw Desktop 的状态界面。自动化场景调用 Gateway RPC method `health` 或
`status`，再按需调用 `channels.status`、`models.list` 和 `logs.tail`。

良好输出的判断标准：

- CrawClaw Desktop 或本地 Gateway API → 显示已配置的渠道，无明显认证错误。
- CrawClaw Desktop 或本地 Gateway API → 完整报告存在且可分享。
- CrawClaw Desktop 或本地 Gateway API → 预期的 gateway 目标可达（`Reachable: yes`）。`RPC: limited - missing scope: operator.read` 是降级的诊断信息，不是连接失败。
- CrawClaw Desktop 或本地 Gateway API → `Runtime: running` 且 `RPC probe: ok`。
- CrawClaw Desktop 或本地 Gateway API → 无阻塞性配置/服务错误。
- CrawClaw Desktop 或本地 Gateway API → 渠道报告 `connected` 或 `ready`。
- CrawClaw Desktop 或本地 Gateway API → 活动稳定，无重复的致命错误。

## Anthropic 长上下文 429

如果看到：
`HTTP 429: rate_limit_error: Extra usage is required for long context requests`,
请前往 [/gateway/troubleshooting#anthropic-429-extra-usage-required-for-long-context](/gateway/troubleshooting#anthropic-429-extra-usage-required-for-long-context)。

## 插件安装失败，使用旧的可执行文件条目

如果安装失败是因为某个包依赖 `crawclaw.extensions`，则该插件包使用的是 CrawClaw 不再接受的旧 TypeScript 运行时结构。

在插件包中修复：

1. 移除遗留的 JavaScript 扩展条目。
2. 将插件重新构建为 Rust 原生插件描述符。
3. 重新发布插件，从 CrawClaw Desktop 重新安装，然后确认它出现在 `plugins.list` 中。

示例：

```json crawclaw.plugin.json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Adds a native capability to CrawClaw",
  "native": {
    "protocol": "crawclaw-native-plugin-jsonrpc",
    "schemaVersion": 1,
    "bin": "./target/release/my-plugin"
  }
}
```

参考：[插件架构](/plugins/architecture)

## 决策树

```mermaid
flowchart TD
  A[CrawClaw 无法工作] --> B{最先出现什么问题}
  B --> C[无回复]
  B --> D[浏览器客户端无法连接]
  B --> E[Gateway 网关无法启动或服务未运行]
  B --> F[渠道已连接但消息未流动]
  B --> G[定时任务或主会话唤醒未触发或未送达]
  B --> H[节点已配对但摄像头画布屏幕 exec 失败]
  B --> I[浏览器工具失败]

  C --> C1[/无回复部分/]
  D --> D1[/浏览器客户端部分/]
  E --> E1[/Gateway 网关部分/]
  F --> F1[/渠道流部分/]
  G --> G1[/自动化部分/]
  H --> H1[/节点工具部分/]
  I --> I1[/浏览器部分/]
```

<AccordionGroup>
  <Accordion title="无回复">
    先使用 Desktop channel status 和 pairing 视图。自动化应调用 `channels.status`、
    `message.policy` 和 `logs.tail`。

    良好输出的判断标准：

    - `Runtime: running`
    - `RPC probe: ok`
    - 你的渠道在 `channels.status` 中显示已连接/就绪
    - 发送者显示已批准（或私信策略为开放/允许列表）

    常见日志特征：

    - `drop guild message (mention required` → 在 community chat 中，提及限制阻止了消息。
    - `pairing request` → 发送者未批准，正在等待私信配对批准。
    - `blocked` / `allowlist` 在渠道日志中 → 发送者、房间或群组被过滤。

    深入页面：

    - [/gateway/troubleshooting#no-replies](/gateway/troubleshooting#no-replies)
    - [/channels/troubleshooting](/channels/troubleshooting)
    - [/channels/pairing](/channels/pairing)

  </Accordion>

  <Accordion title="浏览器客户端无法连接">
    检查 Desktop Gateway target 和 auth status。自动化应对同一 URL 探测 Gateway RPC
    `health` 或 `status`。

    良好输出的判断标准：

    - 在你选择的访问路径中显示可到达的客户端目标
    - `RPC probe: ok`
    - 日志中无认证循环

    常见日志特征：

    - `AUTH_TOKEN_MISMATCH` → 令牌/密码错误或认证模式不匹配。
    - `gateway connect failed:` → 客户端指向了错误的 URL/端口或无法访问的 gateway。

    深入页面：

    - [/gateway/troubleshooting#browser-client-connectivity](/gateway/troubleshooting#browser-client-connectivity)
    - [/gateway/authentication](/gateway/authentication)

  </Accordion>

  <Accordion title="Gateway 网关无法启动或服务已安装但未运行">
    从 CrawClaw Desktop 启动或重启 local runtime。Gateway 可达后，自动化可调用 `health`
    或 `status`，并使用 `config.patch` 做 scoped config repairs。

    良好输出的判断标准：

    - `Service: ... (loaded)`
    - `Runtime: running`
    - `RPC probe: ok`

    常见日志特征：

    - `Gateway start blocked: set gateway.mode=local` → gateway 模式未设置/为远程模式。
    - `refusing to bind gateway ... without auth` → 非 local loopback 绑定时未设置令牌/密码。
    - `another gateway instance is already listening` 或 `EADDRINUSE` → 端口已被占用。

    深入页面：

    - [/gateway/troubleshooting#gateway-runtime-not-reachable](/gateway/troubleshooting#gateway-runtime-not-reachable)
    - [/gateway/background-process](/gateway/background-process)
    - [/gateway/configuration](/gateway/configuration)

  </Accordion>

  <Accordion title="渠道已连接但消息未流动">
    交互式检查使用 channel settings panel。自动化应调用 `channels.status`，然后通过
    `channels.setup.surface` 或 `channels.config.get` 检查受影响 channel。

    良好输出的判断标准：

    - 渠道传输已连接。
    - 配对/允许列表检查通过。
    - 在需要时检测到提及。

    常见日志特征：

    - `mention required` → 群组提及限制阻止了处理。
    - `pairing` / `pending` → 私信发送者尚未批准。
    - `not_in_channel`, `missing_scope`, `Forbidden`, `401/403` → 渠道权限令牌问题。

    深入页面：

    - [/gateway/troubleshooting#channel-connected-messages-not-flowing](/gateway/troubleshooting#channel-connected-messages-not-flowing)
    - [/channels/troubleshooting](/channels/troubleshooting)

  </Accordion>

  <Accordion title="定时任务或主会话唤醒未触发或未送达">
    交互式 cron 状态使用 Automation 页面。自动化应调用 `cron.status`、`cron.list` 和
    `cron.runs`。

    良好输出的判断标准：

    - `cron.status` 显示已启用且有下次唤醒时间。
    - `cron runs` 显示最近的 `ok` 条目。
    - 可在 Automation 页面或 cron run history 中看到排队的主会话唤醒事件。

    常见日志特征：

    - `cron: scheduler disabled; jobs will not run automatically` → 定时任务已禁用。
    - `requests-in-flight` → 主通道忙碌；唤醒被延迟。
    - `unknown accountId` → 遗留 heartbeat 投递目标账户不存在。

    深入页面：

    - [/gateway/troubleshooting#cron-and-main-session-wake-delivery](/gateway/troubleshooting#cron-and-main-session-wake-delivery)
    - [/automation/cron-jobs#troubleshooting](/automation/cron-jobs#troubleshooting)
    - [/gateway/heartbeat](/gateway/heartbeat)

  </Accordion>

  <Accordion title="Exec 突然请求审批">
    先检查 Desktop permission settings。自动化应通过 `tools.effective` 检查有效 exec policy，
    并通过 `config.patch` 应用 scoped config changes。

    发生了什么变化：

    - 如果 `tools.exec.host` 未设置，默认为 `auto`。
    - `host=auto` 仅用于路由；无提示的"YOLO"行为来自 Gateway 主机上的 `security=full` 加 `ask=off`。
    - 在 `gateway` 上，未设置的 `tools.exec.security` 默认为 `full`。
    - 未设置的 `tools.exec.ask` 默认为 `off`。
    - 结果：如果你看到审批请求，说明某些主机本地或按会话的策略收紧了 exec，远离了当前默认值。

    恢复当前默认的无审批行为：

    在 Desktop 中恢复默认 permission profile。自动化只针对目标 profile patch
    `tools.exec.security` 和 `tools.exec.ask`。

    更安全的替代方案：

    - 如果你只想稳定主机路由，仅设置 `tools.exec.host=gateway`。
    - 如果你希望主机 exec 但仍想在允许列表未命中时进行审查，使用 `security=allowlist` 加 `ask=on-miss`。

    常见日志特征：

    - `Approval required.` → 命令正在等待 `/approve ...`。
    - `SYSTEM_RUN_DENIED: approval required` → gateway exec 审批待处理。

    深入页面：

    - [/tools/exec](/tools/exec)
    - [/tools/exec-approvals](/tools/exec-approvals)
    - [安全](/gateway/security)

  </Accordion>

  <Accordion title="浏览器工具失败">
    交互式运行时使用 Desktop tool/runtime status。自动化应调用 `tools.catalog`，然后通过
    `/tools/invoke` 或 `tools.invoke` 调用 browser tool。

    从当前智能体或 Gateway `/tools/invoke` 路径，使用 `{ "action": "status", "profile": "crawclaw" }` 运行 `browser` 工具。

    良好输出的判断标准：

    - 浏览器工具状态显示 `running: true` 以及选定的浏览器/配置文件。
    - `crawclaw` 启动，或远程 CDP 配置文件可达。

    常见日志特征：

    - 浏览器工具缺失/不可用，而 `browser.enabled=true` → `plugins.allow` 已设置且不包含 `browser`。
    - `Failed to start Chrome CDP on port` → 本地浏览器启动失败。
    - `browser.executablePath not found` → 配置的二进制路径错误。
    - `Remote CDP for profile "<name>" is not reachable` → 配置的远程 CDP 端点不可达。

    深入页面：

    - [/gateway/troubleshooting#browser-tool-fails](/gateway/troubleshooting#browser-tool-fails)
    - [/tools/browser#missing-browser-tool](/tools/browser#missing-browser-tool)
    - [/tools/browser-linux-troubleshooting](/tools/browser-linux-troubleshooting)

  </Accordion>
</AccordionGroup>

## 相关资源

- [常见问题](/help/faq) — 常见问题解答
- [Gateway 故障排除](/gateway/troubleshooting) — Gateway 网关特定问题
- [Doctor](/gateway/doctor) — 自动化健康检查和修复
- [渠道故障排除](/channels/troubleshooting) — 渠道连接问题
- [自动化故障排除](/automation/cron-jobs#troubleshooting) — 定时任务和唤醒问题
